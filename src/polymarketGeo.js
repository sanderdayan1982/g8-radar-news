import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  POLYMARKET_BACKOFF_MAX_MS,
  POLYMARKET_BACKOFF_START_MS,
  POLYMARKET_CADENCE_MS,
  POLYMARKET_D24H_MS,
  POLYMARKET_D24H_WINDOW_MS,
  POLYMARKET_GEO_EXCLUSIONS,
  POLYMARKET_GEO_THEMES,
  POLYMARKET_HISTORY_DAYS,
  POLYMARKET_MAX_PER_THEME,
  POLYMARKET_MIN_LIQUIDITY_USD,
  POLYMARKET_MIN_VOLUME_USD,
  UA,
  WINDOWS,
} from './config.js';

export const POLYMARKET_HISTORY_SCHEMA = 'polymarket-geo-history/v1';
export const GAMMA_EVENTS_URL = 'https://gamma-api.polymarket.com/events';

const PAGE_SIZE = 100;
const MAX_PAGES = 50;
const DAY_MS = 24 * 60 * 60 * 1000;

const CACHE_DIR = (() => {
  if (process.env.RADARNEWS_DATA_DIR) return process.env.RADARNEWS_DATA_DIR;
  try {
    if (import.meta?.url) return join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
  } catch { /* bundled CJS fallback */ }
  return '/tmp';
})();
const CACHE_PATH = join(CACHE_DIR, 'polymarket_geo_cache.json');

const shared = { loaded: false, lastOk: 0, backoff: 0, nextTry: 0, lastOutcome: null };
let sharedHistory = null;

function round2(n) {
  const r = Math.round(Number(n) * 100) / 100;
  return Object.is(r, -0) ? 0 : r;
}

function numberOrZero(value) {
  const n = typeof value === 'string' ? Number(value.trim()) : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function parseMaybeJson(value) {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return null; }
}

function norm(value) {
  return String(value || '').toLowerCase();
}

function tagSlugs(event) {
  return (Array.isArray(event?.tags) ? event.tags : [])
    .map((tag) => norm(typeof tag === 'string' ? tag : tag?.slug))
    .filter(Boolean);
}

export function emptyPolymarketHistory() {
  return { schema: POLYMARKET_HISTORY_SCHEMA, latest: null, snapshots: [] };
}

export function readPolymarketHistory(value) {
  if (!value || value.schema !== POLYMARKET_HISTORY_SCHEMA || !Array.isArray(value.snapshots)) {
    return emptyPolymarketHistory();
  }
  const latest = value.latest && Array.isArray(value.latest.markets)
    ? { at: value.latest.at || null, markets: value.latest.markets }
    : null;
  return {
    schema: POLYMARKET_HISTORY_SCHEMA,
    latest,
    snapshots: value.snapshots.filter((snap) => snap && snap.at && Array.isArray(snap.rows)),
  };
}

export function trimPolymarketHistory(history, now = Date.now()) {
  const h = readPolymarketHistory(history);
  const cutoff = now - POLYMARKET_HISTORY_DAYS * DAY_MS;
  h.snapshots = h.snapshots.filter((snap) => {
    const t = Date.parse(snap.at);
    return Number.isFinite(t) && t >= cutoff && t <= now + 5 * 60_000;
  });
  return h;
}

function isOpen(row) {
  if (!row || row.closed !== false) return false;
  if (row.archived === true) return false;
  if (row.active === false) return false;
  return true;
}

function blob(event) {
  const questions = (Array.isArray(event?.markets) ? event.markets : []).map((m) => m?.question || '').join('\n');
  const slugs = tagSlugs(event).join('\n');
  return norm(`${event?.title || ''}\n${questions}\n${event?.category || ''}\n${slugs}`);
}

function phraseHit(text, phrases) {
  return phrases.some((phrase) => text.includes(phrase));
}

