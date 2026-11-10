import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyItemMmtV4, MOSLER_RULES } from '../src/classifyCurrencies.js';
import { classifyIrisItem } from '../src/irisCollector.js';
import { RISK_CURRENCIES, buildRiskMap } from '../src/riskMap.js';

/**
 * Parte E. Cada prueba de ranking antigua comprueba ahora la ficha y la lente
 * que el clasificador da a ese titular, y que el mapa no le asigna un nivel.
 */
const NOW = Date.parse('2026-10-24T00:00:00.000Z');
const RANKING_KEYS = ['score', 'rank', 'bias', 'impulse', 'structural'];
const FORBIDDEN = /\blong\b|\bshort\b|sesgo largo|sesgo corto|vía libre operativa|\bcompra\b|\bvende\b|subirá|bajará/i;

function headline(title, currencies, extra = {}) {
  return {
    title,
    body: extra.body || '',
    currencies,
    source_type: extra.source_type || 'breaking',
    category: extra.category || 'dato_macro',
    actual: extra.actual ?? null,
    forecast: extra.forecast ?? null,
    previous: extra.previous ?? null,
    impact: extra.impact ?? 4,
    published_at: new Date(NOW - (extra.minsAgo ?? 30) * 60_000).toISOString(),
    url: `https://example.com/h/${encodeURIComponent(title).slice(0, 48)}`,
  };
}

function fichaFor(raw, currency) {
  return classifyItemMmtV4({ ...raw, currencies: [currency], g8_currencies: [currency] });
}

function expectFicha(raw, currency, expected) {
  const iris = classifyIrisItem(raw);
  const mmt = fichaFor(raw, currency);
  assert.equal(mmt.ficha_v6, expected.ficha);
  assert.equal(mmt.mmt_lens, expected.lens);
  assert.equal(iris.iris_category, expected.category);
  if (expected.impact != null) assert.equal(iris.impact, expected.impact);
  if (expected.sovereignty) assert.equal(mmt.sovereignty_mmt, expected.sovereignty);
  if (expected.irisFicha !== false) {
    assert.equal(iris.ficha_v6, expected.irisFicha ?? expected.ficha);
    assert.equal(iris.mmt_lens, expected.irisLens ?? expected.lens);
  }
  return iris;
}

function quietMap(items) {
  const coverage = {};
  for (const currency of ['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD', 'NZD']) {
    coverage[currency] = { silence: false };
  }
  return buildRiskMap({
    coverage,
    calendarEvents: [],
    items,
    polymarketGeo: { markets: [] },
    nowMs: NOW,
  });
}

function expectQuiet(row) {
  assert.equal(row.risk_level, 'BAJO');
  assert.equal(row.lock_level, 'NINGUNO');
  assert.deepEqual(row.reasons, []);
  for (const key of RANKING_KEYS) assert.equal(Object.hasOwn(row, key), false, key);
  assert.doesNotMatch(JSON.stringify(row.reasons), FORBIDDEN);
}

test('sustituye «CPI alto con economía débil no suma soporte»: ficha del CPI y de la debilidad', () => {
  const cpi = headline('UK CPI ACTUAL 3.8% FORECAST 3.2% PREVIOUS 3.1%', ['GBP'], { actual: '3.8', forecast: '3.2', previous: '3.1' });
  const retail = headline('UK retail sales miss: contraction, weak economy', ['GBP'], { actual: '-0.7', forecast: '0.2' });
  const pmi = headline('UK PMI services falls below 50, slowdown', ['GBP'], { actual: '48.1', forecast: '51.0' });
  const cpiIris = expectFicha(cpi, 'GBP', { ficha: 'A1', lens: 'INFLATION_PRINT', category: 'Inflacion_Empleo', impact: 4, sovereignty: 'SOBERANO_EMISOR' });
  assert.ok(cpiIris.g8_currencies.includes('USD'));
  expectFicha(retail, 'GBP', { ficha: 'B2', lens: 'CONTRACCION_REAL', category: 'Inflacion_Empleo', impact: 4 });
  expectFicha(pmi, 'GBP', { ficha: 'B2', lens: 'PMI_CONTRACCION_SUB50', category: 'Inflacion_Empleo', impact: 4 });
  expectQuiet(quietMap([cpi, retail, pmi]).find((row) => row.currency === 'GBP'));
});

