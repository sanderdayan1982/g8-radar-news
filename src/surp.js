/**
 * FAMILIAS-01 fase 2, módulo M3 (Sander, 16-nov-2026). Índice de sorpresa
 * macro en sombra. Con SURP_PUBLISH distinto de "true" no hay bloque nuevo,
 * ni archivo, ni línea de log. El CSV diario va a g8-macro-data y solo si
 * hay un token de escritura de ese repo. Sin token no se escribe nada.
 * surpriseZ de enrich.js no se usa: el z de titular sigue ordenando titulares.
 */
import { CURRENCIES } from './config.js';
import { INVERTED, parseNumber } from './enrich.js';
import { RISK_PAIRS } from './riskMap.js';

export const SURP_SPEC = Object.freeze({
  module: 'FAMILIAS-01',
  phase: 2,
  part: 'M3',
  signedBy: 'Sander',
  signedOn: '2026-11-16',
  mode: 'SHADOW',
  publishFlag: 'SURP_PUBLISH',
  publishDefault: false,
  zClip: 3,
  halfLifeDays: 10,
  maxAgeDays: 90,
  sigmaMinReleases: 12,
  sigmaWindow: 24,
  provisionalSigmaFloor: 0.15,
  provisionalSigmaFraction: 0.04,
  provisionalSigmaWhenForecastZero: 0.2,
  weights: Object.freeze({
    LABOUR: 1,
    CLAIMS: 1,
    CPI: 1,
    PCE: 1,
    GDP: 0.7,
    RETAIL_SALES: 0.7,
    PMI: 0.7,
    ISM: 0.7,
    INDUSTRIAL_PRODUCTION: 0.7,
    PPI: 0.4,
    TRADE: 0.4,
    CONSUMER_CONFIDENCE: 0.4,
    REST: 0.4,
  }),
  excludedCategories: Object.freeze(['MONETARY_POLICY', 'RATE']),
  beatEnterPct: 80,
  beatExitPct: 70,
  missEnterPct: 20,
  missExitPct: 30,
  confirmCloses: 2,
  pctWindow: 252,
  unavailableBelowCloses: 60,
  turnLagSessions: 5,
  turnAbsPercentile: 80,
  closeHourWat: 23,
  closeMinuteWat: 0,
  watZone: 'Africa/Malabo',
  watOffsetHours: 1,
  sessions: 'Mon-Fri',
  livenessDays: 30,
  staleHours: 6,
  invertedSource: 'INVERTED',
  destinationRepo: 'sanderdayan1982/g8-macro-data',
  destinationPath: 'surp_daily.csv',
  writerDisabledLog: 'SURP writer disabled',
  tokenEnv: 'G8_DATA_WRITE',
});

const DAY_MS = 86400000;
const HOUR_MS = 3600000;
const WAT_OFFSET_MS = SURP_SPEC.watOffsetHours * HOUR_MS;
const CSV_HEADER = [
  'close_at', 'ccy', 'surp', 'surp_rel', 'surp_pct', 'surp_d5',
  'surp_state', 'surp_turn', 'surp_prov', 'n_rel_30d', 'surp_reason',
];

const RATE_RE = /\b(fed(?:eral)? funds|funds rate|fund rate|interest rate|policy rate|bank rate|cash rate|official cash rate|\bocr\b|base rate|discount rate|target rate|refi(?:nance)? rate|deposit facility rate|main refinancing rate)\b/i;
const POLICY_RE = /\b(monetary policy|rate decision|rate statement|fomc|cash rate decision)\b/i;
const CLAIMS_RE = /\b(jobless claims|initial claims|continuing claims|unemployment claims)\b|\bclaims\b/i;
const PCE_RE = /\bpce\b|personal consumption/i;
const PPI_RE = /\bppi\b|producer price|\bwpi\b|wholesale price/i;
const CPI_RE = /\bcpi\b|\bipc\b|consumer price/i;
const GDP_RE = /\bgdp\b|\bpib\b/i;
const RETAIL_RE = /\bretail sales\b/i;
const ISM_RE = /\bism\b/i;
const PMI_RE = /\bpmi\b|purchasing managers/i;
const IP_RE = /\bindustrial production\b/i;
const LABOUR_RE = /\b(unemployment|payrolls?|non-?farm|\bnfp\b|employment)\b/i;
const TRADE_RE = /\b(trade balance|current account)\b/i;
const CONF_RE = /\b(consumer confidence|ifo|zew|michigan)\b/i;
const MONTH = 'january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec';

