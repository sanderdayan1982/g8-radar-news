import { isPromotional } from './sourceHealth.js';
import { createHash } from 'node:crypto';
import { SOURCES, UA, ENGINE_NAME } from './config.js';
import { enrichRaw, parseRss, parseTelegram, parseHtmlList } from './enrich.js';
import { classifyItemMmtV4 } from './classifyCurrencies.js';
import { buildAgendaWindow } from './lockSeverity.js';
import { OP_VERSION, SHADOW_VERSION } from './shadowCalibration.js';
import { fetchCalendar, linkNewsToCalendar, turboEvent } from './calendar.js';
import { fetchMarket } from './market.js';
import { fetchPolymarketGeo } from './polymarketGeo.js';
import { buildPairRisk, buildRiskMap } from './riskMap.js';
import { sourceHealth, RELEASE } from './operations.js';

/**
 * Diccionario determinista de divisas G8 + XAU (Oro) en milisegundos (Cero llamadas a LLMs / Gemini).
 */
export const IRIS_CURRENCY_RULES = {
  USD: /\b(usd|u\.s\.a?|united states|dollar|greenback|dxy|fed\b|fomc|powell|waller|jefferson|williams|bostic|barkin|kashkari|goolsbee|bowman|kugler|musalem|hammack|daly|treasury|ust\b|payrolls?|nonfarm|nfp\b|cpi\b|pce\b|ppi\b|ism\b|jolts|adp\b|michigan|jackson hole|white house|tariff)\b/i,
  EUR: /\b(eur\b|euro\b|eurozone|euro area|ecb\b|bce\b|lagarde|guindos|schnabel|lane\b|villeroy|nagel|knot|holzmann|cipollone|panetta|wunsch|kazaks|rehn|bundesbank|germany|german|bunds?|france|french|oat\b|italy|italian|btp\b|spain|eurostat|zew\b|ifo\b)\b/i,
  GBP: /\b(gbp\b|sterling|pound|cable\b|boe\b|bank of england|mpc\b|bailey|pill\b|mann\b|greene\b|ramsden|breeden|lombardelli|dhingra|taylor|uk\b|u\.k\.|britain|british|ons\b|gilts?|chancellor|reeves|sunak|starmer)\b/i,
  JPY: /\b(jpy\b|yen\b|boj\b|bank of japan|ueda|himino|uchida|takata|tamura|nakagawa|noguchi|adachi|nakamura|japan|japanese|tokyo|tankan|jgb\b|mof\b|ministry of finance|kanda|mimura|katayama|ishiba|shunto|nikkei)\b/i,
  AUD: /\b(aud\b|aussie|rba\b|reserve bank of australia|bullock|hauser|hunter|kent\b|jones\b|australia|australian|abs\b|sydney|canberra|iron ore)\b/i,
  NZD: /\b(nzd\b|kiwi|rbnz|reserve bank of new zealand|ocr\b|orr\b|hawkesby|conway|silk\b|new zealand|wellington|auckland|stats nz|nz treasury|nzdm|gdt\b|fonterra|dairy)\b/i,
  CAD: /\b(cad\b|loonie|boc\b|bank of canada|macklem|rogers|gravelle|kozicki|vincent|mendes|canada|canadian|ottawa|statcan|statistics canada|ivi|ivey pmi|wti\b|oil sands)\b/i,
  CHF: /\b(chf\b|franc|swissie|snb\b|swiss national bank|schlegel|martin\b|tschudin|jordan\b|swiss|switzerland|seco\b|bfs\b|zurich|bern|kof\b|sight deposits)\b/i,
  XAU: /\b(xau|xauusd|gold\b|bullion|oro\b|spot gold|comex gold|precious metals?|safe[- ]haven gold)\b/i,
};

/**
 * Diccionario determinista de categorías institucionales IRIS.
 */
