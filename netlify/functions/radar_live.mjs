import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectRadarAndIrisData } from '../../src/irisCollector.js';

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
const SPEC_PATH = join(ROOT, 'SPEC.md');

const GITHUB_RAW_FULL = 'https://raw.githubusercontent.com/sanderdayan1982/g8-radar-news/main/public/data/radar_news_full.json';
const CACHE_TTL_MS = 60_000;

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
    const cached = await store.get('live-bundle-v2-31sources', { type: 'json' });
    if (cached && cached.updatedAt && cached.irisFeed && cached.fullState && cached.fullState.sources?.length >= 31) {
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
    await store.setJSON('live-bundle-v2-31sources', bundle);
  } catch {
    // Ignore if Blobs store is unavailable in local dev
  }
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

  const existingItems = Array.isArray(baseFull?.news) ? baseFull.news : [];
  const previousMarket = baseFull?.market || null;
  const previousCalendar = Array.isArray(baseFull?.calendar) ? baseFull.calendar : [];

  // Consulta paralela ultrarrápida (con timeout corto para garantizar respuesta < 1s cuando ya hay semilla)
  const perSourceTimeoutMs = existingItems.length > 0 ? 700 : 3800;
  const { irisFeed, fullState } = await collectRadarAndIrisData({
    existingItems,
    previousMarket,
    previousCalendar,
    timeoutMs: perSourceTimeoutMs,
  });

  // Conservar el estado ok de fuentes oficiales que en esta ventana de 700ms usaron la semilla de 5m
  if (Array.isArray(baseFull?.sources) && Array.isArray(fullState.sources)) {
    const prevById = new Map(baseFull.sources.map((s) => [s.id, s]));
    fullState.sources = fullState.sources.map((s) => {
      if (s.status === 'ok') return s;
      const prev = prevById.get(s.id);
      return prev && prev.status === 'ok' ? prev : s;
    });
    irisFeed.sources_ok = fullState.sources.filter((s) => s.status === 'ok').length;
  }

  const bundle = {
    updatedAt: Date.now(),
    irisFeed,
    fullState,
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
