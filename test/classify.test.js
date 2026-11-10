import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RISK_CURRENCIES, RISK_REASONS, buildRiskMap } from '../src/riskMap.js';

/**
 * Parte E. Las pruebas de ranking de este archivo pasan a ser pruebas del mapa.
 * El clasificador de titulares (classifyIrisItem / classifyItemMmtV4) sigue en
 * test/iris_serverless.test.js y no se toca aquí.
 */
const NOW = Date.parse('2026-10-24T00:00:00.000Z');
const RANKING_KEYS = ['score', 'rank', 'bias', 'impulse', 'structural'];
const FORBIDDEN = /\blong\b|\bshort\b|sesgo largo|sesgo corto|vía libre operativa|\bcompra\b|\bvende\b|subirá|bajará|Soporte|Presión|alcista|bajista/i;

function item(title, currencies, minsAgo = 30, extra = {}) {
  return {
    title,
    currencies,
    published_at: new Date(NOW - minsAgo * 60_000).toISOString(),
    ...extra,
  };
}

function bare(items = [], extra = {}) {
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
    ...extra,
  });
}

function expectQuiet(row) {
  assert.equal(row.risk_level, 'BAJO');
  assert.equal(row.lock_level, 'NINGUNO');
  assert.deepEqual(row.reasons, []);
  for (const key of RANKING_KEYS) assert.equal(Object.hasOwn(row, key), false, key);
  assert.doesNotMatch(JSON.stringify(row), FORBIDDEN);
}

test('sustituye «CPI alto con economía débil no suma soporte»: el titular no sube el mapa', () => {
  const gbp = bare([
    item('UK CPI ACTUAL 3.8% FORECAST 3.2% PREVIOUS 3.1%', ['GBP']),
    item('UK retail sales miss: contraction, weak economy', ['GBP']),
    item('UK PMI services falls below 50, slowdown', ['GBP']),
  ]).find((row) => row.currency === 'GBP');
  expectQuiet(gbp);
});

test('sustituye «CPI alto con economía en capacidad queda acotado»: el dato real no asigna nivel', () => {
  const usd = bare([
    item('US CPI ACTUAL 3.4% FORECAST 3.1%', ['USD']),
    item('US payrolls beat, hot labor market expansion', ['USD']),
    item('US PMI jumps above 52, strong growth', ['USD']),
  ]).find((row) => row.currency === 'USD');
  expectQuiet(usd);
});

test('sustituye «déficit de un emisor soberano no es presión automática»: USD y GBP quedan BAJO', () => {
  const rows = bare([
    item('UK deficit cannot afford spending, downgrade fears', ['GBP']),
    item('US deficit cannot afford spending, downgrade fears', ['USD']),
  ]);
  expectQuiet(rows.find((row) => row.currency === 'GBP'));
  expectQuiet(rows.find((row) => row.currency === 'USD'));
});

test('sustituye «el EUR es usuario de moneda»: el déficit del EUR no puntúa el mapa', () => {
  const eur = bare([
    item('France deficit cannot afford spending, downgrade fears', ['EUR']),
  ]).find((row) => row.currency === 'EUR');
  expectQuiet(eur);
});

test('sustituye «hike en régimen débil no es soporte»: un titular de hike no es candado', () => {
  const gbp = bare([
    item('BoE hike as stagflation unsustainable economy persists', ['GBP']),
    item('UK CPI ACTUAL 4.1% FORECAST 3.5% weak economy', ['GBP']),
    item('UK PMI contracts below 50, recession fears', ['GBP']),
  ]).find((row) => row.currency === 'GBP');
  expectQuiet(gbp);
});

test('sustituye «does not hike se trata como negación»: el titular no mueve el nivel', () => {
  const usd = bare([
    item("Fed doesn't hike, holds rates", ['USD']),
  ]).find((row) => row.currency === 'USD');
  expectQuiet(usd);
});

test('sustituye «desempleo invertido»: el dato no invierte ni ordena el mapa', () => {
  const usd = bare([
    item('US unemployment ACTUAL 4.5% FORECAST 4.1%', ['USD']),
  ]).find((row) => row.currency === 'USD');
  expectQuiet(usd);
});

