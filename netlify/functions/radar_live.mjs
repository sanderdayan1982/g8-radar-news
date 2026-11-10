import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SOURCES } from '../../src/config.js';
import { collectRadarAndIrisData, readRadarStore } from '../../src/irisCollector.js';
import { mergeSourceHealth, irisHealth } from '../../src/sourceHealth.js';

const SOURCE_COUNT = SOURCES.length;
const LIVE_BUNDLE_KEY = `live-bundle-v2-${SOURCE_COUNT}sources`;

const ROOT = (() => {
  try {
    if (import.meta && import.meta.url) {
      return join(dirname(fileURLToPath(import.meta.url)), '..', '..');
    }
  } catch {
    // bundled CJS fallback
  }
  return process.cwd();
})();
const SEED_FULL_PATH = join(ROOT, 'public', 'data', 'radar_news_full.json');
const SEED_IRIS_PATH = join(ROOT, 'public', 'data', 'iris_g8_feed.json');
const SEED_STORE_PATH = join(ROOT, 'public', 'data', 'radar_store.json');
const SPEC_PATH = join(ROOT, 'SPEC.md');

const GITHUB_RAW_FULL = 'https://raw.githubusercontent.com/sanderdayan1982/g8-radar-news/main/public/data/radar_news_full.json';
const GITHUB_RAW_STORE = 'https://raw.githubusercontent.com/sanderdayan1982/g8-radar-news/main/public/data/radar_store.json';
const CACHE_TTL_MS = 60_000;
// A forced refresh re-polls every configured source. Public callers cannot force more than one per minute.
const MIN_FORCE_INTERVAL_MS = 60_000;

let memCache = {
  updatedAt: 0,
  irisFeed: null,
  fullState: null,
};

function loadSeedFromDisk() {
  try {
    if (existsSync(SEED_FULL_PATH) && existsSync(SEED_IRIS_PATH)) {
      const fullState = JSON.parse(readFileSync(SEED_FULL_PATH, 'utf8'));
      const irisFeed = JSON.parse(readFileSync(SEED_IRIS_PATH, 'utf8'));
      return { fullState, irisFeed };
    }
  } catch {
    // ignore
  }
  return { fullState: null, irisFeed: null };
}

async function readNetlifyBlobCache() {
  try {
    const { getStore } = await import('@netlify/blobs');
    const store = getStore('radar-news-g8-cache');
    const cached = await store.get(LIVE_BUNDLE_KEY, { type: 'json' });
    if (cached && cached.updatedAt && cached.irisFeed && cached.fullState && cached.fullState.sources?.length >= SOURCE_COUNT) {
      return cached;
    }
  } catch {
    // Netlify Blobs optional fallback if outside Blob context
  }
  return null;
}

async function writeNetlifyBlobCache(bundle) {
  try {
    const { getStore } = await import('@netlify/blobs');
    const store = getStore('radar-news-g8-cache');
    await store.setJSON(LIVE_BUNDLE_KEY, bundle);
  } catch {
    // Ignore if Blobs store is unavailable in local dev
  }
}

function readStoreFromDisk() {
  try {
    if (!existsSync(SEED_STORE_PATH)) return null;
    return readRadarStore(JSON.parse(readFileSync(SEED_STORE_PATH, 'utf8')));
  } catch {
    return null;
  }
}

function pickNewerStore(a, b) {
  if (!a) return b;
  if (!b) return a;
  const at = Date.parse(a.generated_at || '') || 0;
  const bt = Date.parse(b.generated_at || '') || 0;
  if (at !== bt) return at > bt ? a : b;
  return (a.items?.length || 0) >= (b.items?.length || 0) ? a : b;
}