const PLACE_CCY = Object.freeze({
  es: 'EUR', de: 'EUR', fr: 'EUR', it: 'EUR', ez: 'EUR',
  nl: 'EUR', be: 'EUR', at: 'EUR', pt: 'EUR', ie: 'EUR', gr: 'EUR', fi: 'EUR',
  sk: 'EUR', si: 'EUR', ee: 'EUR', lv: 'EUR', lt: 'EUR', lu: 'EUR', mt: 'EUR', cy: 'EUR', hr: 'EUR',
  us: 'USD', gb: 'GBP', jp: 'JPY', ch: 'CHF', ca: 'CAD', au: 'AUD', nz: 'NZD',
});

const NAMES = Object.freeze({
  spain: 'es', es: 'es', espana: 'es',
  germany: 'de', de: 'de', deutschland: 'de',
  france: 'fr', fr: 'fr',
  italy: 'it', it: 'it',
  eurozone: 'ez', eu: 'ez', eur: 'ez', ez: 'ez', emu: 'ez',
  'euro area': 'ez', 'euro zone': 'ez',
  'united states': 'us', usa: 'us', us: 'us', usd: 'us',
  'united kingdom': 'gb', uk: 'gb', gb: 'gb', gbp: 'gb', britain: 'gb',
  japan: 'jp', jp: 'jp', jpy: 'jp',
  switzerland: 'ch', ch: 'ch', chf: 'ch',
  canada: 'ca', ca: 'ca', cad: 'ca',
  australia: 'au', au: 'au', aud: 'au',
  'new zealand': 'nz', nz: 'nz', nzd: 'nz',
  netherlands: 'nl', nl: 'nl', holland: 'nl',
  belgium: 'be', be: 'be',
  austria: 'at', at: 'at',
  portugal: 'pt', pt: 'pt',
  ireland: 'ie', ie: 'ie',
  greece: 'gr', gr: 'gr',
  finland: 'fi', fi: 'fi',
});

const TITLE_PLACES = [
  [/\b(spanish|spain)\b/i, 'es'],
  [/\b(german|germany)\b/i, 'de'],
  [/\b(french|france)\b/i, 'fr'],
  [/\b(ital(?:y|ian))\b/i, 'it'],
  [/\b(dutch|netherlands)\b/i, 'nl'],
  [/\b(belgian|belgium)\b/i, 'be'],
  [/\b(austrian|austria)\b/i, 'at'],
  [/\b(portuguese|portugal)\b/i, 'pt'],
  [/\b(irish|ireland)\b/i, 'ie'],
  [/\b(greek|greece)\b/i, 'gr'],
  [/\b(finnish|finland)\b/i, 'fi'],
  [/\b(eurozone|euro area|euro zone)\b/i, 'ez'],
];

const EZ_KEEP = new Set(['de', 'ez']);

const SURP_PAIRS = RISK_PAIRS.filter(([, base, quote]) => CURRENCIES.includes(base) && CURRENCIES.includes(quote));

export function surpPublishEnabled(env = process.env) {
  return env?.[SURP_SPEC.publishFlag] === 'true';
}

export function provisionalSigma(forecast) {
  const magnitude = Math.abs(Number(forecast));
  const scaled = magnitude * SURP_SPEC.provisionalSigmaFraction;
  const base = scaled > 0 ? scaled : SURP_SPEC.provisionalSigmaWhenForecastZero;
  return Math.max(SURP_SPEC.provisionalSigmaFloor, base);
}

/** Desviación del conjunto observado (divisor n), no una estimación muestral. */
export function populationStdev(values) {
  const n = values.length;
  if (n < 1) return null;
  let sum = 0;
  for (const value of values) sum += value;
  const mean = sum / n;
  let acc = 0;
  for (const value of values) {
    const delta = value - mean;
    acc += delta * delta;
  }
  return Math.sqrt(acc / n);
}