test('sustituye «oficial de hace 20 días sigue en ventana»: EA-4 de hace 20 días no sube', () => {
  const rows = bare([
    item('Updates to the October Monetary Policy Review', ['NZD'], 20 * 24 * 60),
    item('MOF rate check on the yen', ['JPY'], 20 * 24 * 60, { iris_category: 'Intervencion_EA4' }),
  ]);
  expectQuiet(rows.find((row) => row.currency === 'NZD'));
  expectQuiet(rows.find((row) => row.currency === 'JPY'));
  assert.equal(rows.find((row) => row.currency === 'JPY').ea4_24h, false);
});

test('sustituye «titular oficial cuenta como evidencia aunque el score sea 0»: sin EA-4 queda BAJO y sin puesto', () => {
  const nzd = bare([
    item('Updates to the October Monetary Policy Review', ['NZD']),
  ]).find((row) => row.currency === 'NZD');
  expectQuiet(nzd);
  assert.equal(Object.hasOwn(nzd, 'rank'), false);
});

test('sustituye «sin titulares: N/D, score 0, rank null»: todo el mapa queda BAJO y sin alerta de régimen', () => {
  const rows = bare([item('US payrolls beat ACTUAL 250 FORECAST 160', ['USD'])]);
  expectQuiet(rows.find((row) => row.currency === 'CHF'));
  expectQuiet(rows.find((row) => row.currency === 'NZD'));
  assert.equal(JSON.stringify(rows).includes('cambio_regimen'), false);
  for (const key of RANKING_KEYS) assert.equal(JSON.stringify(rows).includes(`"${key}"`), false);
});

test('sustituye «refugio geopolítico»: el titular no parte USD/JPY/CHF de NZD', () => {
  const rows = bare([
    item('Missile attack closes Hormuz, war risk', ['USD', 'JPY', 'CHF', 'NZD']),
  ]);
  const levels = ['USD', 'JPY', 'CHF', 'NZD'].map((currency) => rows.find((row) => row.currency === currency).risk_level);
  assert.deepEqual(levels, ['BAJO', 'BAJO', 'BAJO', 'BAJO']);
  for (const currency of ['USD', 'JPY', 'CHF', 'NZD']) {
    expectQuiet(rows.find((row) => row.currency === currency));
  }
});

test('sustituye «máximo 3 drivers y sesgo por umbral ±12»: muchos titulares no crean sesgo', () => {
  const items = Array.from({ length: 8 }, (_, i) => item(
    `US payrolls beat ACTUAL ${200 + i} FORECAST 100`,
    ['USD'],
    10 + i,
  ));
  const usd = bare(items).find((row) => row.currency === 'USD');
  expectQuiet(usd);
  assert.equal(Object.hasOwn(usd, 'bias'), false);
});

test('sustituye «prompt Mosler veta lenguaje de ejecución»: las razones del mapa no lo usan', () => {
  const rows = buildRiskMap({
    nowMs: NOW,
    coverage: { USD: { silence: true }, EUR: { silence: false }, GBP: { silence: false }, JPY: { silence: true }, CHF: { silence: false }, CAD: { silence: false }, AUD: { silence: false }, NZD: { silence: false } },
    calendarEvents: [
      { id: 'ff', currency: 'USD', title: 'Federal Funds Rate', impact: 'High', event_at: new Date(NOW + 30 * 3_600_000).toISOString() },
      { id: 'speech', currency: 'EUR', title: 'ECB President Lagarde Speaks', impact: 'Medium', event_at: new Date(NOW + 10 * 3_600_000).toISOString() },
      { id: 'cpi', currency: 'GBP', title: 'CPI y/y', impact: 'High', event_at: new Date(NOW + 30 * 3_600_000).toISOString() },
      { id: 'ism', currency: 'CAD', title: 'ISM Services PMI', impact: 'High', event_at: new Date(NOW + 8 * 3_600_000).toISOString() },
      { id: 'budget', currency: 'AUD', title: 'Annual Budget Release', impact: 'High', event_at: new Date(NOW + 20 * 3_600_000).toISOString() },
      { id: 'nzd', currency: 'NZD', title: 'Retail Sales', impact: 'High', event_at: new Date(NOW + 6 * 3_600_000).toISOString() },
    ],
    items: [item('Japan MOF rate check on the yen', ['JPY'], 60, { iris_category: 'Intervencion_EA4' })],
    polymarketGeo: {
      markets: [{
        theme: 'IRAN_ORIENTE_MEDIO',
        question: 'Will the event happen?',
        d24h_pp: 12,
        currencies: ['USD', 'CHF', 'JPY', 'CAD', 'EUR', 'XAU'],
      }],
    },
  });
  const reasons = rows.flatMap((row) => row.reasons);
  for (const phrase of Object.values(RISK_REASONS)) assert.ok(reasons.includes(phrase), phrase);
  assert.doesNotMatch(reasons.join('\n'), FORBIDDEN);
  for (const row of rows) {
    for (const key of RANKING_KEYS) assert.equal(Object.hasOwn(row, key), false);
  }
});

