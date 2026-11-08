import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { classifyIrisItem, computeItemSha256, deduplicateAndFilterWindow } from '../src/irisCollector.js';
import { classifyAgent, MMT_SOVEREIGNTY, computeCalendarLock } from '../src/classifyCurrencies.js';
import { OP_VERSION } from '../src/shadowCalibration.js';

test('IRIS Classifier: detecta las 9 divisas (G8 + XAU) y las 6 categorías institucionales en < 1ms sin LLMs', () => {
  const t0 = performance.now();

  const bcItem = classifyIrisItem({
    title: 'Fed Chair Powell signals FOMC will hold interest rates steady; ECB Lagarde concurs',
    url: 'https://example.com/fed-ecb-1',
    published_at: new Date().toISOString(),
  });
  assert.ok(bcItem.currencies.includes('USD'));
  assert.ok(bcItem.currencies.includes('EUR'));
  assert.equal(bcItem.iris_category, 'BC');

  const fiscalItem = classifyIrisItem({
    title: 'UK Gilts and French OAT bond yields surge ahead of Treasury budget auction deficit',
    url: 'https://example.com/fiscal-1',
    published_at: new Date().toISOString(),
  });
  assert.ok(fiscalItem.currencies.includes('GBP'));
  assert.ok(fiscalItem.currencies.includes('EUR'));
  assert.ok(fiscalItem.iris_categories.includes('Fiscal'));

  const infItem = classifyIrisItem({
    title: 'US Core CPI YoY and Nonfarm Payrolls NFP beat expectations; unemployment drops',
    url: 'https://example.com/cpi-nfp-1',
    published_at: new Date().toISOString(),
  });
  assert.ok(infItem.currencies.includes('USD'));
  assert.equal(infItem.iris_category, 'Inflacion_Empleo');

  const commItem = classifyIrisItem({
    title: 'Spot Gold XAU hits record high as WTI crude oil, iron ore and New Zealand GDT dairy auction rise',
    url: 'https://example.com/comm-1',
    published_at: new Date().toISOString(),
  });
  assert.ok(commItem.currencies.includes('XAU'));
  assert.ok(commItem.currencies.includes('AUD'));
  assert.ok(commItem.currencies.includes('NZD'));
  assert.ok(commItem.currencies.includes('CAD'));
  assert.equal(commItem.iris_category, 'Commodities_ToT');

  const intItem = classifyIrisItem({
    title: 'Japan MoF conducts FX intervention rate check after verbal warning on excessive moves; SNB intervention eyed',
    url: 'https://example.com/mof-1',
    published_at: new Date().toISOString(),
  });
  assert.ok(intItem.currencies.includes('JPY'));
  assert.ok(intItem.currencies.includes('CHF'));
  assert.equal(intItem.iris_category, 'Intervencion_EA4');

  const riskItem = classifyIrisItem({
    title: 'Strait of Hormuz geopolitical escalation sparks systemic bank stress and emergency liquidity swap line',
    url: 'https://example.com/risk-1',
    published_at: new Date().toISOString(),
  });
  assert.equal(riskItem.iris_category, 'Riesgo_Sistemico');

  const elapsedMs = performance.now() - t0;
  assert.ok(elapsedMs < 25, `Clasificación determinista debe ejecutarse en milisegundos (tomó ${elapsedMs.toFixed(2)}ms)`);
});

test('Deduplicación estricta sha256(url || title) y ventana limpia de 72 horas', () => {
  const now = Date.now();
  const sha1 = computeItemSha256('https://www.ft.com/content/abc/', 'BOJ rate decision');
  const sha2 = computeItemSha256('http://www.ft.com/content/abc', '  boj rate decision ');
  assert.equal(sha1, sha2, 'URLs equivalentes HTTP/HTTPS y títulos con espacios deben colapsar al mismo SHA-256');

  const recent = {
    title: 'RBA holds cash rate at 4.35%',
    url: 'https://www.rba.gov.au/mr-1',
    source_type: 'breaking',
    published_at: new Date(now - 2 * 3600_000).toISOString(),
  };
  const duplicateRecent = {
    title: 'RBA holds cash rate at 4.35%',
    url: 'https://www.rba.gov.au/mr-1/',
    source_type: 'breaking',
    published_at: new Date(now - 2 * 3600_000).toISOString(),
  };
  const expiredBreaking = {
    title: 'Old breaking news from 5 days ago',
    url: 'https://t.me/FinancialJuice/100',
    source_type: 'breaking',
    published_at: new Date(now - 120 * 3600_000).toISOString(),
  };

  const { allWindowItems } = deduplicateAndFilterWindow([recent, duplicateRecent, expiredBreaking], [], now, 72);
  assert.equal(allWindowItems.length, 1);
  assert.equal(allWindowItems[0].title, 'RBA holds cash rate at 4.35%');
});