export function guardActual(actual, title) {
  const text = String(title || '');
  const dayMatch = new RegExp(`\\b(?:${MONTH})\\.?\\s+(\\d{1,2})\\b`, 'i').exec(text);
  const pctMatch = /(-?\d+(?:\.\d+)?)\s*%/.exec(text);
  const raw = parseNumber(actual);
  if (!dayMatch || !pctMatch || raw == null) return actual;
  const day = Number(dayMatch[1]);
  const pct = Number(pctMatch[1]);
  if (raw === day && pct !== day) return String(pct);
  return actual;
}

function classifyTitle(title) {
  const text = String(title || '');
  if (RATE_RE.test(text)) return { category: 'RATE', weight: null, include: false };
  if (POLICY_RE.test(text)) return { category: 'MONETARY_POLICY', weight: null, include: false };
  const table = [
    ['CLAIMS', CLAIMS_RE],
    ['PCE', PCE_RE],
    ['PPI', PPI_RE],
    ['CPI', CPI_RE],
    ['GDP', GDP_RE],
    ['RETAIL_SALES', RETAIL_RE],
    ['ISM', ISM_RE],
    ['PMI', PMI_RE],
    ['INDUSTRIAL_PRODUCTION', IP_RE],
    ['LABOUR', LABOUR_RE],
    ['TRADE', TRADE_RE],
    ['CONSUMER_CONFIDENCE', CONF_RE],
  ];
  for (const [category, re] of table) {
    if (re.test(text)) {
      return { category, weight: SURP_SPEC.weights[category], include: true };
    }
  }
  return { category: 'OTHER', weight: SURP_SPEC.weights.REST, include: true };
}

function placeFromTitle(title) {
  const text = String(title || '');
  for (const [re, place] of TITLE_PLACES) {
    if (re.test(text)) return place;
  }
  return null;
}

function resolvePlace(release) {
  const field = String(release?.country ?? release?.currency ?? '').trim().toLowerCase();
  let place = Object.prototype.hasOwnProperty.call(NAMES, field) ? NAMES[field] : null;
  const fromTitle = placeFromTitle(release?.title || release?.indicator || '');
  if (place == null) place = fromTitle;
  else if (place === 'ez' && fromTitle && fromTitle !== 'ez') place = fromTitle;
  const ccy = place ? PLACE_CCY[place] || null : null;
  return { place, ccy };
}

function variantOf(title) {
  const text = String(title || '').toLowerCase();
  let period = 'na';
  if (/\b(m\/m|mom)\b/.test(text)) period = 'mm';
  else if (/\b(y\/y|yoy)\b/.test(text)) period = 'yy';
  else if (/\b(q\/q|qoq)\b/.test(text)) period = 'qq';
  const core = /\b(core|trimmed|median|ex food|ex energy|ex-food|ex-energy)\b/.test(text) ? 'core' : 'head';
  return `${core}|${period}`;
}

function eurozoneAllowed(place, ccy) {
  if (ccy !== 'EUR') return true;
  if (place == null || EZ_KEEP.has(place)) return true;
  return false;
}

export function prepareRelease(raw) {
  const { place, ccy } = resolvePlace(raw);
  if (!ccy || !CURRENCIES.includes(ccy)) return null;
  const title = String(raw?.title || raw?.indicator || '');
  const guarded = guardActual(raw?.actual, title);
  const actual = parseNumber(guarded);
  const forecast = parseNumber(raw?.forecast);
  const cls = classifyTitle(title);
  const timeMs = Date.parse(raw?.release_at || raw?.event_at || '');
  const surprise = actual != null && forecast != null ? actual - forecast : null;
  const include = cls.include && eurozoneAllowed(place, ccy) && surprise != null && Number.isFinite(timeMs);
  return {
    id: raw?.id || `${place}|${title}|${Number.isFinite(timeMs) ? timeMs : 'na'}`,
    corrects: raw?.corrects || null,
    title,
    place,
    ccy,
    category: cls.category,
    indicator: cls.category,
    actual,
    forecast,
    release_at: Number.isFinite(timeMs) ? new Date(timeMs).toISOString() : null,
    timeMs,
    surprise,
    weight: cls.weight,
    include,
    seriesKey: `${place}|${cls.category}|${variantOf(title)}`,
  };
}