test('sustituye «CPI alto con economía en capacidad queda acotado»: el dato real es A5', () => {
  const cpi = headline('US CPI ACTUAL 3.4% FORECAST 3.1%', ['USD'], { actual: '3.4', forecast: '3.1' });
  const payrolls = headline('US payrolls beat, hot labor market expansion', ['USD'], { actual: '250', forecast: '160' });
  const pmi = headline('US PMI jumps above 52, strong growth', ['USD'], { actual: '56.0', forecast: '52.0' });
  expectFicha(cpi, 'USD', { ficha: 'A1', lens: 'INFLATION_PRINT', category: 'Inflacion_Empleo', impact: 4 });
  expectFicha(payrolls, 'USD', { ficha: 'A5', lens: 'EXPANSION_REAL_A5', category: 'Inflacion_Empleo', impact: 4 });
  expectFicha(pmi, 'USD', { ficha: 'A5', lens: 'EXPANSION_REAL_A5', category: 'Inflacion_Empleo', impact: 4 });
  expectQuiet(quietMap([cpi, payrolls, pmi]).find((row) => row.currency === 'USD'));
});

test('sustituye «déficit de un emisor soberano no es presión automática»: NFA, no B12', () => {
  const gbp = headline('UK deficit cannot afford spending, downgrade fears', ['GBP'], { category: 'analisis', impact: 3 });
  const usd = headline('US deficit cannot afford spending, downgrade fears', ['USD'], { category: 'analisis', impact: 3 });
  expectFicha(gbp, 'GBP', { ficha: 'A12 / B10 / C3', lens: 'FLUJO_FISCAL_NFA', category: 'Fiscal', impact: 3, sovereignty: 'SOBERANO_EMISOR' });
  expectFicha(usd, 'USD', { ficha: 'A12 / B10 / C3', lens: 'FLUJO_FISCAL_NFA', category: 'Fiscal', impact: 3, sovereignty: 'SOBERANO_EMISOR' });
  const rows = quietMap([gbp, usd]);
  expectQuiet(rows.find((row) => row.currency === 'GBP'));
  expectQuiet(rows.find((row) => row.currency === 'USD'));
});

test('sustituye «el EUR es usuario de moneda»: déficit de Francia es B12', () => {
  const eur = headline('France deficit cannot afford spending, downgrade fears', ['EUR'], { category: 'analisis', impact: 3 });
  expectFicha(eur, 'EUR', {
    ficha: 'B12',
    lens: 'B12_EUR_FRAG_RIESGO',
    category: 'Fiscal',
    impact: 3,
    sovereignty: 'USUARIO_MONEDA',
  });
  expectQuiet(quietMap([eur]).find((row) => row.currency === 'EUR'));
});

test('sustituye «hike en régimen débil no es soporte»: estanflación es EA-1 y el PMI queda bajo 50', () => {
  const hike = headline('BoE hike as stagflation unsustainable economy persists', ['GBP'], { category: 'banco_central' });
  const cpi = headline('UK CPI ACTUAL 4.1% FORECAST 3.5% weak economy', ['GBP'], { actual: '4.1', forecast: '3.5' });
  const pmi = headline('UK PMI contracts below 50, recession fears', ['GBP'], { actual: '47.0', forecast: '50.2' });
  expectFicha(hike, 'GBP', { ficha: 'EA-1', lens: 'COST_PUSH_STAG_TRAP', category: 'BC', impact: 4 });
  expectFicha(cpi, 'GBP', { ficha: 'B8', lens: 'COST_PUSH_EROSION_REAL', category: 'Inflacion_Empleo', impact: 4 });
  expectFicha(pmi, 'GBP', { ficha: 'B2', lens: 'PMI_CONTRACCION_SUB50', category: 'Inflacion_Empleo', impact: 4 });
  expectQuiet(quietMap([hike, cpi, pmi]).find((row) => row.currency === 'GBP'));
});

