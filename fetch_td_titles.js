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

const TD_PAGE   = 'https://www.tesourodireto.com.br/titulos/precos-e-taxas.htm';
const TD_API    = 'https://www.tesourodireto.com.br/o/rentabilidade/investir';
const OUTPUT_FILE = 'titulos_td.json';
const MAX_TRIES = 3;

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

function parseRate(s) {
  if (!s) return 0;
  const match = s.match(/([\d]+[,.][\d]+)%/);
  if (match) return parseFloat(match[1].replace(',', '.'));
  const match2 = s.match(/([\d]+)%/);
  if (match2) return parseFloat(match2[1]);
  return 0;
}

function parseApiResponse(data) {
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
      maturity_date: (bd.maturityDate ?? '').substring(0, 10),
      buy_rate:  parseRate(bd.investmentProfitabilityIndexerName),
      sell_rate: parseRate(bd.redemptionProfitabilityFeeIndexerName),
      buy_pu:    parseFloat(bd.unitaryInvestmentValue  ?? 0) || 0,
      sell_pu:   parseFloat(bd.unitaryRedemptionValue  ?? 0) || 0,
    };
  }).filter((t) => t.name);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchTitles(attempt) {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  try {
    const page = await browser.newPage();

    // User-agent realista
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    );

    // Navegação — usa domcontentloaded para não travar no Cloudflare
    const navTimeout = 45000 + attempt * 15000; // 45s, 60s, 75s nas tentativas
    console.log(`[TD] Tentativa ${attempt}: abrindo ${TD_PAGE} (timeout ${navTimeout}ms)...`);
    await page.goto(TD_PAGE, { waitUntil: 'domcontentloaded', timeout: navTimeout });

    // Aguarda o desafio Cloudflare resolver (tempo cresce a cada tentativa)
    const waitMs = 4000 + attempt * 2000; // 4s, 6s, 8s
    console.log(`[TD] Aguardando ${waitMs}ms para resolver challenge...`);
    await sleep(waitMs);

    // Chama a API de dentro do browser (usa os cookies da sessão)
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
    return parseApiResponse(data);

  } catch (e) {
    await browser.close().catch(() => {});
    throw e;
  }
}

async function main() {
  let lastError;

  for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
    try {
      const titles = await fetchTitles(attempt);

      if (!titles.length) {
        console.log('[TD] Nenhum título parseado — tentando novamente...');
        lastError = new Error('Nenhum título retornado pela API');
        if (attempt < MAX_TRIES) await sleep(5000);
        continue;
      }

      const output = {
        updated_at: new Date().toISOString(),
        titles,
      };

      fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2), 'utf-8');
      console.log(`[TD] Sucesso na tentativa ${attempt}: ${titles.length} títulos gravados.`);
      process.exit(0);

    } catch (e) {
      lastError = e;
      console.log(`[TD] Tentativa ${attempt} falhou: ${e.message}`);
      if (attempt < MAX_TRIES) {
        const retryWait = attempt * 8000; // 8s, 16s entre tentativas
        console.log(`[TD] Aguardando ${retryWait}ms antes de nova tentativa...`);
        await sleep(retryWait);
      }
    }
  }

  // Todas as tentativas falharam — sai com erro para o Actions notificar
  console.error(`[TD] Todas as ${MAX_TRIES} tentativas falharam. Último erro: ${lastError?.message}`);
  process.exit(1);
}

main().catch((e) => {
  console.error('[TD] Erro fatal:', e.message);
  process.exit(1);
});