// previous is the indicator's earlier surprises only. The release being scored is not included.
function sigmaOf(previous, forecast) {
  if (previous.length < SURP_SPEC.sigmaMinReleases) {
    return { sigma: provisionalSigma(forecast), sigma_prov: true };
  }
  const start = Math.max(0, previous.length - SURP_SPEC.sigmaWindow);
  return { sigma: populationStdev(previous.slice(start)), sigma_prov: false };
}

function zOf(surprise, sigma, title) {
  if (!Number.isFinite(surprise) || !Number.isFinite(sigma)) return null;
  const oriented = INVERTED.test(title) ? -surprise : surprise;
  if (sigma === 0) {
    if (oriented === 0) return 0;
    return oriented > 0 ? SURP_SPEC.zClip : -SURP_SPEC.zClip;
  }
  let z = oriented / sigma;
  if (!Number.isFinite(z)) return null;
  if (z > SURP_SPEC.zClip) return SURP_SPEC.zClip;
  if (z < -SURP_SPEC.zClip) return -SURP_SPEC.zClip;
  return z;
}

export function scoreReleases(releases) {
  const prepared = [];
  for (const raw of releases || []) {
    const row = prepareRelease(raw);
    if (row) prepared.push(row);
  }
  prepared.sort((a, b) => a.timeMs - b.timeMs || String(a.seriesKey).localeCompare(String(b.seriesKey)));
  const history = new Map();
  for (const row of prepared) {
    const list = history.get(row.seriesKey) || [];
    if (row.corrects) {
      const idx = list.findIndex((item) => item.id === row.corrects);
      if (idx >= 0) list.splice(idx, 1);
    }
    if (!row.include) {
      row.sigma = null;
      row.sigma_prov = false;
      row.z = null;
      history.set(row.seriesKey, list);
      continue;
    }
    const scored = sigmaOf(list.map((item) => item.surprise), row.forecast);
    row.sigma = scored.sigma;
    row.sigma_prov = scored.sigma_prov;
    row.z = zOf(row.surprise, scored.sigma, row.title);
    list.push({ id: row.id, surprise: row.surprise });
    history.set(row.seriesKey, list);
  }
  return prepared;
}

function groupScored(scored, closeMs) {
  const visible = scored.filter((row) => Number.isFinite(row.timeMs) && row.timeMs <= closeMs);
  const corrected = new Set();
  for (const row of visible) {
    if (row.corrects) corrected.add(row.corrects);
  }
  const open = visible.filter((row) => !corrected.has(row.id));
  const map = new Map();
  for (const row of open) {
    if (!row.include || !Number.isFinite(row.z)) continue;
    const key = `${row.place}|${row.category}|${row.timeMs}`;
    let group = map.get(key);
    if (!group) {
      group = {
        ccy: row.ccy,
        weight: row.weight,
        timeMs: row.timeMs,
        zs: [],
        sigma_prov: false,
      };
      map.set(key, group);
    }
    group.zs.push(row.z);
    if (row.sigma_prov) group.sigma_prov = true;
  }
  const groups = [];
  for (const group of map.values()) {
    let sum = 0;
    for (const z of group.zs) sum += z;
    groups.push({ ...group, z: sum / group.zs.length });
  }
  return groups;
}

function decay(ageDays) {
  return 2 ** (-ageDays / SURP_SPEC.halfLifeDays);
}

function indexFor(groups, ccy, closeMs) {
  let n30 = 0;
  let sum = 0;
  let used = 0;
  let sigmaProv = false;
  for (const group of groups) {
    if (group.ccy !== ccy) continue;
    const age = (closeMs - group.timeMs) / DAY_MS;
    if (age < 0 || age > SURP_SPEC.maxAgeDays) continue;
    if (age <= SURP_SPEC.livenessDays) n30 += 1;
    if (!Number.isFinite(group.z) || group.weight == null) continue;
    sum += group.weight * group.z * decay(age);
    used += 1;
    if (group.sigma_prov) sigmaProv = true;
  }
  if (n30 === 0 || used === 0) {
    return { surp: 'UNAVAILABLE', n_rel_30d: n30, sigma_prov: false };
  }
  return { surp: sum, n_rel_30d: n30, sigma_prov: sigmaProv };
}