/** Deportes, cripto, entretenimiento o banco central. Null si el evento puede seguir. */
export function exclusionReason(event) {
  const slugs = tagSlugs(event);
  const text = blob(event);
  const x = POLYMARKET_GEO_EXCLUSIONS;
  const markets = Array.isArray(event?.markets) ? event.markets : [];
  if (slugs.some((slug) => x.sportsTags.includes(slug)) || markets.some((m) => typeof m?.sportsMarketType === 'string' && m.sportsMarketType.trim())) {
    return 'sports';
  }
  if (phraseHit(text, x.sportsPhrases)) return 'sports';
  if (slugs.some((slug) => x.cryptoTags.includes(slug) || slug.startsWith('crypto-'))) return 'crypto';
  if (phraseHit(text, x.cryptoPhrases)) return 'crypto';
  if (slugs.some((slug) => x.entertainmentTags.includes(slug))) return 'entertainment';
  if (phraseHit(text, x.entertainmentPhrases)) return 'entertainment';
  if (slugs.some((slug) => x.centralBankTags.includes(slug))) return 'central_bank';
  if (phraseHit(text, x.centralBankPhrases)) return 'central_bank';
  const category = norm(event?.category);
  if (category === 'sports') return 'sports';
  if (category === 'crypto' || category === 'cryptocurrency') return 'crypto';
  if (category === 'entertainment' || category === 'pop culture' || category === 'pop-culture' || category === 'movies') {
    return 'entertainment';
  }
  return null;
}

function keywordAtWordStart(title, keyword) {
  const escaped = String(keyword).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}`, 'i').test(String(title || ''));
}

function wordsRe(phrases) {
  const body = [...phrases]
    .sort((a, b) => b.length - a.length)
    .map((phrase) => phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
  return new RegExp(`\\b(?:${body})\\b`, 'i');
}

/**
 * Estados Unidos en el texto de ARANCELES.
 * US, U.S., USA, United States, America/American, y Trump
 * (por tanto «Trump administration»).
 * Orden de Sander, 11-nov-2026: Trump cuenta como EE. UU. en este requisito.
 * RADAR-v5.1.1: Trump también asigna USD en el léxico de divisas.
 */
const UNITED_STATES_RE = wordsRe([
  'united states', 'usa', 'us', 'america', 'american', 'americans', 'trump',
]);
const UNITED_STATES_DOTTED_RE = /\bu\.s\b/i;

/**
 * Contraparte de ARANCELES: economía del bloque distinta de EE. UU., China o México.
 * Eurozona (miembros a 2026, incluida Bulgaria desde el 1-ene-2026), EU, euro area
 * (el mismo referente que CCY_KEYWORDS.EUR), Reino Unido, Japón, Suiza, Canadá, Australia, Nueva Zelanda.
 * U.K. es la misma abreviatura que UK.
 */
const ARANCELES_COUNTERPARTY_RE = wordsRe([
  'eurozone', 'european union', 'euro area', 'eu',
  'austria', 'belgium', 'belgian', 'bulgaria', 'bulgarian',
  'croatia', 'croatian', 'cyprus', 'estonia', 'finland', 'finnish',
  'france', 'french', 'germany', 'german', 'greece', 'greek',
  'ireland', 'irish', 'italy', 'italian', 'latvia', 'lithuania',
  'luxembourg', 'malta', 'maltese', 'netherlands', 'dutch',
  'portugal', 'portuguese', 'slovakia', 'slovak', 'slovenia', 'slovenian',
  'spain', 'spanish',
  'uk', 'britain', 'british', 'united kingdom',
  'japan', 'japanese',
  'switzerland', 'swiss',
  'canada', 'canadian',
  'australia', 'australian',
  'new zealand',
  'china', 'chinese',
  'mexico', 'mexican',
]);
const ARANCELES_COUNTERPARTY_DOTTED_RE = /\bu\.k\b/i;

function namesUnitedStates(text) {
  return UNITED_STATES_RE.test(text) || UNITED_STATES_DOTTED_RE.test(text);
}

function namesArancelesCounterparty(text) {
  return ARANCELES_COUNTERPARTY_RE.test(text) || ARANCELES_COUNTERPARTY_DOTTED_RE.test(text);
}

/** Título del evento y pregunta del mercado representativo. */
function arancelesQualifies(eventTitle, question) {
  const text = `${eventTitle || ''}\n${question || ''}`;
  return namesUnitedStates(text) && namesArancelesCounterparty(text);
}

/**
 * Milisegundos de end_date, o null si falta o no se puede leer.
 * Ese null no excluye: el selector ya publicaba el mercado con null o con el texto crudo.
 */
function endMillis(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function endDateIsPast(value, now) {
  const t = endMillis(value);
  if (t == null) return false;
  return t < now;
}

export function themesForTitle(title) {
  if (!String(title || '').trim()) return [];
  return POLYMARKET_GEO_THEMES.filter((theme) => theme.keywords.some((keyword) => keywordAtWordStart(title, keyword)));
}

function yesProbability(market) {
  const outcomes = parseMaybeJson(market?.outcomes);
  const prices = parseMaybeJson(market?.outcomePrices);
  if (!Array.isArray(outcomes) || !Array.isArray(prices)) return null;
  const index = outcomes.findIndex((outcome) => norm(outcome).trim() === 'yes');
  if (index < 0 || index >= prices.length) return null;
  const price = Number(prices[index]);
  if (!Number.isFinite(price) || price < 0 || price > 1) return null;
  return round2(price * 100);
}

function marketVolume(market) {
  return numberOrZero(market?.volumeNum ?? market?.volume);
}

function representativeMarket(event, now) {
  const open = (Array.isArray(event?.markets) ? event.markets : []).filter(isOpen);
  open.sort((a, b) => marketVolume(b) - marketVolume(a) || String(a?.id || '').localeCompare(String(b?.id || ''), 'en'));
  for (const market of open) {
    if (!String(market?.question || '').trim()) continue;
    if (yesProbability(market) == null) continue;
    if (endDateIsPast(market.endDate || event?.endDate || null, now)) continue;
    return market;
  }
  return null;
}

function eventUrl(event) {
  const slug = String(event?.slug || '').trim();
  return slug ? `https://polymarket.com/event/${slug}` : null;
}