export const IRIS_CATEGORY_RULES = [
  {
    id: 'Intervencion_EA4',
    regex: /\b(snb intervention|fx intervention|currency intervention|rate check|verbal warning|verbal intervention|excessive moves|one-sided|disorderly|speculative moves|smoothing operation|sight deposits|forex reserves intervention|kanda\b|mimura\b|(?:mof|ministry of finance).{0,45}(?:interven|yen|fx|rate check|warning|excessive|disorderly))\b/i,
  },
  {
    id: 'BC',
    regex: /\b(fed\b|fomc|powell|ecb\b|bce\b|lagarde|boe\b|bank of england|bailey|boj\b|bank of japan|ueda|rba\b|bullock|rbnz|ocr\b|boc\b|bank of canada|macklem|snb\b|schlegel|jordan|central bank|interest rate|policy rate|rate hike|rate cut|rate decision|basis points|\bbps\b|monetary policy|hawkish|dovish|speech|minutes|quantitative|qt\b|qe\b|governing council|mpc\b|board member|governor)\b/i,
  },
  {
    id: 'Inflacion_Empleo',
    regex: /\b(cpi\b|pce\b|ppi\b|inflation|deflation|disinflation|core cpi|trimmed mean|nfp\b|nonfarm|payrolls?|pmi\b|ism\b|gdp\b|unemployment|jobless|initial claims|continuing claims|jolts|adp\b|wages?|average hourly earnings|employment|labor market|labour market|retail sales|industrial production|consumer confidence|zew\b|ifo\b|tankan)\b/i,
  },
  {
    id: 'Commodities_ToT',
    regex: /\b(wti\b|brent|crude|oil\b|opec|ttf\b|natural gas|lng\b|iron ore|copper|gold\b|xau\b|bullion|gdt\b|dairy|fonterra|terms of trade|tariff|tariffs|trade war|trade balance|exports?|imports?|customs|duties)\b/i,
  },
  {
    id: 'Fiscal',
    regex: /\b(treasury|budget|auction|deficit|surplus|bond yield|yields|10-year|2-year|30-year|ust\b|oat\b|btp\b|gilts?|bunds?|jgb\b|debt ceiling|issuance|fiscal|spending|tax\b|taxes|refunding|bid-to-cover|sovereign debt|credit rating|moody's|fitch|s&p global ratings)\b/i,
  },
  {
    id: 'Riesgo_Sistemico',
    regex: /\b(liquidity|default|bank stress|bank run|contagion|credit event|systemic|bailout|insolvency|margin call|geopolitics|geopolitical|war\b|missile|projectile|vessel struck|drone|attack|strike|strait of hormuz|hormuz|oman|taiwan|red sea|escalation|nuclear|sanctions|emergency facility|swap line|financial stability)\b/i,
  },
];

/**
 * Calcula el hash determinista SHA-256 estricto `sha256(url || title)` para deduplicación.
 */
export function computeItemSha256(url = '', title = '') {
  const cleanUrl = String(url || '').trim().replace(/^http:\/\//i, 'https://').replace(/\/+$/, '');
  const cleanTitle = String(title || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const key = cleanUrl || cleanTitle;
  return createHash('sha256').update(`${key}||${cleanTitle}`).digest('hex');
}

/**
 * Clasifica determinísticamente cualquier titular en < 0.1 ms sin IA/LLMs.
 */
export function classifyIrisItem(rawItem) {
  const text = `${rawItem.title || ''} ${rawItem.body || ''} ${rawItem.source || ''}`;
  const detectedSet = new Set(Array.isArray(rawItem.currencies) ? rawItem.currencies : []);

  for (const [ccy, regex] of Object.entries(IRIS_CURRENCY_RULES)) {
    if (regex.test(text)) {
      detectedSet.add(ccy);
    }
  }

  const matchedCategories = [];
  for (const rule of IRIS_CATEGORY_RULES) {
    if (rule.regex.test(text)) {
      matchedCategories.push(rule.id);
    }
  }

  // Mapeo de respaldo desde la categoría interna de RadarNews si ninguna regla específica disparó
  if (matchedCategories.length === 0) {
    const legacy = rawItem.category || '';
    if (legacy === 'banco_central') matchedCategories.push('BC');
    else if (legacy === 'dato_macro') matchedCategories.push('Inflacion_Empleo');
    else if (legacy === 'geopolitica') matchedCategories.push('Riesgo_Sistemico');
    else if (legacy === 'mercado') matchedCategories.push('Fiscal');
    else matchedCategories.push('BC');
  }

  const allCurrencies = [...detectedSet];
  // Las 8 divisas soberanas G8 para el motor MMT, manteniendo XAU en iris_currencies / currencies para IRIS
  const g8Currencies = allCurrencies.filter((c) => c !== 'XAU');
  const sha256 = computeItemSha256(rawItem.url, rawItem.title);
  const baseObj = {
    ...rawItem,
    id: sha256.slice(0, 16),
    sha256,
    fingerprint: rawItem.fingerprint || sha256.slice(0, 24),
    currencies: allCurrencies,
    divisas: allCurrencies,
    g8_currencies: g8Currencies,
    iris_category: matchedCategories[0],
    iris_categories: matchedCategories,
    category_iris: matchedCategories[0],
    categories_iris: matchedCategories,
  };
  const mmtMeta = classifyItemMmtV4(baseObj);

  return {
    ...baseObj,
    ficha_v6: mmtMeta.ficha_v6,
    mmt_lens: mmtMeta.mmt_lens,
    sovereignty_mmt: mmtMeta.sovereignty_mmt,
  };
}

async function fetchFeedWithTimeout(url, timeoutMs = 4000, retries = 1) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': UA,
          Accept: 'application/rss+xml, application/xml, text/xml, application/atom+xml, text/html, */*',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        signal: AbortSignal.timeout(timeoutMs),
        redirect: 'follow',
      });
      const text = await res.text();
      if (!res.ok) {
        const err = new Error(`HTTP ${res.status}`);
        err.httpStatus = res.status;
        throw err;
      }
      return { text, finalUrl: res.url, httpStatus: res.status };
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

function parseByKind(source, text) {
  if (source.kind === 'telegram') return parseTelegram(text);
  if (source.kind === 'html') return parseHtmlList(text, source.url);
  return parseRss(text);
}

export async function pullSingleSourceFast(source, nowMs = Date.now(), timeoutMs = 4000) {
  const attemptAt = new Date(nowMs).toISOString();
  const baseHealth = {
    id: source.id,
    source_id: source.id,
    name: source.name,
    url: source.url,
    type: source.type,
    kind: source.kind,
    currency: source.currency || null,
    poll_ms: source.pollMs || 60_000,
    channel_note: source.channel_note || null,
    last_attempt_at: attemptAt,
    last_success_at: null,
    last_news_published_at: null,
    last_captured_at: attemptAt,
    last_fetched_count: 0,
    last_new_count: 0,
    stored_count: 0,
    pending_count: 0,
    last_http_status: null,
    status: 'error',
    ok: false,
    last_error: null,
    last_delay_sec: null,
  };

  try {
    let raw = [];
    let finalUrl = source.url;
    try {
      const primary = await fetchFeedWithTimeout(source.url, timeoutMs);
      baseHealth.last_http_status = primary.httpStatus;
      finalUrl = primary.finalUrl;
      raw = parseByKind(source, primary.text);
    } catch (primaryErr) {
      if (!source.fallbackUrl) throw primaryErr;
    }

    const latestPrimaryMs = raw.reduce((acc, r) => {
      const ms = Date.parse(r.published_at || r.pubDate || '');
      return Number.isFinite(ms) && ms > acc ? ms : acc;
    }, 0);
    const primaryStale = latestPrimaryMs > 0 && (nowMs - latestPrimaryMs > 45 * 86400_000);

    if ((raw.length === 0 || primaryStale) && source.fallbackUrl) {
      try {
        const fb = await fetchFeedWithTimeout(source.fallbackUrl, timeoutMs);
        const fbItems = parseByKind({ ...source, kind: 'rss', url: source.fallbackUrl }, fb.text);
        if (fbItems.length > 0) {
          raw = fbItems;
          finalUrl = fb.finalUrl;
          baseHealth.last_http_status = fb.httpStatus;
        }
      } catch {
        // Ignore fallback failure if primary had items
      }
    }

    const enriched = raw
      .map((r) => enrichRaw({ ...r, url: r.url || finalUrl }, source))
      .filter((it) => it && it.title)
      .map((it) => classifyIrisItem(it));

    baseHealth.last_fetched_count = enriched.length;
    baseHealth.stored_count = enriched.length;

    if (enriched.length === 0) {
      baseHealth.status = 'empty_feed';
      baseHealth.ok = false;
      baseHealth.last_error = `HTTP ${baseHealth.last_http_status} con 0 titulares extraídos`;
      return { health: sourceHealth(baseHealth, nowMs), items: [] };
    }

    const latestPub = enriched.reduce((acc, it) => {
      if (!it.published_at) return acc;
      return !acc || Date.parse(it.published_at) > Date.parse(acc) ? it.published_at : acc;
    }, null);

    baseHealth.status = 'ok';
    baseHealth.ok = true;
    baseHealth.last_success_at = attemptAt;
    baseHealth.last_news_published_at = latestPub;
    if (latestPub) {
      const delaySec = Math.max(0, Math.round((nowMs - Date.parse(latestPub)) / 1000));
      if (Number.isFinite(delaySec)) baseHealth.last_delay_sec = delaySec;
    }

    return { health: sourceHealth(baseHealth, nowMs), items: enriched };
  } catch (err) {
    baseHealth.status = 'error';
    baseHealth.ok = false;
    baseHealth.last_http_status = err.httpStatus || null;
    baseHealth.last_error = String(err.message || err).slice(0, 180);
    return { health: sourceHealth(baseHealth, nowMs), items: [] };
  }
}

/**
 * Deduplica estrictamente por `sha256(url || title)` y por título normalizado,
 * conservando una ventana limpia de 72h para noticias de alta frecuencia y hasta 45d para bancos centrales/tesoros oficiales.
 */
export function deduplicateAndFilterWindow(items, existingItems = [], nowMs = Date.now(), windowHours = 72) {
  const windowCutoffMs = nowMs - windowHours * 3600_000;
  const officialCutoffMs = nowMs - 45 * 86400_000;
  const bySha = new Map();
  const byNormTitle = new Map();

  const allInput = [...items, ...existingItems];
  for (const raw of allInput) {
    if (!raw?.title) continue;
    const item = classifyIrisItem(raw);
    const pubMs = Date.parse(item.published_at || '');
    const isOfficial = item.source_type === 'oficial';
    const minAllowedMs = isOfficial ? officialCutoffMs : windowCutoffMs;
    if (Number.isFinite(pubMs) && pubMs < minAllowedMs) continue;

    const normTitle = String(item.title).trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (bySha.has(item.sha256)) continue;
    if (normTitle.length >= 18 && byNormTitle.has(normTitle)) continue;

    bySha.set(item.sha256, item);
    if (normTitle.length >= 18) byNormTitle.set(normTitle, item);
  }

  const merged = [...bySha.values()].sort(
    (a, b) => (Date.parse(b.published_at || 0) || 0) - (Date.parse(a.published_at || 0) || 0),
  );

  // Recorte de 72 h usado por alertas. El feed IRIS publicado sale de retainHeadlines
  // (72 h de breaking/agencia más oficiales de 45 días), no de este recorte.
  const irisWindowItems = merged.filter((it) => {
    const ms = Date.parse(it.published_at || '');
    return !Number.isFinite(ms) || ms >= windowCutoffMs;
  });

  return {
    allWindowItems: merged,
    irisWindowItems: irisWindowItems.length >= 25 ? irisWindowItems : merged.slice(0, 200),
  };
}

/** Constantes congeladas en PRE-REG_RADAR_v5.1 (10-nov-2026). No se mueven después de ver datos. */
export const BREAKING_WINDOW_HOURS = 72;
export const OFFICIAL_WINDOW_DAYS = 45;
export const STORE_CAP = 5_000;
export const FEED_CAP = 3_000;
export const TAPE_CAP = 300;
export const COVERAGE_CURRENCIES = Object.freeze(['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD', 'NZD', 'XAU']);
/** PRE-REG_RADAR_v5.1, congelado el 10-nov-2026. Solo bandera: no cambia candados ni el nivel (Parte E). */
export const SILENCE_BUSINESS_HOURS = 12;
export const SILENCE_CURRENCIES = Object.freeze(['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD', 'NZD']);
const SILENCE_CURRENCY_SET = new Set(SILENCE_CURRENCIES);

function itemTime(item) {
  const ms = Date.parse(item?.published_at || '');
  return Number.isFinite(ms) ? ms : NaN;
}

export function naturalHoursBetween(fromMs, toMs) {
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) return null;
  return Math.max(0, (toMs - fromMs) / 3600_000);
}