function watParts(utcMs) {
  const shifted = new Date(utcMs + WAT_OFFSET_MS);
  return {
    y: shifted.getUTCFullYear(),
    m: shifted.getUTCMonth(),
    d: shifted.getUTCDate(),
    dow: shifted.getUTCDay(),
  };
}

function watCloseUtc(y, m, d) {
  return Date.UTC(y, m, d, SURP_SPEC.closeHourWat - SURP_SPEC.watOffsetHours, SURP_SPEC.closeMinuteWat, 0, 0);
}

function isWeekendMs(utcMs) {
  const dow = watParts(utcMs).dow;
  return dow === 0 || dow === 6;
}

export function closeAnchorForInstant(instant) {
  const ms = typeof instant === 'number' ? instant : Date.parse(instant);
  const parts = watParts(ms);
  let anchor = watCloseUtc(parts.y, parts.m, parts.d);
  if (ms > anchor) anchor += DAY_MS;
  while (isWeekendMs(anchor)) anchor += DAY_MS;
  return anchor;
}

export function sessionCloseForRelease(releaseAt) {
  return new Date(closeAnchorForInstant(releaseAt)).toISOString();
}

export function latestCompletedClose(instant) {
  const ms = typeof instant === 'number' ? instant : Date.parse(instant);
  const parts = watParts(ms);
  let anchor = watCloseUtc(parts.y, parts.m, parts.d);
  if (ms < anchor) anchor -= DAY_MS;
  while (isWeekendMs(anchor)) anchor -= DAY_MS;
  return anchor;
}

export function previousClose(closeMs) {
  let anchor = closeMs - DAY_MS;
  while (isWeekendMs(anchor)) anchor -= DAY_MS;
  return anchor;
}

function nextClose(closeMs) {
  let anchor = closeMs + DAY_MS;
  while (isWeekendMs(anchor)) anchor += DAY_MS;
  return anchor;
}

export function percentileRank(values) {
  const n = values.length;
  if (!n) return null;
  const current = values[n - 1];
  if (!Number.isFinite(current)) return null;
  let le = 0;
  for (const value of values) {
    if (value <= current) le += 1;
  }
  return (100 * le) / n;
}

export function percentileInc(values, p) {
  const sorted = values.filter((value) => Number.isFinite(value)).slice().sort((a, b) => a - b);
  const n = sorted.length;
  if (!n) return null;
  if (n === 1) return sorted[0];
  const rank = (n - 1) * p;
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo];
  const weight = rank - lo;
  return sorted[lo] * (1 - weight) + sorted[hi] * weight;
}

export function hysteresisStates(pctSeries) {
  const need = SURP_SPEC.confirmCloses;
  let state = 'NEUTRO';
  let beatIn = 0;
  let beatOut = 0;
  let missIn = 0;
  let missOut = 0;
  const out = [];
  for (const pct of pctSeries) {
    if (pct == null || !Number.isFinite(pct)) {
      beatIn = 0;
      beatOut = 0;
      missIn = 0;
      missOut = 0;
      state = 'NEUTRO';
      out.push(null);
      continue;
    }
    beatIn = pct >= SURP_SPEC.beatEnterPct ? beatIn + 1 : 0;
    beatOut = pct < SURP_SPEC.beatExitPct ? beatOut + 1 : 0;
    missIn = pct <= SURP_SPEC.missEnterPct ? missIn + 1 : 0;
    missOut = pct > SURP_SPEC.missExitPct ? missOut + 1 : 0;
    if (state === 'BEAT') {
      if (beatOut >= need && missIn >= need) state = 'MISS';
      else if (beatOut >= need) state = 'NEUTRO';
    } else if (state === 'MISS') {
      if (missOut >= need && beatIn >= need) state = 'BEAT';
      else if (missOut >= need) state = 'NEUTRO';
    } else if (beatIn >= need) state = 'BEAT';
    else if (missIn >= need) state = 'MISS';
    out.push(state);
  }
  return out;
}