function marketKey(theme, event, market) {
  const eventId = event?.id || event?.slug || event?.title;
  const marketId = market?.id || market?.slug || market?.question;
  return `${theme}|${eventId}|${marketId}`;
}

/**
 * Eventos abiertos que encajan, con el filtro de volumen y liquidez.
 * Máximo 5 por tema, por volumen del evento. Una fila por evento:
 * el mercado abierto de mayor volumen, con end_date no anterior a `now`, y su probabilidad Yes.
 * ARANCELES_COMERCIO exige además EE. UU. y una contraparte en el título o la pregunta.
 */
export function selectPolymarketMarkets(events, now = Date.now()) {
  const grouped = new Map(POLYMARKET_GEO_THEMES.map((theme) => [theme.theme, []]));
  for (const event of events || []) {
    if (!isOpen(event)) continue;
    if (exclusionReason(event)) continue;
    const themes = themesForTitle(event?.title);
    if (!themes.length) continue;
    const volume = numberOrZero(event.volume);
    const liquidity = numberOrZero(event.liquidity);
    if (volume < POLYMARKET_MIN_VOLUME_USD || liquidity < POLYMARKET_MIN_LIQUIDITY_USD) continue;
    const market = representativeMarket(event, now);
    if (!market) continue;
    const prob = yesProbability(market);
    for (const theme of themes) {
      if (theme.theme === 'ARANCELES_COMERCIO' && !arancelesQualifies(event?.title, market.question)) continue;
      grouped.get(theme.theme).push({
        key: marketKey(theme.theme, event, market),
        theme: theme.theme,
        event_title: String(event.title),
        question: String(market.question),
        prob,
        d24h_pp: null,
        volume: round2(volume),
        liquidity: round2(liquidity),
        end_date: market.endDate || event.endDate || null,
        url: eventUrl(event),
        currencies: [...theme.currencies],
      });
    }
  }

  const selected = [];
  for (const theme of POLYMARKET_GEO_THEMES) {
    const rows = grouped.get(theme.theme);
    rows.sort((a, b) => b.volume - a.volume
      || a.event_title.localeCompare(b.event_title, 'en')
      || a.key.localeCompare(b.key, 'en'));
    selected.push(...rows.slice(0, POLYMARKET_MAX_PER_THEME));
  }
  return selected;
}