test('sustituye «does not hike se trata como negación»: la pausa es B2, no A1', () => {
  const usd = headline("Fed doesn't hike, holds rates", ['USD'], { category: 'banco_central' });
  expectFicha(usd, 'USD', { ficha: 'B2', lens: 'REPRICING_MONETARIO', category: 'BC', impact: 4 });
  assert.notEqual(fichaFor(usd, 'USD').mmt_lens, 'REPRICING_MONETARIO_A1');
  expectQuiet(quietMap([usd]).find((row) => row.currency === 'USD'));
});

test('sustituye «desempleo invertido»: paro por encima del consenso es contracción laboral', () => {
  const usd = headline('US unemployment ACTUAL 4.5% FORECAST 4.1%', ['USD'], { actual: '4.5', forecast: '4.1' });
  expectFicha(usd, 'USD', { ficha: 'B2', lens: 'CONTRACCION_LABORAL_B2', category: 'Inflacion_Empleo', impact: 4 });
  expectQuiet(quietMap([usd]).find((row) => row.currency === 'USD'));
});

test('sustituye «oficial de hace 20 días sigue en ventana»: la ficha no caduca y el mapa sigue BAJO', () => {
  const official = headline('Updates to the October Monetary Policy Review', ['NZD'], {
    source_type: 'oficial', category: 'banco_central', impact: 2, minsAgo: 20 * 24 * 60,
  });
  const breaking = headline('Kiwi CPI miss ACTUAL 1.0 FORECAST 2.0', ['NZD'], {
    actual: '1.0', forecast: '2.0', minsAgo: 20 * 24 * 60,
  });
  expectFicha(official, 'NZD', { ficha: 'A1 / B2', lens: 'REPRICING_MONETARIO', category: 'BC', impact: 2 });
  const kiwi = expectFicha(breaking, 'NZD', { ficha: 'B2', lens: 'INFLATION_PRINT', category: 'Inflacion_Empleo', impact: 4 });
  assert.ok(kiwi.g8_currencies.includes('USD'));
  const rows = quietMap([official, breaking]);
  expectQuiet(rows.find((row) => row.currency === 'NZD'));
  assert.equal(rows.find((row) => row.currency === 'NZD').ea4_24h, false);
});

test('sustituye «titular oficial cuenta como evidencia aunque el score sea 0»: tiene ficha A1/B2', () => {
  const nzd = headline('Updates to the October Monetary Policy Review', ['NZD'], {
    source_type: 'oficial', category: 'banco_central', impact: 2,
  });
  const card = expectFicha(nzd, 'NZD', { ficha: 'A1 / B2', lens: 'REPRICING_MONETARIO', category: 'BC', impact: 2 });
  assert.notEqual(card.ficha_v6, null);
  assert.notEqual(card.mmt_lens, 'CONTEXTO_GENERAL');
  const row = quietMap([nzd]).find((item) => item.currency === 'NZD');
  expectQuiet(row);
  assert.equal(Object.hasOwn(row, 'rank'), false);
});

test('sustituye «sin titulares: N/D, score 0, rank null»: el dato de empleo es A5 y el resto no tiene ficha', () => {
  const payrolls = headline('US payrolls beat ACTUAL 250 FORECAST 160', ['USD'], { actual: '250', forecast: '160' });
  expectFicha(payrolls, 'USD', { ficha: 'A5', lens: 'EXPANSION_REAL_A5', category: 'Inflacion_Empleo', impact: 4 });
  const rows = quietMap([payrolls]);
  expectQuiet(rows.find((row) => row.currency === 'CHF'));
  expectQuiet(rows.find((row) => row.currency === 'NZD'));
  expectQuiet(rows.find((row) => row.currency === 'USD'));
  assert.equal(JSON.stringify(rows).includes('cambio_regimen'), false);
});