export function annotateTurns(surps) {
  const absWindow = [];
  const out = [];
  for (let i = 0; i < surps.length; i += 1) {
    const current = surps[i];
    const previous = i >= SURP_SPEC.turnLagSessions ? surps[i - SURP_SPEC.turnLagSessions] : null;
    if (typeof current !== 'number' || typeof previous !== 'number') {
      out.push({ d5: null, turn: null });
      continue;
    }
    const d5 = current - previous;
    absWindow.push(Math.abs(d5));
    const sample = absWindow.slice(-SURP_SPEC.pctWindow);
    const threshold = percentileInc(sample, SURP_SPEC.turnAbsPercentile / 100);
    const changed = Math.sign(current) !== Math.sign(previous);
    out.push({
      d5,
      turn: changed && threshold != null && Math.abs(d5) >= threshold,
    });
  }
  return out;
}

function rowReason(row) {
  if (row?.surp_reason) return row.surp_reason;
  if (row?.reason) return row.reason;
  return typeof row?.surp === 'number' ? 'ok' : 'no_release_30d';
}

function trusted(row) {
  return rowReason(row) !== 'stale' && typeof row?.surp === 'number';
}

function walkSeries(series) {
  const pctSeries = [];
  for (let i = 0; i < series.length; i += 1) {
    const row = series[i];
    if (!trusted(row)) {
      pctSeries.push(null);
      continue;
    }
    const windowRows = series.slice(Math.max(0, i + 1 - SURP_SPEC.pctWindow), i + 1);
    const numeric = [];
    for (const item of windowRows) {
      if (trusted(item)) numeric.push(item.surp);
    }
    if (numeric.length < SURP_SPEC.unavailableBelowCloses) pctSeries.push(null);
    else pctSeries.push(percentileRank(numeric));
  }
  return { pctSeries, states: hysteresisStates(pctSeries) };
}

function countWindow(series) {
  const windowRows = series.slice(-SURP_SPEC.pctWindow);
  let n = 0;
  for (const row of windowRows) {
    if (trusted(row)) n += 1;
  }
  return n;
}

function updateIsStale(closeMs, stamp) {
  const at = Date.parse(stamp ?? '');
  if (!Number.isFinite(at)) return true;
  const lag = closeMs - at;
  if (lag > SURP_SPEC.staleHours * HOUR_MS) return true;
  if (at - closeMs > SURP_SPEC.staleHours * HOUR_MS) return true;
  return false;
}

function isStaleClose(closeMs, loopUpdatedAt, sourceUpdatedAt) {
  return updateIsStale(closeMs, loopUpdatedAt) || updateIsStale(closeMs, sourceUpdatedAt);
}

function blankRow(closeAt, ccy) {
  return {
    close_at: closeAt,
    ccy,
    surp: 'UNAVAILABLE',
    surp_rel: 'UNAVAILABLE',
    surp_pct: null,
    surp_d5: null,
    surp_state: null,
    surp_turn: null,
    surp_prov: false,
    n_rel_30d: 0,
    surp_reason: 'no_release_30d',
  };
}