test('sustituye «inflación + tightening no queda en CPI 0»: el titular del BoJ no es EA-4 ni candado', () => {
  const jpy = bare([
    item('September inflation keeps BoJ on tightening course', ['JPY']),
  ]).find((row) => row.currency === 'JPY');
  expectQuiet(jpy);
  assert.equal(jpy.ea4_24h, false);
});

test('sustituye «oficial hawkish de hace 20 días todavía puntúa»: ya no sube el mapa', () => {
  const nzd = bare([
    item('RBNZ MPS: OCR remains restrictive, inflation persistent', ['NZD'], 20 * 24 * 60),
  ]).find((row) => row.currency === 'NZD');
  expectQuiet(nzd);
});

test('sustituye «FOMC restrictive no es Neutral 0»: el titular sin agenda queda BAJO', () => {
  const usd = bare([
    item('FOMC statement: Committee remains vigilant, policy restrictive', ['USD']),
  ]).find((row) => row.currency === 'USD');
  expectQuiet(usd);
});

test('sustituye «colapso de confianza es presión y NFA es soporte»: ninguno mueve el nivel', () => {
  const rows = bare([
    item('Relentless cost of living pressures behind collapse of consumer confidence', ['GBP']),
    item('SNB profit distribution to Confederation and cantons', ['CHF']),
  ]);
  expectQuiet(rows.find((row) => row.currency === 'GBP'));
  expectQuiet(rows.find((row) => row.currency === 'CHF'));
});

test('sustituye «el Agente diferencia divisas»: el mapa no las ordena por evidencia', () => {
  const rows = bare([
    item('BoJ on tightening course as inflation persists', ['JPY']),
    item('UK consumer confidence collapses under cost of living pressures', ['GBP']),
    item('France deficit cannot afford spending, downgrade fears', ['EUR']),
    item('SECO raises growth forecast, revisión al alza del crecimiento', ['CHF']),
  ]);
  assert.deepEqual(rows.map((row) => row.currency), [...RISK_CURRENCIES]);
  for (const currency of ['JPY', 'GBP', 'EUR', 'CHF']) {
    expectQuiet(rows.find((row) => row.currency === currency));
  }
  assert.equal(new Set(rows.map((row) => row.risk_level)).size, 1);
});

test('sustituye «empleo y PMI mueven el Agente»: sin candado TIER1 quedan BAJO', () => {
  const usd = bare([
    item('US payrolls beat ACTUAL 250 FORECAST 160', ['USD']),
    item('US ISM services PMI jumps above 52, expansion', ['USD']),
  ]).find((row) => row.currency === 'USD');
  expectQuiet(usd);
});

test('sustituye «NFA y comercio puntúan»: no crean nivel ni dirección', () => {
  const chf = bare([
    item('SNB profit distribution to Confederation and cantons', ['CHF']),
    item('Switzerland and Vietnam strengthen ties in trade, new agreement on digital trade', ['CHF']),
  ]).find((row) => row.currency === 'CHF');
  expectQuiet(chf);
});

test('sustituye «desempleo y ventas mueven el score»: CAD queda BAJO', () => {
  const cad = bare([
    item('Canada retail sales miss ACTUAL -0.4 FORECAST 0.3', ['CAD']),
    item('Canada unemployment ACTUAL 7.1% FORECAST 6.6%', ['CAD']),
  ]).find((row) => row.currency === 'CAD');
  expectQuiet(cad);
});

test('sustituye «Baker Hughes y TIPS no son dato real ni Imp 3h»: el mapa no publica impulso', () => {
  const usd = bare([
    item('US BAKER HUGHES OIL RIG COUNT ACTUAL 460 (FORECAST -, PREVIOUS 459)', ['USD']),
    item('US 5-YEAR TIPS HIGH YIELD ACTUAL 2.367% (FORECAST -, PREVIOUS 1.955%)', ['USD']),
  ]).find((row) => row.currency === 'USD');
  expectQuiet(usd);
  assert.equal(Object.hasOwn(usd, 'impulse'), false);
});