export function toPublicMarket(row) {
  return {
    theme: row.theme,
    event_title: row.event_title,
    question: row.question,
    prob: row.prob,
    d24h_pp: row.d24h_pp ?? null,
    volume: row.volume,
    liquidity: row.liquidity,
    end_date: row.end_date ?? null,
    url: row.url ?? null,
    currencies: [...(row.currencies || [])],
  };
}

/** Instantánea dentro de ±1 h de hace 24 h. Empate: la más antigua. */
export function closestSnapshot(snapshots, now) {
  const target = now - POLYMARKET_D24H_MS;
  let best = null;
  for (const snap of snapshots || []) {
    const t = Date.parse(snap?.at);
    if (!Number.isFinite(t)) continue;
    const dist = Math.abs(t - target);
    if (dist > POLYMARKET_D24H_WINDOW_MS) continue;
    if (!best || dist < best.dist || (dist === best.dist && t < best.t)) best = { snap, dist, t };
  }
  return best ? best.snap : null;
}

export function d24hFor(key, prob, snapshots, now) {
  const snap = closestSnapshot(snapshots, now);
  if (!snap || prob == null) return null;
  const row = (snap.rows || []).find((item) => item?.key === key);
  if (!row || !Number.isFinite(Number(row.prob))) return null;
  return round2(prob - Number(row.prob));
}

export function applyD24h(rows, snapshots, now) {
  return (rows || []).map((row) => ({ ...row, d24h_pp: d24hFor(row.key, row.prob, snapshots, now) }));
}

function blockFromLatest(history, now, status) {
  const latest = history?.latest;
  if (!latest?.at || !Array.isArray(latest.markets)) {
    return { status, updated_at: null, markets: [] };
  }
  const markets = latest.markets.map((row) => toPublicMarket({
    ...row,
    d24h_pp: d24hFor(row.key, row.prob, history.snapshots, now),
  }));
  return { status, updated_at: latest.at, markets };
}

function appendSnapshot(history, rows, nowIso, now) {
  const next = trimPolymarketHistory(history, now);
  next.snapshots.push({
    at: nowIso,
    rows: rows.map((row) => ({ key: row.key, prob: row.prob })),
  });
  next.latest = {
    at: nowIso,
    markets: rows.map((row) => ({ ...row, currencies: [...row.currencies] })),
  };
  return next;
}

function pageUrl(offset) {
  const url = new URL(GAMMA_EVENTS_URL);
  url.searchParams.set('closed', 'false');
  url.searchParams.set('active', 'true');
  url.searchParams.set('limit', String(PAGE_SIZE));
  url.searchParams.set('offset', String(offset));
  url.searchParams.set('order', 'volume');
  url.searchParams.set('ascending', 'false');
  return url.toString();
}

async function fetchJson(fetchImpl, url) {
  const res = await fetchImpl(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    signal: AbortSignal.timeout(WINDOWS.fetchTimeoutMs),
  });
  if (!res?.ok) throw new Error(`Gamma HTTP ${res?.status || 'sin respuesta'}`);
  const body = await res.json();
  if (!Array.isArray(body)) throw new Error('Gamma no devolvió una lista');
  return body;
}

async function fetchOpenEvents(fetchImpl) {
  const events = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const rows = await fetchJson(fetchImpl, pageUrl(page * PAGE_SIZE));
    events.push(...rows);
    if (rows.length < PAGE_SIZE) return events;
    const maxVolume = rows.reduce((max, event) => Math.max(max, numberOrZero(event?.volume)), 0);
    if (maxVolume < POLYMARKET_MIN_VOLUME_USD) return events;
  }
  throw new Error('Gamma no bajó del volumen mínimo en el recorrido');
}

function loadCache() {
  try {
    const parsed = JSON.parse(readFileSync(CACHE_PATH, 'utf8'));
    if (parsed && typeof parsed === 'object') return parsed;
  } catch { /* sin copia */ }
  return null;
}