export function computeClose({
  releases,
  closeAt,
  priorRows = [],
  loopUpdatedAt,
  sourceUpdatedAt,
} = {}) {
  const closeMs = typeof closeAt === 'number' ? closeAt : Date.parse(closeAt);
  const closeIso = new Date(closeMs).toISOString();
  const stale = isStaleClose(closeMs, loopUpdatedAt, sourceUpdatedAt);
  const groups = groupScored(scoreReleases(releases), closeMs);
  const byCcy = {};
  for (const ccy of CURRENCIES) byCcy[ccy] = indexFor(groups, ccy, closeMs);

  const rows = CURRENCIES.map((ccy) => {
    const info = byCcy[ccy];
    const prior = (priorRows || [])
      .filter((row) => row && row.ccy === ccy && Date.parse(row.close_at) < closeMs)
      .slice()
      .sort((a, b) => Date.parse(a.close_at) - Date.parse(b.close_at));
    const surpValue = info.surp === 'UNAVAILABLE' ? null : info.surp;
    const draftReason = stale ? 'stale' : (info.surp === 'UNAVAILABLE' ? 'no_release_30d' : 'ok');
    const today = { close_at: closeIso, ccy, surp: surpValue, surp_reason: draftReason };
    const series = prior.concat([today]);
    const n = countWindow(series);
    const walked = walkSeries(series);
    const turns = annotateTurns(series.map((row) => (trusted(row) ? row.surp : null)));
    const lastTurn = turns[turns.length - 1] || { d5: null, turn: null };
    const row = blankRow(closeIso, ccy);
    row.n_rel_30d = info.n_rel_30d;
    if (info.surp === 'UNAVAILABLE') {
      row.surp = 'UNAVAILABLE';
      row.surp_reason = stale ? 'stale' : 'no_release_30d';
      return row;
    }
    row.surp = info.surp;
    if (stale) {
      row.surp_reason = 'stale';
      return row;
    }
    row.surp_d5 = lastTurn.d5;
    row.surp_turn = lastTurn.turn;
    if (n < SURP_SPEC.unavailableBelowCloses) {
      row.surp_pct = 'UNAVAILABLE';
      row.surp_state = 'UNAVAILABLE';
      row.surp_prov = info.sigma_prov === true;
      row.surp_reason = 'short_window';
      return row;
    }
    row.surp_pct = walked.pctSeries[walked.pctSeries.length - 1];
    row.surp_state = walked.states[walked.states.length - 1];
    const windowProv = n < SURP_SPEC.pctWindow;
    row.surp_prov = info.sigma_prov === true || windowProv;
    row.surp_reason = row.surp_prov ? 'provisional' : 'ok';
    return row;
  });

  const available = [];
  for (const row of rows) {
    if (typeof row.surp === 'number') available.push(row.surp);
  }
  const mean = available.length
    ? available.reduce((sum, value) => sum + value, 0) / available.length
    : null;
  for (const row of rows) {
    row.surp_rel = typeof row.surp === 'number' && mean != null ? row.surp - mean : 'UNAVAILABLE';
  }
  const pairs = {};
  for (const [name, base, quote] of SURP_PAIRS) {
    const left = rows.find((row) => row.ccy === base);
    const right = rows.find((row) => row.ccy === quote);
    pairs[name] = typeof left?.surp === 'number' && typeof right?.surp === 'number'
      ? left.surp - right.surp
      : 'UNAVAILABLE';
  }
  const currencies = {};
  for (const row of rows) currencies[row.ccy] = { ...row };
  return {
    rows,
    block: {
      close_at: closeIso,
      currencies,
      pairs,
    },
  };
}

export function appendCloses(archive, rows) {
  const next = (archive || []).slice();
  const seen = new Set(next.map((row) => `${row.close_at}|${row.ccy}`));
  for (const row of rows || []) {
    const key = `${row.close_at}|${row.ccy}`;
    if (seen.has(key)) continue;
    next.push({ ...row });
    seen.add(key);
  }
  return next;
}

function csvCell(value) {
  if (value == null) return '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  return String(value);
}

export function renderCsv(rows, { header = true } = {}) {
  const lines = [];
  if (header) lines.push(CSV_HEADER.join(','));
  for (const row of rows || []) {
    lines.push(CSV_HEADER.map((key) => csvCell(row[key])).join(','));
  }
  return lines.length ? `${lines.join('\n')}\n` : '';
}

function parseCell(key, value) {
  if (value == null || value === '') return null;
  if (key === 'ccy' || key === 'close_at' || key === 'surp_reason' || key === 'surp_state') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'UNAVAILABLE') return 'UNAVAILABLE';
  const num = Number(value);
  return Number.isFinite(num) ? num : value;
}

export function parseCsv(text) {
  const lines = String(text || '').split(/\r?\n/).filter((line) => line.trim() !== '');
  if (!lines.length) return [];
  const header = lines[0].split(',');
  const start = header[0] === 'close_at' ? 1 : 0;
  const keys = header[0] === 'close_at' ? header : CSV_HEADER;
  const rows = [];
  for (const line of lines.slice(start)) {
    const cells = line.split(',');
    const row = {};
    for (let i = 0; i < keys.length; i += 1) row[keys[i]] = parseCell(keys[i], cells[i] ?? '');
    if (row.close_at && row.ccy) rows.push(row);
  }
  return rows;
}

