import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { classifyIrisItem } from '../src/irisCollector.js';
import {
  EA4_WINDOW_H,
  POLY_ALTO_PP,
  POLY_MEDIO_PP,
  RISK_CURRENCIES,
  RISK_PAIRS,
  RISK_REASONS,
  TIER1_ALTO_H,
  buildPairRisk,
  buildRiskMap,
} from '../src/riskMap.js';

const NOW = Date.parse('2026-11-10T12:00:00.000Z');
const H = 3_600_000;
const G8 = ['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD', 'NZD'];
const FORBIDDEN = /\blong\b|\bshort\b|sesgo largo|sesgo corto|vía libre operativa|\bcompra\b|\bvende\b|subirá|bajará/i;
const RANKING_KEYS = ['score', 'rank', 'bias', 'impulse', 'structural'];

function at(offsetMs) {
  return new Date(NOW + offsetMs).toISOString();
}

function event({ title, impact = null, offsetMs, currency = 'USD' }) {
  return {
    id: `${currency}-${title}-${offsetMs}`,
    currency,
    title,
    impact,
    event_at: at(offsetMs),
  };
}

function coverage(flags = {}) {
  const out = {};
  for (const currency of G8) out[currency] = { silence: flags[currency] === true };
  out.XAU = { hours_since_last_business: 40 };
  return out;
}

function map(extra = {}) {
  return buildRiskMap({
    coverage: extra.coverage || coverage(),
    calendarEvents: extra.calendarEvents || [],
    items: extra.items || [],
    polymarketGeo: extra.polymarketGeo || { status: 'OK', markets: [] },
    nowMs: extra.nowMs || NOW,
  });
}

function row(rows, currency) {
  return rows.find((item) => item.currency === currency);
}

function market(theme, d24h, currencies, question = 'Will the event happen?') {
  return {
    theme,
    event_title: theme,
    question,
    prob: 40,
    d24h_pp: d24h,
    volume: 300_000,
    liquidity: 40_000,
    currencies,
  };
}

function expectNoRanking(value) {
  const json = JSON.stringify(value);
  for (const key of RANKING_KEYS) assert.equal(json.includes(`"${key}"`), false, key);
  assert.doesNotMatch(json, FORBIDDEN);
  assert.doesNotMatch(json, /Soporte|Presión|alcista|bajista/);
}

test('umbrales congelados del pre-registro', () => {
  assert.equal(POLY_ALTO_PP, 10);
  assert.equal(POLY_MEDIO_PP, 5);
  assert.equal(TIER1_ALTO_H, 24);
  assert.equal(EA4_WINDOW_H, 24);
  assert.equal(RISK_REASONS.silence, 'silencio con evento');
});

test('DECISION_BC a 30 h → ALTO', () => {
  const rows = map({
    calendarEvents: [event({ title: 'Federal Funds Rate', offsetMs: 30 * H })],
  });
  const usd = row(rows, 'USD');
  assert.equal(usd.risk_level, 'ALTO');
  assert.equal(usd.lock_level, 'TOTAL');
  assert.equal(usd.retirar_limitadas, false);
  assert.ok(usd.reasons.includes(RISK_REASONS.decision));
  assert.equal(row(rows, 'EUR').risk_level, 'BAJO');
  expectNoRanking(rows);
});

test('DISCURSO a 10 h → MEDIO (impacto Medium)', () => {
  const rows = map({
    calendarEvents: [event({
      title: 'ECB President Lagarde Speaks',
      impact: 'Medium',
      offsetMs: 10 * H,
      currency: 'EUR',
    })],
  });
  const eur = row(rows, 'EUR');
  assert.equal(eur.risk_level, 'MEDIO');
  assert.equal(eur.lock_level, 'NO_AMPLIAR');
  assert.equal(eur.retirar_limitadas, false);
  assert.deepEqual(eur.reasons, [RISK_REASONS.speech]);
  expectNoRanking(eur);
});

test('DISCURSO de impacto Medium a 1,5 h sigue en MEDIO y marca retirar limitadas', () => {
  const rows = map({
    calendarEvents: [event({
      title: 'ECB President Lagarde Speaks',
      impact: 'Medium',
      offsetMs: 1.5 * H,
      currency: 'EUR',
    })],
  });
  const eur = row(rows, 'EUR');
  assert.equal(eur.risk_level, 'MEDIO');
  assert.equal(eur.lock_level, 'NO_AMPLIAR');
  assert.equal(eur.retirar_limitadas, true);
  assert.equal(eur.lock_events[0].retirar_limitadas, true);
});