function saveCache(clock) {
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    const tmp = `${CACHE_PATH}.tmp`;
    writeFileSync(tmp, JSON.stringify({
      lastOk: clock.lastOk || 0,
      backoff: clock.backoff || 0,
      nextTry: clock.nextTry || 0,
      lastOutcome: clock.lastOutcome || null,
    }));
    renameSync(tmp, CACHE_PATH);
  } catch { /* la copia en disco es opcional */ }
}

function sharedClock() {
  if (!shared.loaded) {
    shared.loaded = true;
    const cached = loadCache();
    if (cached) {
      shared.lastOk = Number(cached.lastOk) || 0;
      shared.backoff = Number(cached.backoff) || 0;
      shared.nextTry = Number(cached.nextTry) || 0;
      shared.lastOutcome = cached.lastOutcome || null;
    }
  }
  return shared;
}

function historyStamp(history) {
  const latest = Date.parse(history?.latest?.at || '') || 0;
  const snaps = (history?.snapshots || []).reduce((max, snap) => Math.max(max, Date.parse(snap?.at) || 0), 0);
  return Math.max(latest, snaps);
}

function preferHistory(passed) {
  const fromCaller = readPolymarketHistory(passed);
  const fromMemory = readPolymarketHistory(sharedHistory);
  return historyStamp(fromMemory) > historyStamp(fromCaller) ? fromMemory : fromCaller;
}

function shouldFetch(clock, history, now) {
  if (clock.lastOutcome === 'STALE' && clock.nextTry && now < clock.nextTry) return false;
  const lastSuccess = Date.parse(history?.latest?.at || '') || 0;
  const lastOk = Math.max(lastSuccess, clock.lastOutcome === 'OK' ? (clock.lastOk || 0) : 0);
  if (clock.lastOutcome !== 'STALE' && lastOk && now - lastOk < POLYMARKET_CADENCE_MS) return false;
  return true;
}

function heldStatus(clock, now) {
  if (clock.lastOutcome === 'STALE' && clock.nextTry && now < clock.nextTry) return 'STALE';
  return 'OK';
}

/**
 * Lee Gamma como mucho cada 30 min. Un fallo deja status STALE y la hora del último éxito.
 * `state` aislado (tests) no toca disco ni la memoria del proceso.
 */
export async function fetchPolymarketGeo({
  history = null,
  now = Date.now(),
  fetchImpl = globalThis.fetch,
  state = null,
} = {}) {
  const isolated = state != null;
  const clock = state || sharedClock();
  const base = isolated ? readPolymarketHistory(history) : preferHistory(history);
  const trimmed = trimPolymarketHistory(base, now);
  try {
    if (!shouldFetch(clock, trimmed, now)) {
      return { block: blockFromLatest(trimmed, now, heldStatus(clock, now)), history: trimmed };
    }
    const events = await fetchOpenEvents(fetchImpl);
    const nowIso = new Date(now).toISOString();
    const rows = applyD24h(selectPolymarketMarkets(events, now), trimmed.snapshots, now);
    const block = { status: 'OK', updated_at: nowIso, markets: rows.map(toPublicMarket) };
    const next = appendSnapshot(trimmed, rows, nowIso, now);
    clock.lastOk = now;
    clock.backoff = 0;
    clock.nextTry = 0;
    clock.lastOutcome = 'OK';
    if (!isolated) {
      saveCache(clock);
      sharedHistory = next;
    }
    return { block, history: next };
  } catch {
    clock.backoff = clock.backoff ? Math.min(clock.backoff * 2, POLYMARKET_BACKOFF_MAX_MS) : POLYMARKET_BACKOFF_START_MS;
    clock.nextTry = now + clock.backoff;
    clock.lastOutcome = 'STALE';
    if (!isolated) saveCache(clock);
    return { block: blockFromLatest(trimmed, now, 'STALE'), history: trimmed };
  }
}

export function writePolymarketHistory(path, history) {
  const body = `${JSON.stringify(readPolymarketHistory(history), null, 2)}\n`;
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, body);
  renameSync(tmp, path);
}