test('sustituye «refugio geopolítico»: USD/JPY/CHF en A6 y NZD en B5', () => {
  const raw = headline('Missile attack closes Hormuz, war risk', ['USD', 'JPY', 'CHF', 'NZD'], { category: 'geopolitica', impact: 5 });
  const iris = classifyIrisItem(raw);
  assert.equal(iris.iris_category, 'Riesgo_Sistemico');
  assert.equal(iris.impact, 5);
  assert.equal(iris.ficha_v6, 'A6 / B5 / B15');
  assert.equal(iris.mmt_lens, 'SAFE_HAVEN_A6');
  for (const [currency, lens] of [
    ['USD', 'SAFE_HAVEN_A6'],
    ['JPY', 'SAFE_HAVEN_A6'],
    ['CHF', 'SAFE_HAVEN_A6'],
    ['NZD', 'RISK_OFF_CYCLICAL_B5'],
  ]) {
    const mmt = fichaFor(raw, currency);
    assert.equal(mmt.ficha_v6, 'A6 / B5 / B15', currency);
    assert.equal(mmt.mmt_lens, lens, currency);
  }
  const rows = quietMap([raw]);
  for (const currency of ['USD', 'JPY', 'CHF', 'NZD']) expectQuiet(rows.find((row) => row.currency === currency));
});

test('sustituye «máximo 3 drivers y sesgo por umbral ±12»: cada nómina es expansión A5 y el mapa no tiene sesgo', () => {
  const items = Array.from({ length: 8 }, (_, i) => headline(
    `US payrolls beat ACTUAL ${200 + i} FORECAST 100`,
    ['USD'],
    { actual: String(200 + i), forecast: '100', minsAgo: 10 + i },
  ));
  for (const raw of items) {
    expectFicha(raw, 'USD', { ficha: 'A5', lens: 'EXPANSION_REAL_A5', category: 'Inflacion_Empleo', impact: 4 });
  }
  const usd = quietMap(items).find((row) => row.currency === 'USD');
  expectQuiet(usd);
  assert.equal(Object.hasOwn(usd, 'bias'), false);
});

test('sustituye «prompt Mosler veta lenguaje de ejecución»: el prompt y el CPI débil', () => {
  assert.match(MOSLER_RULES, /CPI\/inflación ALTO con economía DÉBIL/);
  assert.match(MOSLER_RULES, /Prohibido "long"/);
  assert.match(MOSLER_RULES, /fingerprint/);
  assert.match(MOSLER_RULES, /CPI NO es el motor único/);
  assert.match(MOSLER_RULES, /PMI \(Manufacturing, Services, Composite, ISM, Caixin\) con Actual < 50\.0/);
  const weakCpi = headline('UK CPI ACTUAL 4.1% FORECAST 3.5% weak economy', ['GBP'], { actual: '4.1', forecast: '3.5' });
  expectFicha(weakCpi, 'GBP', { ficha: 'B8', lens: 'COST_PUSH_EROSION_REAL', category: 'Inflacion_Empleo', impact: 4 });
  expectQuiet(quietMap([weakCpi]).find((row) => row.currency === 'GBP'));
});

test('sustituye «inflación + tightening no queda en CPI 0»: el BoJ es repricing A1', () => {
  const jpy = headline('September inflation keeps BoJ on tightening course', ['JPY'], {
    category: 'banco_central', source_type: 'oficial',
  });
  const card = expectFicha(jpy, 'JPY', { ficha: 'A1 / B2', lens: 'REPRICING_MONETARIO_A1', category: 'BC', impact: 4 });
  assert.notEqual(card.mmt_lens, 'INFLATION_PRINT');
  const row = quietMap([jpy]).find((item) => item.currency === 'JPY');
  expectQuiet(row);
  assert.equal(row.ea4_24h, false);
});

