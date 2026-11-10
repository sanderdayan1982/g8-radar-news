/**
 * Mapa de riesgo de evento (RADAR v5.1 Parte E).
 * Describe peligro de evento: sin score, sin puesto y sin dirección.
 * Umbrales congelados el 10-nov-2026 (PRE-REG): TIER1 a ≤ 24 h es ALTO;
 * |Δ24h| ≥ 10 pp es ALTO; desde 5 pp y por debajo de 10 es MEDIO;
 * un Δ nulo no aporta; EA-4 en 24 h sube JPY o CHF; el silencio sube
 * un nivel solo si el candado no es NINGUNO.
 * XAU hereda los mercados que lo exponen. No tiene agenda, ni EA-4, ni silencio.
 */
import { computeCalendarLock } from './classifyCurrencies.js';
import { lockSeverityIndex } from './lockSeverity.js';

export const RISK_CURRENCIES = Object.freeze([
  'USD', 'EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD', 'NZD', 'XAU',
]);

/** 28 pares + XAUUSD, en el orden fijo de la Parte E. */
export const RISK_PAIRS = Object.freeze([
  ['EURUSD', 'EUR', 'USD'],
  ['GBPUSD', 'GBP', 'USD'],
  ['USDJPY', 'USD', 'JPY'],
  ['USDCHF', 'USD', 'CHF'],
  ['USDCAD', 'USD', 'CAD'],
  ['AUDUSD', 'AUD', 'USD'],
  ['NZDUSD', 'NZD', 'USD'],
  ['EURGBP', 'EUR', 'GBP'],
  ['EURJPY', 'EUR', 'JPY'],
  ['EURCHF', 'EUR', 'CHF'],
  ['EURCAD', 'EUR', 'CAD'],
  ['EURAUD', 'EUR', 'AUD'],
  ['EURNZD', 'EUR', 'NZD'],
  ['GBPJPY', 'GBP', 'JPY'],
  ['GBPCHF', 'GBP', 'CHF'],
  ['GBPCAD', 'GBP', 'CAD'],
  ['GBPAUD', 'GBP', 'AUD'],
  ['GBPNZD', 'GBP', 'NZD'],
  ['AUDJPY', 'AUD', 'JPY'],
  ['AUDCHF', 'AUD', 'CHF'],
  ['AUDCAD', 'AUD', 'CAD'],
  ['AUDNZD', 'AUD', 'NZD'],
  ['NZDJPY', 'NZD', 'JPY'],
  ['NZDCHF', 'NZD', 'CHF'],
  ['NZDCAD', 'NZD', 'CAD'],
  ['CADJPY', 'CAD', 'JPY'],
  ['CADCHF', 'CAD', 'CHF'],
  ['CHFJPY', 'CHF', 'JPY'],
  ['XAUUSD', 'XAU', 'USD'],
]);

export const POLY_ALTO_PP = 10;
export const POLY_MEDIO_PP = 5;
export const TIER1_ALTO_H = 24;
export const EA4_WINDOW_H = 24;
export const EA4_WINDOW_MS = EA4_WINDOW_H * 3_600_000;

export const RISK_REASONS = Object.freeze({
  decision: 'decisión de tipos',
  budget: 'presupuesto',
  tier1Near: 'dato de primer nivel en 24 h',
  tier1Far: 'dato de primer nivel entre 24 y 48 h',
  speech: 'discurso',
  aviso: 'evento de alto impacto',
  ea4: 'intervención en 24 h',
  silence: 'silencio con evento',
});

const EA4_CATEGORY = 'Intervencion_EA4';
const EA4_CURRENCIES = new Set(['JPY', 'CHF']);
const RISK_RANK = Object.freeze({ BAJO: 0, MEDIO: 1, ALTO: 2 });
const LEVEL_UP = Object.freeze({ BAJO: 'MEDIO', MEDIO: 'ALTO', ALTO: 'ALTO' });

function itemCategory(item) {
  if (item?.iris_category) return item.iris_category;
  if (item?.category_iris) return item.category_iris;
  return item?.category || '';
}