test('Candado Anti-Cobro Netlify ([skip netlify]) presente en workflow y netlify.toml', () => {
  const wf = readFileSync(new URL('../.github/workflows/update_radar_news.yml', import.meta.url), 'utf8');
  const toml = readFileSync(new URL('../netlify.toml', import.meta.url), 'utf8');
  assert.match(wf, /cron:\s*'\*\/5 \* \* \* \*'/);
  const loop = readFileSync(new URL('../scripts/sync_loop.sh', import.meta.url), 'utf8');
  assert.match(loop, /chore\(feed\): sync radar news \[skip netlify\]/);
  assert.match(toml, /\[skip netlify\]/);
  assert.match(toml, /\/api\/iris-feed/);
  assert.match(toml, /\/api\/radar-full/);
});

test('mmt-agent-op-v4.1-G8: Regla 1 (PMI < 50 + AiG AUD) y Ajustes v4.1 (Freno B12 EUR, CONTEXTO_GENERAL sin A1/B2 por defecto, Contracción Laboral NZD)', () => {
  assert.equal(OP_VERSION, 'mmt-agent-op-v4.1-G8');
  assert.equal(MMT_SOVEREIGNTY.USD, 'SOBERANO_EMISOR');
  assert.equal(MMT_SOVEREIGNTY.EUR, 'USUARIO_MONEDA');

  const now = Date.now();
  const pubIso = new Date(now - 30 * 60_000).toISOString();

  // Caso real AUD: Services PMI 48.5 (prev 47.9) + AiG Manufacturing -20.1 + AiG Construction -26.9
  const audPmiSub50 = {
    title: 'AUSTRALIAN SERVICES PMI FINAL ACTUAL 48.5 (FORECAST -, PREVIOUS 47.9)',
    actual: '48.5',
    previous: '47.9',
    currencies: ['AUD'],
    category: 'dato_macro',
    source_type: 'breaking',
    published_at: pubIso,
    fingerprint: 'aud-pmi-485',
  };
  const audAigMfg = {
    title: 'AUSTRALIAN AIG MANUFACTURING INDEX ACTUAL -20.1 (PREVIOUS -8.3)',
    actual: '-20.1',
    previous: '-8.3',
    currencies: ['AUD'],
    category: 'dato_macro',
    source_type: 'breaking',
    published_at: pubIso,
    fingerprint: 'aud-aig-mfg',
  };
  const audAigConst = {
    title: 'AUSTRALIAN AIG CONSTRUCTION INDEX ACTUAL -26.9 (PREVIOUS -18.4)',
    actual: '-26.9',
    previous: '-18.4',
    currencies: ['AUD'],
    category: 'dato_macro',
    source_type: 'breaking',
    published_at: pubIso,
    fingerprint: 'aud-aig-const',
  };

  // Incluso si saliera solo el PMI 48.5 vs 47.9, su impacto máximo es <= +5 y jamás "Dato real fuerte"
  const soloRows = classifyAgent([audPmiSub50], now);
  const audSolo = soloRows.find((r) => r.currency === 'AUD');
  assert.ok(audSolo.score <= 5, `PMI 48.5 < 50 aislado no puede superar +5 (obtuvo ${audSolo.score})`);
  assert.ok(!audSolo.drivers.some((d) => /Dato real fuerte/i.test(d)), 'Prohibido etiquetar PMI < 50 como Dato real fuerte');

  // Combinado con AiG -20.1 y -26.9 en la misma ventana, el neto de actividad real queda negativo
  const clusterRows = classifyAgent([audPmiSub50, audAigMfg, audAigConst], now);
  const audCluster = clusterRows.find((r) => r.currency === 'AUD');
  assert.ok(audCluster.score < 0, `AUD con PMI 48.5 + AiG -20.1/-26.9 debe quedar en terreno negativo (obtuvo ${audCluster.score})`);
  assert.equal(audCluster.ficha_v6, 'B2');

  // Regla 2: Aranceles PM Carney EE.UU.-Canadá -> COST_PUSH / RIESGO EA-1 (STAG_TRAP)
  const carneyTariff = classifyIrisItem({
    title: 'PM Carney warns US-Canada trade tariffs risk supply-chain inflation shock',
    url: 'https://example.com/carney-tariff',
    currencies: ['CAD'],
    published_at: pubIso,
  });
  assert.equal(carneyTariff.ficha_v6, 'EA-1');
  assert.equal(carneyTariff.mmt_lens, 'COST_PUSH_STAG_TRAP');

  // Ajuste 2 v4.1: EUR con B12_EUR_FRAG_RIESGO activo (presupuesto Francia / BCE) frena todo score positivo <= 0
  const eurFragItem = classifyIrisItem({
    title: "ECB's Nagel on France Budget: This isn't a task for monetary policy.",
    url: 'https://example.com/eur-frag',
    currencies: ['EUR'],
    published_at: pubIso,
    fingerprint: 'eur-frag-nagel',
  });
  const eurHawkItem = classifyIrisItem({
    title: 'ECB hawkish rate hike expectations rise 15 bps',
    url: 'https://example.com/eur-hawk',
    currencies: ['EUR'],
    published_at: pubIso,
    fingerprint: 'eur-hawk-1',
  });
  assert.equal(eurFragItem.ficha_v6, 'B12');
  assert.equal(eurFragItem.mmt_lens, 'B12_EUR_FRAG_RIESGO');
  const eurRows = classifyAgent([eurFragItem, eurHawkItem], now);
  const eurRow = eurRows.find((r) => r.currency === 'EUR');
  assert.ok(eurRow.score <= 0, `EUR con B12_EUR_FRAG_RIESGO activo nunca puede tener score > 0 (obtuvo ${eurRow.score})`);
  assert.equal(eurRow.ficha_v6, 'B12');
  assert.equal(eurRow.sovereignty_mmt, 'B12_EUR_FRAG_RIESGO');

  // Ajuste 3 v4.1: Noticias generales/corporativas sin términos de tasas/BC reciben CONTEXTO_GENERAL (ficha_v6: null)
  for (const generalTitle of [
    "Baseball's championship series ran through Milwaukee and Tampa - Bureau of Labor Statistics (.gov)",
    'Northland to get fourth Rural Training Hub',
    'Meta Platforms to price $15B senior notes',
  ]) {
    const item = classifyIrisItem({ title: generalTitle, published_at: pubIso });
    assert.equal(item.ficha_v6, null, `Noticia general no debe tener Ficha A1/B2: ${generalTitle}`);
    assert.equal(item.mmt_lens, 'CONTEXTO_GENERAL');
  }

  // Ajuste 4 v4.1: Desempleo NZ 5.7% vs 5.5% + Wage Growth +0.5% vs +0.6% -> Ficha B2 / Contracción Laboral
  const nzdUnemp = classifyIrisItem({
    title: 'NEW ZEALAND UNEMPLOYMENT RATE ACTUAL 5.7% (FORECAST 5.5%, PREVIOUS 5.4%) $MACRO',
    currencies: ['NZD'],
    category: 'dato_macro',
    source_type: 'breaking',
    published_at: pubIso,
    fingerprint: 'nzd-unemp-57',
  });
  const nzdWage = classifyIrisItem({
    title: 'NEW ZEALAND WAGE GROWTH QOQ ACTUAL 0.5% (FORECAST 0.6%, PREVIOUS 0.6%) $MACRO',
    currencies: ['NZD'],
    category: 'dato_macro',
    source_type: 'breaking',
    published_at: pubIso,
    fingerprint: 'nzd-wage-05',
  });
  assert.equal(nzdUnemp.ficha_v6, 'B2');
  assert.equal(nzdUnemp.mmt_lens, 'CONTRACCION_LABORAL_B2');
  assert.equal(nzdWage.ficha_v6, 'B2');
  assert.equal(nzdWage.mmt_lens, 'CONTRACCION_LABORAL_B2');
  const nzdRows = classifyAgent([nzdUnemp, nzdWage], now);
  const nzdRow = nzdRows.find((r) => r.currency === 'NZD');
  assert.ok(nzdRow.score < -20, `NZD con deterioro laboral doble debe caer bajo -20 (obtuvo ${nzdRow.score})`);
  assert.equal(nzdRow.ficha_v6, 'B2');
  assert.match(nzdRow.drivers[0], /Ficha B2 \/ Contracción Laboral/i);

  // Regla 4: Candado de Agenda ⚑BC <48h (Candado CIRO) y ✓ POST-EVENTO
  const calEvents = [
    {
      id: 'boe-1',
      currency: 'GBP',
      title: 'Official Bank Rate',
      impact: 'High',
      event_at: new Date(now + 18 * 3600_000).toISOString(),
    },
    {
      id: 'nzd-1',
      currency: 'NZD',
      title: 'Unemployment Rate',
      impact: 'High',
      actual: '5.7%',
      forecast: '5.5%',
      previous: '5.4%',
      event_at: new Date(now - 4 * 3600_000).toISOString(),
    },
  ];
  const gbpLock = computeCalendarLock('GBP', calEvents, now);
  assert.equal(gbpLock.calendar_lock, '⚑BC <48h (Candado CIRO)');
  const nzdLock = computeCalendarLock('NZD', calEvents, now);
  assert.equal(nzdLock.calendar_lock, '✓ POST-EVENTO');
  assert.match(nzdLock.post_event_status, /5\.7%.*5\.5%/);
});