test('sustituye «oficial hawkish de hace 20 días todavía puntúa»: la ficha A1 se conserva', () => {
  const nzd = headline('RBNZ MPS: OCR remains restrictive, inflation persistent', ['NZD'], {
    source_type: 'oficial', category: 'banco_central', impact: 3, minsAgo: 20 * 24 * 60,
  });
  expectFicha(nzd, 'NZD', { ficha: 'A1 / B2', lens: 'REPRICING_MONETARIO_A1', category: 'BC', impact: 3 });
  expectQuiet(quietMap([nzd]).find((row) => row.currency === 'NZD'));
});

test('sustituye «FOMC restrictive no es Neutral 0»: es repricing A1', () => {
  const usd = headline('FOMC statement: Committee remains vigilant, policy restrictive', ['USD'], {
    source_type: 'oficial', category: 'banco_central',
  });
  const card = expectFicha(usd, 'USD', { ficha: 'A1 / B2', lens: 'REPRICING_MONETARIO_A1', category: 'BC', impact: 4 });
  assert.notEqual(card.ficha_v6, null);
  assert.notEqual(card.mmt_lens, 'CONTEXTO_GENERAL');
  expectQuiet(quietMap([usd]).find((row) => row.currency === 'USD'));
});

test('sustituye «colapso de confianza es presión y NFA es soporte»: B2 y flujo fiscal', () => {
  const gbp = headline('Relentless cost of living pressures behind collapse of consumer confidence', ['GBP'], { category: 'analisis' });
  const chf = headline('SNB profit distribution to Confederation and cantons', ['CHF'], {
    source_type: 'oficial', category: 'banco_central',
  });
  expectFicha(gbp, 'GBP', { ficha: 'B2', lens: 'CONTRACCION_REAL', category: 'Inflacion_Empleo', impact: 4 });
  expectFicha(chf, 'CHF', { ficha: 'A12 / B10 / C3', lens: 'FLUJO_FISCAL_NFA', category: 'BC', impact: 4, sovereignty: 'SOBERANO_EMISOR' });
  const rows = quietMap([gbp, chf]);
  expectQuiet(rows.find((row) => row.currency === 'GBP'));
  expectQuiet(rows.find((row) => row.currency === 'CHF'));
});

test('sustituye «el Agente diferencia divisas»: las fichas no se ordenan', () => {
  const jpy = headline('BoJ on tightening course as inflation persists', ['JPY'], { category: 'banco_central', source_type: 'oficial' });
  const gbp = headline('UK consumer confidence collapses under cost of living pressures', ['GBP']);
  const eur = headline('France deficit cannot afford spending, downgrade fears', ['EUR'], { category: 'analisis' });
  const chf = headline('SECO raises growth forecast, revisión al alza del crecimiento', ['CHF'], { source_type: 'oficial' });
  const cards = [
    expectFicha(jpy, 'JPY', { ficha: 'A1 / B2', lens: 'REPRICING_MONETARIO_A1', category: 'BC', impact: 4 }),
    expectFicha(gbp, 'GBP', { ficha: 'B2', lens: 'CONTRACCION_REAL', category: 'Inflacion_Empleo', impact: 4 }),
    expectFicha(eur, 'EUR', { ficha: 'B12', lens: 'B12_EUR_FRAG_RIESGO', category: 'Fiscal', impact: 4, sovereignty: 'USUARIO_MONEDA' }),
    expectFicha(chf, 'CHF', { ficha: 'A5', lens: 'EXPANSION_REAL_A5', category: 'Inflacion_Empleo', impact: 4 }),
  ];
  assert.equal(new Set(cards.map((card) => card.ficha_v6)).size, 4);
  const rows = quietMap([jpy, gbp, eur, chf]);
  assert.deepEqual(rows.map((row) => row.currency), [...RISK_CURRENCIES]);
  for (const currency of ['JPY', 'GBP', 'EUR', 'CHF']) expectQuiet(rows.find((row) => row.currency === currency));
});