/** Horas entre dos instantes sin contar los sábados ni los domingos UTC. Los festivos sí cuentan. */
export function businessHoursBetween(fromMs, toMs) {
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) return 0;
  let cursor = fromMs;
  let acc = 0;
  let guard = 0;
  while (cursor < toMs && guard < 20000) {
    guard += 1;
    const day = new Date(cursor).getUTCDay();
    const stamp = new Date(cursor);
    const nextMidnight = Date.UTC(stamp.getUTCFullYear(), stamp.getUTCMonth(), stamp.getUTCDate() + 1);
    const end = Math.min(nextMidnight, toMs);
    if (day !== 0 && day !== 6) acc += end - cursor;
    if (end <= cursor) break;
    cursor = end;
  }
  return acc / 3600_000;
}

function roundHours(hours) {
  if (!Number.isFinite(hours)) return null;
  return Math.round(hours * 10) / 10;
}

/**
 * Tope de seguridad. Primero salen los breaking más antiguos, luego el resto de no oficiales
 * (agencia y cualquier otro tipo). Un oficial dentro de ventana no se elimina: si los oficiales
 * solos superan el tope, el resultado puede pasarse del tope.
 */
export function trimMemory(items, cap) {
  const list = Array.isArray(items) ? items : [];
  if (!Number.isFinite(cap) || list.length <= cap) return list.slice();
  const droppable = [];
  for (let index = 0; index < list.length; index += 1) {
    const item = list[index];
    if (item?.source_type === 'oficial') continue;
    droppable.push({ index, item });
  }
  droppable.sort((a, b) => {
    const aBreak = a.item?.source_type === 'breaking' ? 0 : 1;
    const bBreak = b.item?.source_type === 'breaking' ? 0 : 1;
    if (aBreak !== bBreak) return aBreak - bBreak;
    const aMs = itemTime(a.item);
    const bMs = itemTime(b.item);
    const aKey = Number.isFinite(aMs) ? aMs : Number.NEGATIVE_INFINITY;
    const bKey = Number.isFinite(bMs) ? bMs : Number.NEGATIVE_INFINITY;
    if (aKey !== bKey) return aKey - bKey;
    return b.index - a.index;
  });
  let extra = list.length - cap;
  const drop = new Set();
  for (const row of droppable) {
    if (extra <= 0) break;
    drop.add(row.index);
    extra -= 1;
  }
  return list.filter((_, index) => !drop.has(index));
}