test('DISCURSO de impacto Low a 10 h → BAJO', () => {
  const rows = map({
    calendarEvents: [event({
      title: 'FOMC Member Bowman Speaks',
      impact: 'Low',
      offsetMs: 10 * H,
    })],
    coverage: coverage({ USD: true }),
  });
  const usd = row(rows, 'USD');
  assert.equal(usd.risk_level, 'BAJO');
  assert.equal(usd.lock_level, 'NINGUNO');
  assert.equal(usd.retirar_limitadas, false);
  assert.equal(usd.silence, true);
  assert.deepEqual(usd.reasons, []);
});

test('TIER1 a 20 h → ALTO', () => {
  const rows = map({
    calendarEvents: [event({ title: 'GDP m/m', impact: 'High', offsetMs: 20 * H, currency: 'GBP' })],
  });
  const gbp = row(rows, 'GBP');
  assert.equal(gbp.risk_level, 'ALTO');
  assert.equal(gbp.lock_level, 'TIER1');
  assert.deepEqual(gbp.reasons, [RISK_REASONS.tier1Near]);
});

test('TIER1 a 30 h → MEDIO', () => {
  const rows = map({
    calendarEvents: [event({ title: 'CPI y/y', impact: 'High', offsetMs: 30 * H, currency: 'CAD' })],
  });
  const cad = row(rows, 'CAD');
  assert.equal(cad.risk_level, 'MEDIO');
  assert.equal(cad.lock_level, 'TIER1');
  assert.deepEqual(cad.reasons, [RISK_REASONS.tier1Far]);
});

test('TIER1 en el borde de 24 h es ALTO y justo después es MEDIO; a 49 h es BAJO', () => {
  const near = map({
    calendarEvents: [event({ title: 'Retail Sales', impact: 'High', offsetMs: 24 * H, currency: 'AUD' })],
  });
  assert.equal(row(near, 'AUD').risk_level, 'ALTO');
  assert.equal(row(near, 'AUD').lock_events[0].hours_until, 24);

  const far = map({
    calendarEvents: [event({ title: 'Retail Sales', impact: 'High', offsetMs: 24 * H + 6 * 60_000, currency: 'AUD' })],
  });
  assert.equal(row(far, 'AUD').risk_level, 'MEDIO');
  assert.equal(row(far, 'AUD').lock_events[0].hours_until, 24.1);

  const outside = map({
    calendarEvents: [event({ title: 'Retail Sales', impact: 'High', offsetMs: 49 * H, currency: 'AUD' })],
  });
  assert.equal(row(outside, 'AUD').risk_level, 'BAJO');
  assert.equal(row(outside, 'AUD').lock_level, 'NINGUNO');
});

test('AVISO a 10 h → MEDIO', () => {
  const rows = map({
    calendarEvents: [event({ title: 'ISM Services PMI', impact: 'High', offsetMs: 10 * H })],
  });
  const usd = row(rows, 'USD');
  assert.equal(usd.risk_level, 'MEDIO');
  assert.equal(usd.lock_level, 'AVISO');
  assert.deepEqual(usd.reasons, [RISK_REASONS.aviso]);
});

test('nada → BAJO', () => {
  const rows = map();
  assert.deepEqual(rows.map((item) => item.currency), [...RISK_CURRENCIES]);
  for (const item of rows) {
    assert.equal(item.risk_level, 'BAJO');
    assert.equal(item.lock_level, 'NINGUNO');
    assert.deepEqual(item.reasons, []);
    assert.equal(item.ea4_24h, false);
    if (item.currency === 'XAU') assert.equal(Object.hasOwn(item, 'silence'), false);
    else assert.equal(item.silence, false);
  }
  expectNoRanking(rows);
});

test('nada + silencio → BAJO (el silencio solo no sube)', () => {
  const flags = Object.fromEntries(G8.map((currency) => [currency, true]));
  const rows = map({ coverage: coverage(flags) });
  for (const currency of G8) {
    const item = row(rows, currency);
    assert.equal(item.silence, true);
    assert.equal(item.risk_level, 'BAJO');
    assert.equal(item.lock_level, 'NINGUNO');
    assert.deepEqual(item.reasons, []);
  }
  assert.equal(Object.hasOwn(row(rows, 'XAU'), 'silence'), false);
  assert.equal(row(rows, 'XAU').risk_level, 'BAJO');
});