function deltaPp(value) {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function raise(current, next) {
  return (RISK_RANK[next] || 0) > (RISK_RANK[current] || 0) ? next : current;
}

function maxRisk(a, b) {
  return (RISK_RANK[a] || 0) >= (RISK_RANK[b] || 0) ? a : b;
}

function stricterLock(a, b) {
  return lockSeverityIndex(a) <= lockSeverityIndex(b) ? a : b;
}

function dedupe(list) {
  const out = [];
  const seen = new Set();
  for (const item of list) {
    if (!item || seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

function formatPp(delta) {
  const rounded = Math.round(Math.abs(delta) * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function polyReason(market, delta) {
  const theme = /^[A-Z0-9_]+$/.test(String(market?.theme || '')) ? market.theme : 'tema';
  return `geopolítica ${theme} ${formatPp(delta)} pp`;
}

function ea4Currencies(items, nowMs) {
  const hit = new Set();
  for (const item of items || []) {
    if (itemCategory(item) !== EA4_CATEGORY) continue;
    const ms = Date.parse(item?.published_at || '');
    if (!Number.isFinite(ms)) continue;
    const age = nowMs - ms;
    if (age < 0 || age > EA4_WINDOW_MS) continue;
    for (const currency of item.currencies || item.divisas || []) {
      if (EA4_CURRENCIES.has(currency)) hit.add(currency);
    }
  }
  return hit;
}

function emptyLock() {
  return { lock_level: 'NINGUNO', lock_events: [], retirar_limitadas: false };
}

function publishLock(currency, calendarEvents, nowMs) {
  if (currency === 'XAU') return emptyLock();
  const lock = computeCalendarLock(currency, calendarEvents, nowMs);
  return {
    lock_level: lock.lock_level || 'NINGUNO',
    retirar_limitadas: lock.retirar_limitadas === true,
    lock_events: (lock.lock_events || []).map((event) => ({
      lock_class: event.lock_class,
      title: event.title,
      time: event.time,
      hours_until: event.hours_until,
      retirar_limitadas: event.retirar_limitadas === true,
    })),
  };
}

function marketsFor(block, currency) {
  const markets = Array.isArray(block?.markets) ? block.markets : [];
  return markets.filter((market) => Array.isArray(market?.currencies) && market.currencies.includes(currency));
}

function currencyRow(currency, { coverage, calendarEvents, ea4Hit, polymarketGeo, nowMs }) {
  const lock = publishLock(currency, calendarEvents, nowMs);
  const exposing = marketsFor(polymarketGeo, currency);
  const silence = currency !== 'XAU' && coverage?.[currency]?.silence === true;
  const ea4 = ea4Hit.has(currency);
  let level = 'BAJO';
  const reasons = [];

  if (lock.lock_level === 'TOTAL') {
    level = 'ALTO';
    if (lock.lock_events.some((event) => event.lock_class === 'DECISION_BC')) reasons.push(RISK_REASONS.decision);
    if (lock.lock_events.some((event) => event.lock_class === 'PRESUPUESTO')) reasons.push(RISK_REASONS.budget);
  }

  const tier1 = lock.lock_events.filter((event) => event.lock_class === 'TIER1_DATO' && Number.isFinite(event.hours_until));
  if (tier1.some((event) => event.hours_until <= TIER1_ALTO_H)) {
    level = 'ALTO';
    reasons.push(RISK_REASONS.tier1Near);
  } else if (tier1.length) {
    level = raise(level, 'MEDIO');
    reasons.push(RISK_REASONS.tier1Far);
  }

  if (ea4) {
    level = 'ALTO';
    reasons.push(RISK_REASONS.ea4);
  }

  const polymarket = [];
  for (const market of exposing) {
    const delta = deltaPp(market.d24h_pp);
    polymarket.push({
      theme: market.theme,
      question: market.question ?? '',
      d24h_pp: delta,
    });
    if (delta == null) continue;
    const abs = Math.abs(delta);
    if (abs >= POLY_ALTO_PP) {
      level = 'ALTO';
      reasons.push(polyReason(market, delta));
    } else if (abs >= POLY_MEDIO_PP) {
      level = raise(level, 'MEDIO');
      reasons.push(polyReason(market, delta));
    }
  }

  if (lock.lock_level === 'NO_AMPLIAR') {
    level = raise(level, 'MEDIO');
    reasons.push(RISK_REASONS.speech);
  } else if (lock.lock_level === 'AVISO') {
    level = raise(level, 'MEDIO');
    reasons.push(RISK_REASONS.aviso);
  }

  if (silence && lock.lock_level !== 'NINGUNO') {
    level = LEVEL_UP[level] || level;
    reasons.push(RISK_REASONS.silence);
  }

  const row = {
    currency,
    risk_level: level,
    lock_level: lock.lock_level,
    lock_events: lock.lock_events,
    retirar_limitadas: lock.retirar_limitadas,
  };
  if (currency !== 'XAU') row.silence = silence;
  row.polymarket = polymarket;
  row.ea4_24h = ea4;
  row.reasons = dedupe(reasons);
  return row;
}

export function buildRiskMap({
  coverage = {},
  calendarEvents = [],
  items = [],
  polymarketGeo = null,
  nowMs = Date.now(),
} = {}) {
  const ea4Hit = ea4Currencies(items, nowMs);
  return RISK_CURRENCIES.map((currency) => currencyRow(currency, {
    coverage,
    calendarEvents,
    ea4Hit,
    polymarketGeo,
    nowMs,
  }));
}

export function buildPairRisk(riskMap) {
  const by = new Map((riskMap || []).map((row) => [row.currency, row]));
  return RISK_PAIRS.map(([pair, base, quote]) => {
    const left = by.get(base);
    const right = by.get(quote);
    return {
      pair,
      risk_level: maxRisk(left?.risk_level || 'BAJO', right?.risk_level || 'BAJO'),
      lock_level: stricterLock(left?.lock_level || 'NINGUNO', right?.lock_level || 'NINGUNO'),
      legs: { base, quote },
      reasons: dedupe([...(left?.reasons || []), ...(right?.reasons || [])]),
    };
  });
}