export function buildCoverage(items, nowMs = Date.now()) {
  const list = Array.isArray(items) ? items : [];
  const cutoff72 = nowMs - BREAKING_WINDOW_HOURS * 3600_000;
  const cutoff45 = nowMs - OFFICIAL_WINDOW_DAYS * 86400_000;
  const coverage = {};
  for (const currency of COVERAGE_CURRENCIES) {
    let count72 = 0;
    let countOfficial = 0;
    let lastMs = NaN;
    let lastAt = null;
    for (const item of list) {
      const currencies = item?.currencies || item?.divisas || [];
      if (!currencies.includes(currency)) continue;
      const ms = itemTime(item);
      if (!Number.isFinite(ms)) continue;
      if (ms >= cutoff72) count72 += 1;
      if (item.source_type === 'oficial' && ms >= cutoff45) countOfficial += 1;
      if (!Number.isFinite(lastMs) || ms > lastMs) {
        lastMs = ms;
        lastAt = item.published_at;
      }
    }
    const business = Number.isFinite(lastMs)
      ? roundHours(businessHoursBetween(lastMs, nowMs))
      : null;
    const row = {
      count_72h: count72,
      count_official_45d: countOfficial,
      last_item_at: Number.isFinite(lastMs) ? lastAt : null,
      hours_since_last: Number.isFinite(lastMs) ? roundHours(naturalHoursBetween(lastMs, nowMs)) : null,
      hours_since_last_business: business,
    };
    if (SILENCE_CURRENCY_SET.has(currency)) {
      row.silence = !Number.isFinite(business) || business >= SILENCE_BUSINESS_HOURS;
    }
    coverage[currency] = row;
  }
  return coverage;
}