test('DISCURSO + silencio → ALTO (impacto Medium)', () => {
  const rows = map({
    calendarEvents: [event({
      title: 'BOJ Governor Ueda Speaks',
      impact: 'Medium',
      offsetMs: 10 * H,
      currency: 'JPY',
    })],
    coverage: coverage({ JPY: true }),
  });
  const jpy = row(rows, 'JPY');
  assert.equal(jpy.risk_level, 'ALTO');
  assert.equal(jpy.lock_level, 'NO_AMPLIAR');
  assert.deepEqual(jpy.reasons, [RISK_REASONS.speech, RISK_REASONS.silence]);
  assert.equal(row(rows, 'USD').risk_level, 'BAJO');
});

test('el silencio sube un solo nivel y ALTO no pasa de ALTO', () => {
  const rows = map({
    calendarEvents: [event({ title: 'Federal Funds Rate', offsetMs: 30 * H })],
    coverage: coverage({ USD: true }),
  });
  const usd = row(rows, 'USD');
  assert.equal(usd.risk_level, 'ALTO');
  assert.ok(usd.reasons.includes(RISK_REASONS.decision));
  assert.ok(usd.reasons.includes(RISK_REASONS.silence));
  assert.equal(usd.reasons.filter((reason) => reason === RISK_REASONS.silence).length, 1);
});

test('el mapa usa coverage.silence y no recalcula las horas', () => {
  const quietFlag = coverage();
  quietFlag.EUR.silence = false;
  quietFlag.EUR.hours_since_last_business = 100;
  const quiet = map({
    coverage: quietFlag,
    calendarEvents: [event({
      title: 'ECB President Lagarde Speaks',
      impact: 'High',
      offsetMs: 10 * H,
      currency: 'EUR',
    })],
  });
  assert.equal(row(quiet, 'EUR').risk_level, 'MEDIO');
  assert.equal(row(quiet, 'EUR').reasons.includes(RISK_REASONS.silence), false);

  const loudFlag = coverage();
  loudFlag.EUR.silence = true;
  loudFlag.EUR.hours_since_last_business = 1;
  const loud = map({
    coverage: loudFlag,
    calendarEvents: [event({
      title: 'ECB President Lagarde Speaks',
      impact: 'High',
      offsetMs: 10 * H,
      currency: 'EUR',
    })],
  });
  assert.equal(row(loud, 'EUR').risk_level, 'ALTO');
  assert.ok(row(loud, 'EUR').reasons.includes(RISK_REASONS.silence));
});

test('Polymarket +12 pp en IRAN → ALTO en USD, CHF, JPY, CAD, EUR y XAU', () => {
  const rows = map({
    polymarketGeo: {
      status: 'OK',
      markets: [market('IRAN_ORIENTE_MEDIO', 12, ['USD', 'CHF', 'JPY', 'CAD', 'EUR', 'XAU'])],
    },
  });
  for (const currency of ['USD', 'CHF', 'JPY', 'CAD', 'EUR', 'XAU']) {
    const item = row(rows, currency);
    assert.equal(item.risk_level, 'ALTO', currency);
    assert.equal(item.polymarket[0].d24h_pp, 12);
    assert.equal(item.polymarket[0].theme, 'IRAN_ORIENTE_MEDIO');
    assert.ok(item.reasons.includes('geopolítica IRAN_ORIENTE_MEDIO 12 pp'));
  }
  for (const currency of ['GBP', 'AUD', 'NZD']) assert.equal(row(rows, currency).risk_level, 'BAJO', currency);
  expectNoRanking(rows);
});

test('−7 pp en RUSIA → MEDIO en EUR, CHF, GBP y XAU', () => {
  const rows = map({
    polymarketGeo: {
      status: 'OK',
      markets: [market('RUSIA_UCRANIA', -7, ['EUR', 'CHF', 'GBP', 'XAU'])],
    },
  });
  for (const currency of ['EUR', 'CHF', 'GBP', 'XAU']) {
    const item = row(rows, currency);
    assert.equal(item.risk_level, 'MEDIO', currency);
    assert.equal(item.polymarket[0].d24h_pp, -7);
    assert.ok(item.reasons.includes('geopolítica RUSIA_UCRANIA 7 pp'), item.reasons.join(' | '));
    assert.doesNotMatch(item.reasons.join(' '), /sube|baja|-/);
  }
  for (const currency of ['USD', 'JPY', 'CAD', 'AUD', 'NZD']) {
    assert.equal(row(rows, currency).risk_level, 'BAJO', currency);
  }
});

