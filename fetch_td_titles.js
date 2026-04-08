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

function parseRate(s) {
  // Extrai o número percentual de strings como "SELIC + 0,0861%", "13,36%", "IPCA+ 6,30%"
  if (!s) return 0;
  const match = s.match(/([\d]+[,.][\d]+)%/);
  if (match) return parseFloat(match[1].replace(',', '.'));
  const match2 = s.match(/([\d]+)%/);
  if (match2) return parseFloat(match2[1]);
  return 0;
}

function parseApiResponse(data) {
  // Formato real da API: { TesouroLegado: [...], Tesouro24x7: [...] }
  const items = [
    ...(data?.TesouroLegado ?? []),
    ...(data?.Tesouro24x7  ?? []),
  ];

  if (!items.length) {
    console.log(`[TD] Nenhum item. Chaves: ${Object.keys(data ?? {}).join(', ')}`);
    return [];
  }

  return items.map((bd) => {
    const name = (bd.treasuryBondName ?? '').trim();
    const [subtype, indexer] = classifyTitle(name);
    return {
      name,
      subtype,
      indexer,
      maturity_date: (bd.maturityDate ?? '').substring(0, 10), // "2031-03-01T00:00" → "2031-03-01"
      buy_rate:  parseRate(bd.investmentProfitabilityIndexerName),
      sell_rate: parseRate(bd.redemptionProfitabilityFeeIndexerName),
      buy_pu:    parseFloat(bd.unitaryInvestmentValue  ?? 0) || 0,
      sell_pu:   parseFloat(bd.unitaryRedemptionValue  ?? 0) || 0,
    };
  }).filter((t) => t.name);
}

const TD_API = 'https://www.tesourodireto.com.br/o/rentabilidade/investir';

async function main() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();

  try {
    // 1. Navega para a página — passa pelo desafio Cloudflare e obtém cookies de sessão
    console.log(`[TD] Abrindo ${TD_PAGE} ...`);
    await page.goto(TD_PAGE, { waitUntil: 'networkidle2', timeout: 40000 });
    await new Promise((r) => setTimeout(r, 2000));

    // 2. Chama a API de dentro do browser (usa os cookies da sessão Cloudflare)
    console.log(`[TD] Chamando API: ${TD_API} ...`);
    const data = await page.evaluate(async (url) => {
      const resp = await fetch(url, {
        headers: { Accept: 'application/json' },
        credentials: 'include',
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return resp.json();
    }, TD_API);

    await browser.close();

    const titles = parseApiResponse(data);

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

  } catch (e) {
    console.log(`[TD] Erro: ${e.message} — JSON existente mantido.`);
    await browser.close();
    process.exit(0);
  }
}

main().catch((e) => {
  console.error('[TD] Erro fatal:', e.message);
  process.exit(0);
});

main().catch((e) => {
  console.error('[TD] Erro fatal:', e.message);
  process.exit(0); // não falha o workflow; mantém JSON existente
});