export function formatIrisFeedItem(n) {
  return {
    id: n.sha256,
    sha256: n.sha256,
    title: n.title,
    url: n.url || '',
    source: n.source,
    source_id: n.source_id,
    source_type: n.source_type,
    published_at: n.published_at,
    currencies: n.currencies || [],
    divisas: n.currencies || [],
    category: n.iris_category,
    categories: n.iris_categories || [n.iris_category],
    legacy_category: n.category,
    ficha_v6: n.ficha_v6 ?? null,
    mmt_lens: n.mmt_lens || 'CONTEXTO_GENERAL',
    sovereignty_mmt: n.sovereignty_mmt || 'SOBERANO_EMISOR',
    impact: n.impact ?? 1,
    actual: n.actual ?? null,
    forecast: n.forecast ?? null,
    previous: n.previous ?? null,
    calendar_title: n.calendar_title ?? null,
    z: n.z ?? null,
  };
}

/**
 * Separa la memoria (todos los titulares de la ventana) de la cinta (300) y del feed (tope 3.000).
 * La ventana ya aplicada en deduplicateAndFilterWindow es 72 h para breaking/agencia y 45 días para oficiales.
 */
export function retainHeadlines(freshItems = [], existingItems = [], nowMs = Date.now()) {
  const { allWindowItems, irisWindowItems } = deduplicateAndFilterWindow(
    freshItems,
    existingItems,
    nowMs,
    BREAKING_WINDOW_HOURS,
  );
  const memoryItems = trimMemory(allWindowItems, STORE_CAP);
  const feedItems = trimMemory(memoryItems, FEED_CAP);
  const tapeItems = memoryItems.slice(0, TAPE_CAP);
  const coverage = buildCoverage(memoryItems, nowMs);
  return { allWindowItems, irisWindowItems, memoryItems, feedItems, tapeItems, coverage };
}

