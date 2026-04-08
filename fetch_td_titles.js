/**
 * Abre o site do Tesouro Direto com Puppeteer + stealth,
 * intercepta a chamada de API interna e gera titulos_td.json.
 *
 * Coloque este arquivo na raiz do repositório público vj-wallet-td-data.
 */

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');

puppeteer.use(StealthPlugin());

const TD_PAGE = 'https://www.tesourodireto.com.br/titulos/precos-e-taxas.htm';
const OUTPUT_FILE = 'titulos_td.json';

function classifyTitle(name) {
  const n = name.toLowerCase();
  if (n.includes('selic')) return ['tesouro_selic', 'selic'];
  if (n.includes('prefixado') && (n.includes('juros') || n.includes('semestr')))
    return ['tesouro_prefixado_juros', 'prefixado'];
  if (n.includes('prefixado')) return ['tesouro_prefixado', 'prefixado'];
  if (n.includes('educa')) return ['tesouro_educa', 'ipca'];
  if (n.includes('renda')) return ['tesouro_renda', 'ipca'];
  if (n.includes('ipca') && (n.includes('juros') || n.includes('semestr')))
    return ['tesouro_ipca_juros', 'ipca'];
  if (n.includes('ipca')) return ['tesouro_ipca', 'ipca'];
  return ['tesouro_prefixado', 'prefixado'];
}

function parseDate(s) {
  if (!s) return '';
  if (s.includes('/')) {
    const [d, m, y] = s.trim().split('/');
    return `${y}-${m}-${d}`;
  }
  return s.substring(0, 10); // já em ISO
}

function parseApiResponse(data) {
  const titles = [];

  // Formato esperado: { response: { TrsrBdTradgList: [ { TrsrBd: {...} }, ... ] } }
  const items = data?.response?.TrsrBdTradgList ?? [];

  if (!items.length) {
    console.log(`[TD] TrsrBdTradgList vazio. Chaves recebidas: ${Object.keys(data?.response ?? data).join(', ')}`);
    return [];
  }

  for (const item of items) {
    const bd = item.TrsrBd ?? item;
    const name = (bd.nm ?? bd.NmTitulo ?? '').trim();
    if (!name) continue;

    const [subtype, indexer] = classifyTitle(name);
    titles.push({
      name,
      subtype,
      indexer,
      maturity_date: parseDate(bd.mtrtyDt ?? bd.DtVencimento ?? ''),
      buy_rate:  parseFloat(bd.anulInvstmtRate ?? bd.TaxaCompra  ?? 0) || 0,
      sell_rate: parseFloat(bd.anulRedRate      ?? bd.TaxaVenda   ?? 0) || 0,
      buy_pu:    parseFloat(bd.untrInvstmtVal   ?? bd.PuCompra    ?? 0) || 0,
      sell_pu:   parseFloat(bd.untrRedVal       ?? bd.PuVenda     ?? 0) || 0,
    });
  }

  return titles;
}

async function main() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();
  let captured = null;

  page.on('response', async (response) => {
    const url = response.url();
    const ct = response.headers()['content-type'] ?? '';
    if (
      url.includes('treasurybond') ||
      (url.includes('tesouro') && ct.includes('json'))
    ) {
      try {
        captured = await response.json();
        console.log(`[TD] Capturado: ${url}`);
      } catch (_) {}
    }
  });

  try {
    console.log(`[TD] Abrindo ${TD_PAGE} ...`);
    await page.goto(TD_PAGE, { waitUntil: 'networkidle2', timeout: 40000 });
    await new Promise((r) => setTimeout(r, 3000)); // aguarda chamadas tardias
  } catch (e) {
    console.log(`[TD] Aviso no goto: ${e.message}`);
  }

  await browser.close();

  if (!captured) {
    console.log('[TD] Nenhum dado capturado — JSON existente mantido.');
    process.exit(0);
  }

  const titles = parseApiResponse(captured);

  if (!titles.length) {
    console.log('[TD] Nenhum título parseado — JSON existente mantido.');
    process.exit(0);
  }

  const output = {
    updated_at: new Date().toISOString(),
    titles,
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2), 'utf-8');
  console.log(`[TD] ${titles.length} títulos gravados em ${OUTPUT_FILE}`);
}

main().catch((e) => {
  console.error('[TD] Erro fatal:', e.message);
  process.exit(0); // não falha o workflow; mantém JSON existente
});