test('d24h_pp null no aporta; 10 pp es ALTO, 5 pp es MEDIO y por debajo de 5 no sube', () => {
  const level = (d24h) => row(map({
    polymarketGeo: { markets: [market('WASHINGTON', d24h, ['USD', 'XAU'])] },
  }), 'USD').risk_level;
  assert.equal(level(null), 'BAJO');
  assert.equal(level(undefined), 'BAJO');
  assert.equal(level(10), 'ALTO');
  assert.equal(level(-10), 'ALTO');
  assert.equal(level(5), 'MEDIO');
  assert.equal(level(-5), 'MEDIO');
  assert.equal(level(9.9), 'MEDIO');
  assert.equal(level(4.9), 'BAJO');
  assert.equal(level(0), 'BAJO');

  const exposed = row(map({
    polymarketGeo: { status: 'STALE', markets: [market('WASHINGTON', null, ['USD', 'XAU'])] },
  }), 'USD');
  assert.equal(exposed.risk_level, 'BAJO');
  assert.equal(exposed.polymarket.length, 1);
  assert.equal(exposed.polymarket[0].d24h_pp, null);
  assert.deepEqual(exposed.reasons, []);
});

test('EA-4 en 24 h → ALTO JPY', () => {
  const jpyItem = classifyIrisItem({
    title: 'Japan MOF rate check on the yen',
    published_at: new Date(NOW - 2 * H).toISOString(),
    url: 'https://example.com/ea4-jpy',
  });
  const chfItem = classifyIrisItem({
    title: 'SNB intervention sight deposits',
    published_at: new Date(NOW - 3 * H).toISOString(),
    url: 'https://example.com/ea4-chf',
  });
  assert.equal(jpyItem.iris_category, 'Intervencion_EA4');
  assert.equal(chfItem.iris_category, 'Intervencion_EA4');
  assert.ok(jpyItem.currencies.includes('JPY'));
  assert.ok(chfItem.currencies.includes('CHF'));

  const rows = map({ items: [jpyItem, chfItem] });
  assert.equal(row(rows, 'JPY').risk_level, 'ALTO');
  assert.equal(row(rows, 'JPY').ea4_24h, true);
  assert.ok(row(rows, 'JPY').reasons.includes(RISK_REASONS.ea4));
  assert.equal(row(rows, 'CHF').risk_level, 'ALTO');
  assert.equal(row(rows, 'CHF').ea4_24h, true);
  for (const currency of ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'NZD', 'XAU']) {
    assert.equal(row(rows, currency).ea4_24h, false, currency);
    assert.equal(row(rows, currency).risk_level, 'BAJO', currency);
  }
});

test('EA-4 fuera de 24 h no sube, y un titular EA-4 no sube XAU', () => {
  const fresh = {
    title: 'MOF rate check while gold holds',
    published_at: new Date(NOW - 24 * H).toISOString(),
    currencies: ['JPY', 'XAU'],
    iris_category: 'Intervencion_EA4',
  };
  const stale = {
    title: 'MOF rate check on the yen',
    published_at: new Date(NOW - 24 * H - 1).toISOString(),
    currencies: ['JPY'],
    iris_category: 'Intervencion_EA4',
  };
  const future = {
    title: 'MOF rate check on the yen later',
    published_at: new Date(NOW + H).toISOString(),
    currencies: ['JPY'],
    iris_category: 'Intervencion_EA4',
  };
  const onEdge = map({ items: [fresh] });
  assert.equal(row(onEdge, 'JPY').risk_level, 'ALTO');
  assert.equal(row(onEdge, 'JPY').ea4_24h, true);
  assert.equal(row(onEdge, 'XAU').risk_level, 'BAJO');
  assert.equal(row(onEdge, 'XAU').ea4_24h, false);
  assert.equal(Object.hasOwn(row(onEdge, 'XAU'), 'silence'), false);

  const old = map({ items: [stale, future] });
  assert.equal(row(old, 'JPY').risk_level, 'BAJO');
  assert.equal(row(old, 'JPY').ea4_24h, false);
});