export function buildRadarStore(items, generatedAt = new Date().toISOString()) {
  const list = Array.isArray(items) ? items : [];
  return {
    schema: 'radar-store/v1',
    generated_at: generatedAt,
    retention: {
      breaking_hours: BREAKING_WINDOW_HOURS,
      official_days: OFFICIAL_WINDOW_DAYS,
      cap: STORE_CAP,
    },
    count: list.length,
    items: list,
  };
}

export function readRadarStore(value) {
  if (!value || value.schema !== 'radar-store/v1' || !Array.isArray(value.items)) return null;
  return value;
}

/**
 * Ejecuta la recolección paralela determinista completa (fuentes + Calendario + Spot FX + mapa de riesgo + Polymarket geo).
 */
export async function collectRadarAndIrisData({
  existingItems = [],
  previousMarket = null,
  previousCalendar = [],
  polymarketHistory = null,
  timeoutMs = 4000,
} = {}) {
  const startedAt = new Date().toISOString();
  const nowMs = Date.now();

  const [pulledSources, calResult, mktResult, polyResult] = await Promise.all([
    Promise.all(SOURCES.map((s) => pullSingleSourceFast(s, nowMs, timeoutMs))),
    fetchCalendar().catch((err) => ({ events: previousCalendar || [], error: String(err.message || err) })),
    fetchMarket(previousMarket).catch(() => previousMarket || { updated_at: null, basketPct: {}, pairs: {} }),
    fetchPolymarketGeo({ history: polymarketHistory, now: nowMs }),
  ]);

  const sourcesHealth = pulledSources.map((p) => p.health);
  const freshItems = pulledSources.flatMap((p) => p.items);

  const retained = retainHeadlines(freshItems, existingItems, nowMs);
  const { allWindowItems, irisWindowItems, memoryItems, feedItems, tapeItems, coverage } = retained;
  const existingKeys = new Set((existingItems || []).map((x) => x.sha256 || x.id).filter(Boolean));

  const calendarEvents = Array.isArray(calResult?.events) && calResult.events.length
    ? calResult.events
    : (previousCalendar || []);
  // ENZO 2026-11-04: FF no publica `actual`; conservar el `actual` ya cruzado en corridas previas (mismo id de evento). Nunca inventa valores.
  // ENZO 2026-11-04b: actuals cruzados por error (titular Italia 52.0 -> German Final Services PMI). No se arrastran.
  const VOID_ACTUALS = new Set(['5518ded651ae10dd']);
  for (const e of calendarEvents) if (e && VOID_ACTUALS.has(e.id) && e.news_item_id === '7ddb7240e1274465') { e.actual = null; e.news_item_id = null; }
  if (calendarEvents !== previousCalendar && Array.isArray(previousCalendar) && previousCalendar.length) {
    const prevActual = new Map(previousCalendar.filter((e) => e && e.id && e.actual).map((e) => [e.id, e]));
    for (const e of calendarEvents) {
      const p = prevActual.get(e.id);
      if (p && !e.actual && !VOID_ACTUALS.has(e.id)) { e.actual = p.actual; if (!e.news_item_id) e.news_item_id = p.news_item_id || null; }
    }
  }
  // ENZO 2026-11-04: actuals verificados en fuente oficial (RBA MR 2026-30 del 03-nov; BFS/FSO IPC oct 2026 publicado 03-nov). Solo rellena si sigue vacio.
  const MANUAL_ACTUALS = {
    'c867a826e851f88e': '4.85%', '2388a2d8b146948e': '0.2%',
    // ENZO 2026-11-04b: S&P Global/HCOB finales oct-2026 (04-nov), BLS JOLTS sep-2026 (03-nov), ABS MHSI sep-2026 (04-nov)
    '5518ded651ae10dd': '52.5', 'e4b0e7ec11c7431f': '46.2', 'b0032a106721ab9f': '57.2', '551bc9118d35e3eb': '52.0',
    'c7cdaa12c16213e2': '7.523M', 'bee8029b5fac6711': '0.6%',
  };
  for (const e of calendarEvents) {
    if (e && !e.actual && MANUAL_ACTUALS[e.id]) e.actual = MANUAL_ACTUALS[e.id];
  }

  if (calendarEvents.length > 0) {
    linkNewsToCalendar(allWindowItems, calendarEvents);
  }

  const finishedAt = new Date().toISOString();

  const market = mktResult?.pairs && Object.keys(mktResult.pairs).length
    ? mktResult
    : (previousMarket || { updated_at: null, basketPct: {}, pairs: {} });

  const turbo = turboEvent(calendarEvents);
  const tapeNews = tapeItems;

  // Alertas recientes derivadas de titulares de alto impacto o breaking en las últimas 24h
  const alerts = irisWindowItems
    .filter((n) => !isPromotional(n))
    .filter((n) => n.impact >= 4 || n.source_type === 'breaking' || n.iris_category === 'Intervencion_EA4')
    .slice(0, 40)
    .map((n, idx) => ({
      id: idx + 1,
      title: `${n.currencies?.length ? `[${n.currencies.join('/')}] ` : ''}${n.title}`.slice(0, 180),
      body: `${n.source} · Categoría IRIS: ${n.iris_category}${n.ficha_v6 ? ` · Ficha v6.0: ${n.ficha_v6}` : ` · ${n.mmt_lens || 'CONTEXTO_GENERAL'}`}${n.actual ? ` · Act ${n.actual}` : ''}`,
      level: n.impact >= 5 ? 'critico' : n.impact >= 4 ? 'alto' : 'medio',
      alert_type: n.category === 'dato_macro' ? 'dato_macro' : 'breaking',
      currency: (n.currencies || [])[0] || null,
      news_item_id: n.id,
      is_read: true,
      occurred_at: n.published_at || finishedAt,
    }));

  const irisItemsFormatted = feedItems.map(formatIrisFeedItem);

  // Agenda: un actual se conserva en la lista hasta -48 h. El candado activo es 48 h
  // y la etiqueta POST-EVENTO dura 24 h. La severidad la pone buildAgendaWindow.
  const agendaWindow = buildAgendaWindow(calendarEvents, nowMs);
  const riskMap = buildRiskMap({
    coverage,
    calendarEvents,
    items: allWindowItems,
    polymarketGeo: polyResult.block,
    nowMs,
  });
  const pairRisk = buildPairRisk(riskMap);

  const irisFeed = {
    schema: 'iris-g8-feed/v2-mmt-v4.0',
    version: RELEASE,
    engine: ENGINE_NAME,
    engine_version: OP_VERSION,
    classification_mode: 'deterministic_regex_keywords_zero_llm',
    llm_calls: 0,
    generated_at: finishedAt,
    started_at: startedAt,
    window_hours: 72,
    sources_ok: sourcesHealth.filter((s) => s.status === 'ok').length,
    sources_total: sourcesHealth.length,
    count: irisItemsFormatted.length,
    coverage,
    risk_map: riskMap,
    pair_risk: pairRisk,
    agenda_window: agendaWindow,
    polymarket_geo: polyResult.block,
    market_basket_pct: market?.basketPct || {},
    items: irisItemsFormatted,
    news: irisItemsFormatted,
  };

  const fullState = {
    schema: 'radar-news-full/v1',
    version: RELEASE,
    now: finishedAt,
    generated_at: finishedAt,
    llm_calls: 0,
    coverage_start_at: tapeNews.length ? tapeNews[tapeNews.length - 1].published_at : finishedAt,
    last_sync: {
      started_at: startedAt,
      finished_at: finishedAt,
      pulled: freshItems.length,
      inserted: allWindowItems.filter((n) => !existingKeys.has(n.sha256 || n.id)).length,
      updated: 0,
      calendar_sync: { events: calendarEvents.length, ok: calendarEvents.length > 0 },
    },
    // GitHub schedules every 5 min are best-effort: this is the expected time, not a guarantee.
    next_sync_at: new Date(Date.now() + 300_000).toISOString(),
    next_sync_is_expected_not_guaranteed: true,
    syncing: false,
    turbo: turbo ? { currency: turbo.currency, title: turbo.title } : null,
    error: null,
    engine_meta: {
      id: 'agente',
      label: ENGINE_NAME,
      op_version: OP_VERSION,
      shadow_version: SHADOW_VERSION,
      empirical: false,
      mode: 'single_engine_agente_mmt_serverless',
      llm_calls: 0,
    },
    llm: {
      configured: false,
      status: 'ok',
      model: ENGINE_NAME,
      retired: true,
    },
    sources: sourcesHealth,
    coverage,
    news: tapeNews,
    items: irisItemsFormatted,
    risk_map: riskMap,
    pair_risk: pairRisk,
    agenda_window: agendaWindow,
    polymarket_geo: polyResult.block,
    engines: [],
    market,
    calendar: calendarEvents,
    calendar_sync: { events: calendarEvents.length, ok: calendarEvents.length > 0 },
    push_devices: 0,
    push_queue: {
      counts: {
        pending: 0,
        retrying: 0,
        accepted_by_push_service: 0,
        displayed_on_device: 0,
        failed: 0,
        expired_subscription: 0,
      },
    },
    keep_awake: false,
    platform: 'serverless-netlify-github',
    alerts,
    unread: 0,
  };

  return { irisFeed, fullState, memoryItems, polymarketHistory: polyResult.history };
}
