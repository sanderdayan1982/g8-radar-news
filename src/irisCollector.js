import { createHash } from 'node:crypto';
import { SOURCES, UA, ENGINE_NAME } from './config.js';
import { enrichRaw, parseRss, parseTelegram, parseHtmlList } from './enrich.js';
import { selectEvidence, evidenceContract } from './evidence.js';
import { classifyAgent, attachRanks } from './classifyCurrencies.js';
import { classifyAgentShadow, OP_VERSION, SHADOW_VERSION } from './shadowCalibration.js';
import { fetchCalendar, linkNewsToCalendar, turboEvent } from './calendar.js';
import { fetchMarket } from './market.js';
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
    regex: /\b(mof\b|ministry of finance|kanda|mimura|katayama|snb intervention|fx intervention|currency intervention|rate check|verbal warning|verbal intervention|excessive moves|one-sided|disorderly|speculative moves|smoothing operation|sight deposits|forex reserves intervention)\b/i,
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

  return {
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
    const item = raw.sha256 ? raw : classifyIrisItem(raw);
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

  // Para el feed ligero IRIS (ventana estricta 72h; si una fuente oficial tiene comunicados recientes en 72h entran aquí)
  const irisWindowItems = merged.filter((it) => {
    const ms = Date.parse(it.published_at || '');
    return !Number.isFinite(ms) || ms >= windowCutoffMs;
  });

  return {
    allWindowItems: merged,
    irisWindowItems: irisWindowItems.length >= 25 ? irisWindowItems : merged.slice(0, 200),
  };
}

/**
 * Ejecuta la recolección paralela determinista completa (25 fuentes + Calendario + Spot FX + Agente MMT).
 */
export async function collectRadarAndIrisData({
  existingItems = [],
  previousMarket = null,
  previousCalendar = [],
  timeoutMs = 4000,
} = {}) {
  const startedAt = new Date().toISOString();
  const nowMs = Date.now();

  const [pulledSources, calResult, mktResult] = await Promise.all([
    Promise.all(SOURCES.map((s) => pullSingleSourceFast(s, nowMs, timeoutMs))),
    fetchCalendar().catch((err) => ({ events: previousCalendar || [], error: String(err.message || err) })),
    fetchMarket().catch(() => previousMarket || { updated_at: null, basketPct: {}, pairs: {} }),
  ]);

  const sourcesHealth = pulledSources.map((p) => p.health);
  const freshItems = pulledSources.flatMap((p) => p.items);

  const { allWindowItems, irisWindowItems } = deduplicateAndFilterWindow(freshItems, existingItems, nowMs, 72);

  const calendarEvents = Array.isArray(calResult?.events) && calResult.events.length
    ? calResult.events
    : (previousCalendar || []);

  if (calendarEvents.length > 0) {
    linkNewsToCalendar(allWindowItems, calendarEvents);
  }

  // Preparar copias con solo las 8 divisas G8 para el motor determinista Agente MMT
  const mmtInputNews = allWindowItems.map((it) => ({
    ...it,
    currencies: (it.g8_currencies && it.g8_currencies.length)
      ? it.g8_currencies
      : (it.currencies || []).filter((c) => c !== 'XAU'),
  }));

  const eligibleEvidence = selectEvidence(mmtInputNews, nowMs);
  const contract = evidenceContract(eligibleEvidence, nowMs);
  const shadowRows = classifyAgentShadow(eligibleEvidence, nowMs);
  const shadowByCcy = new Map(shadowRows.map((s) => [s.currency, s]));
  const finishedAt = new Date().toISOString();

  const agentRows = attachRanks(classifyAgent(eligibleEvidence, nowMs)).map((r) => {
    const sh = shadowByCcy.get(r.currency);
    return {
      ...r,
      calibration: {
        ...contract,
        engine: 'agente',
        engineLabel: ENGINE_NAME,
        opVersion: OP_VERSION,
        generatedAt: finishedAt,
        evaluatedAt: contract.asOf,
        empirical: false,
        interpretationMode: 'deterministic_rules',
      },
      shadow: sh ? { ...sh, evidenceSet: contract.evidenceSet, deltaFromOp: sh.score - r.score } : null,
    };
  });

  const engineSnapshot = {
    engine: 'agente',
    label: ENGINE_NAME,
    snapshot_at: finishedAt,
    regime_note: '',
    rows: agentRows,
    history: Object.fromEntries(agentRows.map((r) => [r.currency, [[finishedAt, r.score, r.rank]]])),
  };

  const market = mktResult?.pairs && Object.keys(mktResult.pairs).length
    ? mktResult
    : (previousMarket || { updated_at: null, basketPct: {}, pairs: {} });

  const turbo = turboEvent(calendarEvents);
  const tapeNews = allWindowItems.slice(0, 300);

  // Alertas recientes derivadas de titulares de alto impacto o breaking en las últimas 24h
  const alerts = irisWindowItems
    .filter((n) => n.impact >= 4 || n.source_type === 'breaking' || n.iris_category === 'Intervencion_EA4')
    .slice(0, 40)
    .map((n, idx) => ({
      id: idx + 1,
      title: `${n.currencies?.length ? `[${n.currencies.join('/')}] ` : ''}${n.title}`.slice(0, 180),
      body: `${n.source} · Categoría IRIS: ${n.iris_category}${n.actual ? ` · Act ${n.actual}` : ''}`,
      level: n.impact >= 5 ? 'critico' : n.impact >= 4 ? 'alto' : 'medio',
      alert_type: n.category === 'dato_macro' ? 'dato_macro' : 'breaking',
      currency: (n.currencies || [])[0] || null,
      news_item_id: n.id,
      is_read: true,
      occurred_at: n.published_at || finishedAt,
    }));

  const irisItemsFormatted = irisWindowItems.slice(0, 250).map((n) => ({
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
    impact: n.impact ?? 1,
    actual: n.actual ?? null,
    forecast: n.forecast ?? null,
    previous: n.previous ?? null,
    calendar_title: n.calendar_title ?? null,
    z: n.z ?? null,
  }));

  const g8RankingSummary = agentRows.map((r) => ({
    currency: r.currency,
    rank: r.rank,
    score: r.score,
    bias: r.noEvidence ? 'N/D' : r.bias,
    structural: r.structural ?? r.score,
    impulse: r.impulse ?? null,
    no_evidence: !!r.noEvidence,
    drivers: r.drivers || [],
  }));

  const irisFeed = {
    schema: 'iris-g8-feed/v1',
    version: RELEASE,
    engine: ENGINE_NAME,
    classification_mode: 'deterministic_regex_keywords_zero_llm',
    llm_calls: 0,
    generated_at: finishedAt,
    started_at: startedAt,
    window_hours: 72,
    sources_ok: sourcesHealth.filter((s) => s.status === 'ok').length,
    sources_total: sourcesHealth.length,
    count: irisItemsFormatted.length,
    g8_ranking: g8RankingSummary,
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
      inserted: freshItems.length,
      updated: 0,
      calendar_sync: { events: calendarEvents.length, ok: calendarEvents.length > 0 },
    },
    next_sync_at: new Date(Date.now() + 60_000).toISOString(),
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
    news: tapeNews,
    items: irisItemsFormatted,
    g8_ranking: g8RankingSummary,
    engines: [engineSnapshot],
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

  return { irisFeed, fullState };
}