test('sustituye «empleo y PMI mueven el Agente»: nóminas e ISM son A5, no inflación', () => {
  const payrolls = headline('US payrolls beat ACTUAL 250 FORECAST 160', ['USD'], { actual: '250', forecast: '160' });
  const ism = headline('US ISM services PMI jumps above 52, expansion', ['USD'], { actual: '56.0', forecast: '52.0' });
  const jobs = expectFicha(payrolls, 'USD', { ficha: 'A5', lens: 'EXPANSION_REAL_A5', category: 'Inflacion_Empleo', impact: 4 });
  const pmi = expectFicha(ism, 'USD', { ficha: 'A5', lens: 'EXPANSION_REAL_A5', category: 'Inflacion_Empleo', impact: 4 });
  assert.notEqual(jobs.mmt_lens, 'INFLATION_PRINT');
  assert.notEqual(pmi.mmt_lens, 'INFLATION_PRINT');
  expectQuiet(quietMap([payrolls, ism]).find((row) => row.currency === 'USD'));
});

test('sustituye «NFA y comercio puntúan»: distribución fiscal y acuerdo EA-1', () => {
  const nfa = headline('SNB profit distribution to Confederation and cantons', ['CHF'], {
    source_type: 'oficial', category: 'banco_central',
  });
  const trade = headline('Switzerland and Vietnam strengthen ties in trade, new agreement on digital trade', ['CHF'], { category: 'analisis' });
  expectFicha(nfa, 'CHF', { ficha: 'A12 / B10 / C3', lens: 'FLUJO_FISCAL_NFA', category: 'BC', impact: 4 });
  expectFicha(trade, 'CHF', { ficha: 'EA-1', lens: 'TOT_COMMODITIES_EA1', category: 'BC', impact: 4 });
  expectQuiet(quietMap([nfa, trade]).find((row) => row.currency === 'CHF'));
});

test('sustituye «desempleo y ventas mueven el score»: ventas B2 y paro laboral B2', () => {
  const retail = headline('Canada retail sales miss ACTUAL -0.4 FORECAST 0.3', ['CAD'], { actual: '-0.4', forecast: '0.3' });
  const unemployment = headline('Canada unemployment ACTUAL 7.1% FORECAST 6.6%', ['CAD'], { actual: '7.1', forecast: '6.6' });
  expectFicha(retail, 'CAD', { ficha: 'B2', lens: 'CONTRACCION_REAL', category: 'Inflacion_Empleo', impact: 4 });
  expectFicha(unemployment, 'CAD', { ficha: 'B2', lens: 'CONTRACCION_LABORAL_B2', category: 'Inflacion_Empleo', impact: 4 });
  const cad = quietMap([retail, unemployment]).find((row) => row.currency === 'CAD');
  expectQuiet(cad);
});

test('sustituye «Baker Hughes y TIPS no son dato real ni Imp 3h»: ficha operativa, no A5', () => {
  const baker = headline('US BAKER HUGHES OIL RIG COUNT ACTUAL 460 (FORECAST -, PREVIOUS 459)', ['USD'], {
    actual: '460', previous: '459',
  });
  const tips = headline('US 5-YEAR TIPS HIGH YIELD ACTUAL 2.367% (FORECAST -, PREVIOUS 1.955%)', ['USD'], {
    actual: '2.367%', previous: '1.955%',
  });
  const bakerCard = expectFicha(baker, 'USD', { ficha: 'A12 / B10 / C3', lens: 'FLUJO_FISCAL_NFA', category: 'Commodities_ToT', impact: 4 });
  const tipsCard = expectFicha(tips, 'USD', { ficha: 'A12 / B10 / C3', lens: 'FLUJO_FISCAL_NFA', category: 'Inflacion_Empleo', impact: 4 });
  assert.notEqual(bakerCard.ficha_v6, 'A5');
  assert.notEqual(tipsCard.mmt_lens, 'EXPANSION_REAL_A5');
  assert.notEqual(tipsCard.mmt_lens, 'CONTRACCION_REAL');
  const usd = quietMap([baker, tips]).find((row) => row.currency === 'USD');
  expectQuiet(usd);
  assert.equal(Object.hasOwn(usd, 'impulse'), false);
});
