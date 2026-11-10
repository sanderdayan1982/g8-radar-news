import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SOURCES } from '../../src/config.js';
import { collectRadarAndIrisData, projectIrisFeed, readRadarStore } from '../../src/irisCollector.js';
import { readPolymarketHistory } from '../../src/polymarketGeo.js';
import { labelLiveAgainstActions, irisHealth } from '../../src/sourceHealth.js';

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
const SEED_POLY_PATH = join(ROOT, 'public', 'data', 'polymarket_geo_history.json');
const SPEC_PATH = join(ROOT, 'SPEC.md');

export const GITHUB_RAW_FULL = 'https://raw.githubusercontent.com/sanderdayan1982/g8-radar-news/main/public/data/radar_news_full.json';
export const GITHUB_RAW_STORE = 'https://raw.githubusercontent.com/sanderdayan1982/g8-radar-news/main/public/data/radar_store.json';
const GITHUB_RAW_POLY = 'https://raw.githubusercontent.com/sanderdayan1982/g8-radar-news/main/public/data/polymarket_geo_history.json';
// Document fetch for the Actions publication. Separate from the per-source live timeout below.
const GITHUB_RAW_TIMEOUT_MS = 4000;
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

function publicationTime(full) {
  if (!full) return null;
  return full.generated_at || full.last_sync?.finished_at || null;
}

async function fetchGithubStore(timeoutMs = GITHUB_RAW_TIMEOUT_MS) {
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

function historyStamp(history) {
  const latest = Date.parse(history?.latest?.at || '') || 0;
  const snaps = (history?.snapshots || []).reduce((max, snap) => Math.max(max, Date.parse(snap?.at) || 0), 0);
  return Math.max(latest, snaps);
}

function newerHistory(a, b) {
  if (!a) return b;
  if (!b) return a;
  return historyStamp(a) >= historyStamp(b) ? a : b;
}

function readPolyFromDisk() {
  try {
    if (!existsSync(SEED_POLY_PATH)) return null;
    return readPolymarketHistory(JSON.parse(readFileSync(SEED_POLY_PATH, 'utf8')));
  } catch {
    return null;
  }
}

async function fetchGithubPoly(timeoutMs = GITHUB_RAW_TIMEOUT_MS) {
  try {
    const res = await fetch(`${GITHUB_RAW_POLY}?t=${Date.now()}`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    return readPolymarketHistory(await res.json());
  } catch {
    return null;
  }
}

async function fetchGithubRawSeed(timeoutMs = GITHUB_RAW_TIMEOUT_MS) {
  try {
    const res = await fetch(`${GITHUB_RAW_FULL}?t=${Date.now()}`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.ok) return await res.json();
  } catch {
    // ignore
  }
  return null;
}

function itemsFromFull(full) {
  if (Array.isArray(full?.items) && full.items.length) return full.items;
  if (Array.isArray(full?.news)) return full.news;
  return [];
}

// Base is the latest Actions publication. The bundled JSON is used only when that fetch fails.
async function resolvePublicationBase() {
  const rawFull = await fetchGithubRawSeed();
  if (rawFull && Array.isArray(rawFull.sources)) {
    const rawStore = await fetchGithubStore();
    const storeItems = Array.isArray(rawStore?.items) ? rawStore.items : itemsFromFull(rawFull);
    return {
      baseSource: 'actions_raw',
      basePublishedAt: publicationTime(rawFull),
      fullState: rawFull,
      storeItems,
    };
  }
  const disk = loadSeedFromDisk();
  const diskStore = readStoreFromDisk();
  const full = disk.fullState;
  return {
    baseSource: 'bundle',
    basePublishedAt: publicationTime(full),
    fullState: full,
    storeItems: Array.isArray(diskStore?.items) ? diskStore.items : itemsFromFull(full),
  };
}

export function resetLiveCacheForTests() {
  memCache = { updatedAt: 0, irisFeed: null, fullState: null };
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

  // Base = latest Actions publication (GitHub Raw). Bundled JSON only if that fetch fails.
  const [base, polyHistory] = await Promise.all([
    resolvePublicationBase(),
    fetchGithubPoly().then((remote) => newerHistory(readPolyFromDisk(), remote)),
  ]);
  const baseFull = base.fullState;
  const existingItems = Array.isArray(base.storeItems) ? base.storeItems : [];
  const previousMarket = baseFull?.market || null;
  const previousCalendar = Array.isArray(baseFull?.calendar) ? baseFull.calendar : [];

  // Consulta paralela ultrarrápida (con timeout corto para garantizar respuesta < 1s cuando ya hay semilla)
  const perSourceTimeoutMs = existingItems.length > 0 ? 700 : 3800;
  const collected = await collectRadarAndIrisData({
    existingItems,
    previousMarket,
    previousCalendar,
    polymarketHistory: polyHistory,
    timeoutMs: perSourceTimeoutMs,
  });
  let { irisFeed } = collected;
  const { fullState, memoryItems } = collected;

  const labeledAt = Date.now();
  fullState.sources = labelLiveAgainstActions(fullState.sources, baseFull?.sources || [], labeledAt);
  // irisHealth is unchanged and counts status `ok` as sources_live. A successful pull is published
  // as `live`; that row is shown to the same function as `ok` so the v5.0 counts stay true.
  const healthSources = fullState.sources.map((s) => (s.status === 'live' ? { ...s, status: 'ok' } : s));
  const health = {
    ...irisHealth(healthSources, fullState.calendar?.length || 0),
    base_source: base.baseSource,
    base_published_at: base.basePublishedAt,
  };
  irisFeed = projectIrisFeed({ ...irisFeed, health });
  fullState.base_source = base.baseSource;
  fullState.base_published_at = base.basePublishedAt;
  fullState.health = health;

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
      body: JSON.stringify(irisFeed),
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
        sources_ok: (fullState.sources || []).filter((s) => s.status === 'live').length,
        health: irisFeed.health,
        base_source: fullState.base_source || irisFeed.health?.base_source || null,
        base_published_at: fullState.base_published_at || irisFeed.health?.base_published_at || null,
        sources_total: (fullState.sources || []).length,
        count: Array.isArray(irisFeed.items) ? irisFeed.items.length : 0,
      }),
    };
  }

  return {
    statusCode: 200,
    headers: responseHeaders,
    body: JSON.stringify({ ...fullState, cache_status: cacheStatus, response_ms: elapsedMs }),
  };
}