test('XAU no hereda agenda ni silencio; XAUUSD sí hereda el candado USD', () => {
  const rows = map({
    calendarEvents: [
      event({ title: 'Federal Funds Rate', offsetMs: 30 * H, currency: 'USD' }),
      event({ title: 'Gold Fix', impact: 'High', offsetMs: 5 * H, currency: 'XAU' }),
    ],
    coverage: coverage({ USD: true }),
  });
  const xau = row(rows, 'XAU');
  assert.equal(xau.risk_level, 'BAJO');
  assert.equal(xau.lock_level, 'NINGUNO');
  assert.deepEqual(xau.lock_events, []);
  assert.equal(xau.ea4_24h, false);
  assert.equal(Object.hasOwn(xau, 'silence'), false);
  const pair = buildPairRisk(rows).find((item) => item.pair === 'XAUUSD');
  assert.equal(pair.risk_level, 'ALTO');
  assert.equal(pair.lock_level, 'TOTAL');
  assert.deepEqual(pair.legs, { base: 'XAU', quote: 'USD' });
});

test('par EURUSD con EUR BAJO y USD ALTO → ALTO', () => {
  const rows = map({
    calendarEvents: [event({ title: 'Federal Funds Rate', offsetMs: 30 * H, currency: 'USD' })],
  });
  assert.equal(row(rows, 'EUR').risk_level, 'BAJO');
  assert.equal(row(rows, 'USD').risk_level, 'ALTO');
  const pairs = buildPairRisk(rows);
  const eurUsd = pairs.find((item) => item.pair === 'EURUSD');
  assert.equal(eurUsd.risk_level, 'ALTO');
  assert.equal(eurUsd.lock_level, 'TOTAL');
  assert.deepEqual(eurUsd.legs, { base: 'EUR', quote: 'USD' });
  assert.deepEqual(eurUsd.reasons, [RISK_REASONS.decision]);
  expectNoRanking(pairs);
});

test('risk_map en orden fijo aunque los niveles cambien', () => {
  const rows = map({
    calendarEvents: [event({
      title: 'Official Cash Rate',
      offsetMs: 12 * H,
      currency: 'NZD',
    })],
  });
  assert.deepEqual(rows.map((item) => item.currency), [...RISK_CURRENCIES]);
  assert.equal(row(rows, 'USD').risk_level, 'BAJO');
  assert.equal(row(rows, 'NZD').risk_level, 'ALTO');
  assert.equal(row(rows, 'NZD').lock_level, 'TOTAL');
  const pairs = buildPairRisk(rows);
  assert.deepEqual(pairs.map((item) => item.pair), RISK_PAIRS.map(([pair]) => pair));
  assert.equal(pairs.length, 29);
  assert.equal(pairs.find((item) => item.pair === 'NZDUSD').risk_level, 'ALTO');
  assert.equal(pairs.find((item) => item.pair === 'NZDUSD').lock_level, 'TOTAL');
  assert.equal(pairs.find((item) => item.pair === 'EURGBP').risk_level, 'BAJO');
  assert.equal(pairs.find((item) => item.pair === 'EURGBP').lock_level, 'NINGUNO');
});

test('el colector y la función live dejan de publicar el ranking', () => {
  const collector = readFileSync(new URL('../src/irisCollector.js', import.meta.url), 'utf8');
  const live = readFileSync(new URL('../netlify/functions/radar_live.mjs', import.meta.url), 'utf8');
  const workflow = readFileSync(new URL('../.github/workflows/update_radar_news.yml', import.meta.url), 'utf8');
  assert.match(collector, /buildRiskMap/);
  assert.match(collector, /buildPairRisk/);
  assert.match(collector, /risk_map/);
  assert.match(collector, /pair_risk/);
  assert.match(collector, /llm_calls: 0/);
  assert.match(collector, /iris-g8-feed\/v2-mmt-v4\.0/);
  assert.match(collector, /classifyItemMmtV4/);
  assert.doesNotMatch(collector, /v3-risk/);
  assert.doesNotMatch(collector, /currency_ranking_mmt/);
  assert.doesNotMatch(collector, /g8_ranking/);
  assert.doesNotMatch(collector, /classifyAgent\(/);
  assert.doesNotMatch(collector, /scoreSignals\(/);
  assert.doesNotMatch(collector, /rankingAlerts\(/);
  assert.doesNotMatch(collector, /classifyAgentShadow\(/);
  assert.doesNotMatch(live, /classifyAgent\(/);
  assert.doesNotMatch(live, /scoreSignals\(/);
  assert.doesNotMatch(live, /rankingAlerts\(/);
  assert.doesNotMatch(live, /classifyAgentShadow\(/);
  assert.match(workflow, /test\/risk_map\.test\.js/);
  assert.equal(readFileSync(new URL('../src/shadowCalibration.js', import.meta.url), 'utf8').includes('export function classifyAgentShadow'), true);
  assert.equal(readFileSync(new URL('../src/calibrationEval.js', import.meta.url), 'utf8').length > 0, true);
});