async function fetchGithubStore(timeoutMs = 4000) {
  try {
    const res = await fetch(`${GITHUB_RAW_STORE}?t=${Date.now()}`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    return readRadarStore(await res.json());
  } catch {
    return null;
  }
}

async function resolveStoreItems(memItems, blobItems) {
  if (Array.isArray(memItems)) return memItems;
  const picked = pickNewerStore(readStoreFromDisk(), await fetchGithubStore());
  const fileItems = picked?.items || [];
  if (Array.isArray(blobItems) && fileItems.length) return [...blobItems, ...fileItems];
  if (fileItems.length) return fileItems;
  if (Array.isArray(blobItems)) return blobItems;
  return null;
}

async function fetchGithubRawSeed(timeoutMs = 600) {
  try {
    const res = await fetch(`${GITHUB_RAW_FULL}?t=${Date.now()}`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.ok) {
      return await res.json();
    }
  } catch {
    // ignore
  }
  return null;
}

async function getFreshOrCachedBundle(forceRefresh = false) {
  const now = Date.now();
  if (forceRefresh) {
    const last = Math.max(memCache.updatedAt || 0, (await readNetlifyBlobCache())?.updatedAt || 0);
    if (now - last < MIN_FORCE_INTERVAL_MS) forceRefresh = false;
  }

  if (!forceRefresh && memCache.irisFeed && memCache.fullState && (now - memCache.updatedAt < CACHE_TTL_MS)) {
    return { ...memCache, cacheStatus: 'HIT_MEMORY' };
  }

  const blobCached = await readNetlifyBlobCache();
  if (!forceRefresh && blobCached && (now - blobCached.updatedAt < CACHE_TTL_MS)) {
    memCache = blobCached;
    return { ...blobCached, cacheStatus: 'HIT_NETLIFY_BLOBS' };
  }

  // Seed baseline from previous memory/blob or GitHub Raw / bundled JSON
  const diskSeed = loadSeedFromDisk();
  const rawSeed = (!blobCached?.fullState && !memCache.fullState)
    ? await fetchGithubRawSeed(500)
    : null;
  const baseFull = memCache.fullState || blobCached?.fullState || rawSeed || diskSeed.fullState;

  const storeItems = await resolveStoreItems(memCache.storeItems, blobCached?.storeItems);
  // La cinta (news, 300) no es memoria. Si no hay store todavía, se usa como arranque único.
  const existingItems = Array.isArray(storeItems)
    ? storeItems
    : (Array.isArray(baseFull?.news) ? baseFull.news : []);
  const previousMarket = baseFull?.market || null;
  const previousCalendar = Array.isArray(baseFull?.calendar) ? baseFull.calendar : [];
  try {
    const mirror = rawSeed || await fetchGithubRawSeed(500);
    const byId = new Map((mirror?.calendar || []).filter((e) => e?.id && e.actual != null && e.actual !== '').map((e) => [e.id, e.actual]));
    for (const ev of previousCalendar) if ((ev.actual == null || ev.actual === '') && byId.has(ev.id)) ev.actual = byId.get(ev.id);
  } catch { /* GitHub Raw no disponible: seguir sin fusionar */ }

  // Consulta paralela ultrarrápida (con timeout corto para garantizar respuesta < 1s cuando ya hay semilla)
  const perSourceTimeoutMs = existingItems.length > 0 ? 700 : 3800;
  const { irisFeed, fullState, memoryItems } = await collectRadarAndIrisData({
    existingItems,
    previousMarket,
    previousCalendar,
    timeoutMs: perSourceTimeoutMs,
  });

  // Conservar el estado ok de fuentes oficiales que en esta ventana de 700ms usaron la semilla de 5m
  // Sources that miss the 700 ms budget are served from the last scheduled run and labelled "cached".
  fullState.sources = mergeSourceHealth(fullState.sources, baseFull?.sources || [], { seedMode: true });
  irisFeed.sources_ok = fullState.sources.filter((s) => s.status === 'ok').length;
  irisFeed.health = irisHealth(fullState.sources, fullState.calendar?.length || 0);

  const bundle = {
    updatedAt: Date.now(),
    irisFeed,
    fullState,
    storeItems: memoryItems,
  };
  memCache = bundle;
  await writeNetlifyBlobCache(bundle);
  return { ...bundle, cacheStatus: 'MISS_REFRESHED_LIVE' };
}

export async function handler(event) {
  const path = event.path || event.rawUrl || '';
  const query = event.queryStringParameters || {};
  const force = query.refresh === '1' || event.httpMethod === 'POST';

  const corsHeaders = {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders, body: '' };
  }

  if (path.endsWith('/api/spec')) {
    const md = existsSync(SPEC_PATH) ? readFileSync(SPEC_PATH, 'utf8') : '# RadarNews Agente MMT';
    return {
      statusCode: 200,
      headers: { ...corsHeaders, 'Content-Type': 'text/markdown; charset=utf-8' },
      body: md,
    };
  }

  const t0 = Date.now();
  const { irisFeed, fullState, cacheStatus, updatedAt } = await getFreshOrCachedBundle(force);
  const elapsedMs = Date.now() - t0;

  const responseHeaders = {
    ...corsHeaders,
    'X-Radar-Cache': cacheStatus,
    'X-Radar-Cache-Age-Sec': String(Math.max(0, Math.round((Date.now() - updatedAt) / 1000))),
    'X-Radar-Latency-Ms': String(elapsedMs),
    'X-Radar-LLM-Calls': '0',
  };

  if (path.includes('iris-feed') || query.format === 'iris') {
    return {
      statusCode: 200,
      headers: responseHeaders,
      body: JSON.stringify({ ...irisFeed, cache_status: cacheStatus, response_ms: elapsedMs }),
    };
  }

  if (path.endsWith('/api/health')) {
    return {
      statusCode: 200,
      headers: responseHeaders,
      body: JSON.stringify({
        version: fullState.version,
        ok: true,
        llm_calls: 0,
        cache_status: cacheStatus,
        response_ms: elapsedMs,
        last_sync_at: fullState.last_sync?.finished_at || null,
        sources_ok: irisFeed.sources_ok,
        health: irisFeed.health,
        sources_total: irisFeed.sources_total,
        count: irisFeed.count,
      }),
    };
  }

  return {
    statusCode: 200,
    headers: responseHeaders,
    body: JSON.stringify({ ...fullState, cache_status: cacheStatus, response_ms: elapsedMs }),
  };
}