export function appendCsvText(prior, rows) {
  const existing = parseCsv(prior);
  const merged = appendCloses(existing, rows);
  const added = merged.slice(existing.length);
  if (!added.length) return prior ? String(prior) : '';
  const chunk = renderCsv(added, { header: !prior });
  if (!prior) return chunk;
  const base = String(prior).endsWith('\n') ? String(prior) : `${prior}\n`;
  return base + renderCsv(added, { header: false });
}

function dueCloses(priorRows, now) {
  const latest = latestCompletedClose(now);
  const stamps = (priorRows || []).map((row) => Date.parse(row.close_at)).filter(Number.isFinite);
  if (!stamps.length) return [latest];
  const last = Math.max(...stamps);
  const out = [];
  let cursor = nextClose(last);
  while (cursor <= latest) {
    out.push(cursor);
    cursor = nextClose(cursor);
  }
  return out;
}

function contentsUrl() {
  return `https://api.github.com/repos/${SURP_SPEC.destinationRepo}/contents/${SURP_SPEC.destinationPath}`;
}

function githubHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
    'User-Agent': 'g8-radar-news',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

async function readRemoteCsv(token, fetchImpl) {
  const res = await fetchImpl(contentsUrl(), { headers: githubHeaders(token) });
  if (res.status === 404) return { text: '', sha: null, missing: true };
  if (!res.ok) return { error: true };
  const body = await res.json();
  const encoded = String(body?.content || '').replace(/\s+/g, '');
  return {
    text: encoded ? Buffer.from(encoded, 'base64').toString('utf8') : '',
    sha: body?.sha || null,
    missing: false,
  };
}

async function writeRemoteCsv(token, fetchImpl, sha, text) {
  const payload = {
    message: 'chore(surp): append daily close [skip netlify]',
    content: Buffer.from(text, 'utf8').toString('base64'),
  };
  if (sha) payload.sha = sha;
  const res = await fetchImpl(contentsUrl(), {
    method: 'PUT',
    headers: githubHeaders(token),
    body: JSON.stringify(payload),
  });
  return res.ok === true;
}

export async function runSurpCycle({
  events = [],
  now,
  loopUpdatedAt,
  sourceUpdatedAt,
  env = process.env,
  fetchImpl = fetch,
  priorText = null,
} = {}) {
  if (!surpPublishEnabled(env)) return null;
  const token = env?.[SURP_SPEC.tokenEnv] || '';
  let remote = { text: priorText || '', sha: null, missing: priorText == null };
  if (!token) {
    console.log(SURP_SPEC.writerDisabledLog);
  } else if (priorText == null) {
    try {
      remote = await readRemoteCsv(token, fetchImpl);
    } catch {
      remote = { error: true };
    }
    if (remote.error) return null;
  }
  const priorRows = parseCsv(remote.text || '');
  let archive = priorRows;
  const appended = [];
  const written = new Map();
  for (const closeMs of dueCloses(priorRows, now)) {
    const computed = computeClose({
      releases: events,
      closeAt: closeMs,
      priorRows: archive,
      loopUpdatedAt,
      sourceUpdatedAt,
    });
    const next = appendCloses(archive, computed.rows);
    appended.push(...next.slice(archive.length));
    archive = next;
    written.set(closeMs, computed.block);
  }
  const liveAt = closeAnchorForInstant(now);
  const lastBlock = written.get(liveAt) || computeClose({
    releases: events,
    closeAt: liveAt,
    priorRows: archive,
    loopUpdatedAt,
    sourceUpdatedAt,
  }).block;
  if (token && appended.length && !remote.error) {
    const nextText = appendCsvText(remote.text || '', appended);
    if (nextText !== (remote.text || '')) {
      try {
        await writeRemoteCsv(token, fetchImpl, remote.sha, nextText);
      } catch {
        return { method: { surp: lastBlock } };
      }
    }
  }
  return { method: { surp: lastBlock } };
}
