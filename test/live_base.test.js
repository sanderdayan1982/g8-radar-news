import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SOURCES } from '../src/config.js';
import { ACTIONS_CADENCE_MS, labelLiveAgainstActions } from '../src/sourceHealth.js';
import {
  handler,
  resetLiveCacheForTests,
  GITHUB_RAW_FULL,
  GITHUB_RAW_STORE,
} from '../netlify/functions/radar_live.mjs';

const FED_URL = 'https://www.federalreserve.gov/feeds/press_all.xml';
const ACTIONS_ITEM_TITLE = 'RBNZ keeps the official cash rate unchanged this week';

function jsonResponse(body) {
  return {
    ok: true,
    status: 200,
    url: '',
    async json() { return body; },
    async text() { return JSON.stringify(body); },
  };
}

function timeoutError() {
  const err = new Error('The operation was aborted due to timeout');
  err.name = 'TimeoutError';
  throw err;
}

function actionsFull(now, { generatedAt, ageMs = 60_000, status = 'ok', overrideId = null, overrideStatus = null, overrideAgeMs = null } = {}) {
  return {
    schema: 'radar-news-full/v1',
    generated_at: generatedAt,
    last_sync: { finished_at: generatedAt },
    sources: SOURCES.map((s) => {
      const overridden = overrideId && s.id === overrideId;
      return {
        id: s.id,
        status: overridden && overrideStatus ? overrideStatus : status,
        last_success_at: new Date(now - (overridden && overrideAgeMs != null ? overrideAgeMs : ageMs)).toISOString(),
        stored_count: 2,
        consecutive_failures: 0,
      };
    }),
    news: [],
    items: [],
    calendar: [],
    market: null,
  };
}

function actionsStore(now) {
  return {
    schema: 'radar-store/v1',
    generated_at: new Date(now).toISOString(),
    items: [{
      title: ACTIONS_ITEM_TITLE,
      url: 'https://example.com/actions-rbnz-ocr',
      source: 'Fed',
      source_id: 'fed',
      source_type: 'agencia',
      published_at: new Date(now - 60_000).toISOString(),
    }],
  };
}

function installFetch({ full, store, liveFed = false } = {}) {
  const calls = [];
  globalThis.fetch = async (url) => {
    const href = String(url);
    calls.push(href);
    if (href.startsWith(GITHUB_RAW_FULL)) {
      if (!full) throw new Error('raw full failed');
      return jsonResponse(full);
    }
    if (href.startsWith(GITHUB_RAW_STORE)) {
      if (!store) throw new Error('raw store failed');
      return jsonResponse(store);
    }
    if (liveFed && href.startsWith(FED_URL)) {
      const body = `<?xml version="1.0"?><rss version="2.0"><channel><item><title>Fed holds the policy rate at the current setting</title><link>https://www.federalreserve.gov/newsevents/pressreleases/monetary20261110a.htm</link><pubDate>${new Date(Date.now()).toUTCString()}</pubDate></item></channel></rss>`;
      return { ok: true, status: 200, url: href, async text() { return body; }, async json() { return {}; } };
    }
    timeoutError();
  };
  return calls;
}

async function call(path) {
  const res = await handler({ path, httpMethod: 'GET', queryStringParameters: {} });
  assert.equal(res.statusCode, 200);
  return JSON.parse(res.body);
}

describe('live base from the latest Actions publication', { concurrency: false }, () => {
  let restoreNow;
  const originalFetch = globalThis.fetch;
  const NOW = Date.parse('2026-11-10T21:00:00.000Z');

  beforeEach(() => {
    resetLiveCacheForTests();
    const realNow = Date.now;
    Date.now = () => NOW;
    restoreNow = () => { Date.now = realNow; };
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    restoreNow?.();
    resetLiveCacheForTests();
  });

  test('per-source timeout expression stays 700 ms when the base has items, else 3800 ms', () => {
    const src = readFileSync(new URL('../netlify/functions/radar_live.mjs', import.meta.url), 'utf8');
    assert.match(src, /const perSourceTimeoutMs = existingItems\.length > 0 \? 700 : 3800;/);
    assert.equal(ACTIONS_CADENCE_MS, 15 * 60 * 1000);
  });

  test('Raw base is used, and a timeout inside 14:59 is cached with the Actions item', async () => {
    const generatedAt = '2026-11-10T20:59:00.000Z';
    const calls = installFetch({
      full: actionsFull(NOW, { generatedAt, ageMs: 14 * 60_000 + 59_000 }),
      store: actionsStore(NOW),
    });
    const full = await call('/api/radar-full');
    assert.equal(full.base_source, 'actions_raw');
    assert.equal(full.base_published_at, generatedAt);
    assert.ok(calls.some((href) => href.startsWith(GITHUB_RAW_FULL)));
    assert.ok(calls.some((href) => href.startsWith(GITHUB_RAW_STORE)));
    assert.equal(full.sources.length, SOURCES.length);
    assert.ok(full.sources.every((s) => s.status === 'cached'));
    assert.ok(full.items.some((item) => item.title === ACTIONS_ITEM_TITLE));
    const health = await call('/api/health');
    assert.equal(health.base_source, 'actions_raw');
    assert.equal(health.base_published_at, generatedAt);
    assert.equal(health.health.base_source, 'actions_raw');
    assert.equal(health.health.status, 'CLEAN');
    assert.equal(health.health.sources_cached, SOURCES.length);
    assert.equal(health.health.sources_error, 0);
  });

  test('Raw fetch failure falls back to the bundled publication', async () => {
    installFetch({ full: null, store: null });
    const bundled = JSON.parse(readFileSync(new URL('../public/data/radar_news_full.json', import.meta.url), 'utf8'));
    const body = await call('/api/iris-feed');
    assert.equal(body.base_source, 'bundle');
    assert.equal(body.base_published_at, bundled.generated_at);
    assert.equal(body.health.base_source, 'bundle');
    assert.equal(body.health.base_published_at, bundled.generated_at);
  });

  test('timeout with Actions ok at 14:59 is cached, and at exactly 15:00 is cached', async () => {
    installFetch({
      full: actionsFull(NOW, { generatedAt: '2026-11-10T20:59:00.000Z', ageMs: 14 * 60_000 + 59_000 }),
      store: actionsStore(NOW),
    });
    const atFourteen = await call('/api/radar-full');
    assert.ok(atFourteen.sources.every((s) => s.status === 'cached'));

    resetLiveCacheForTests();
    installFetch({
      full: actionsFull(NOW, { generatedAt: '2026-11-10T20:45:00.000Z', ageMs: 15 * 60_000 }),
      store: actionsStore(NOW),
    });
    const atFifteen = await call('/api/radar-full');
    assert.ok(atFifteen.sources.every((s) => s.status === 'cached'));
  });

  test('timeout with Actions ok at 15:01 is error', async () => {
    installFetch({
      full: actionsFull(NOW, { generatedAt: '2026-11-10T20:44:00.000Z', ageMs: 15 * 60_000 + 1_000 }),
      store: actionsStore(NOW),
    });
    const body = await call('/api/radar-full');
    assert.equal(body.base_source, 'actions_raw');
    assert.ok(body.sources.every((s) => s.status === 'error'));
    assert.equal(body.health.status, 'CRITICAL');
  });

  test('Actions status other than ok is error even with a fresh last_success_at', async () => {
    installFetch({
      full: actionsFull(NOW, {
        generatedAt: '2026-11-10T20:59:30.000Z',
        ageMs: 30_000,
        overrideId: 'nz-press',
        overrideStatus: 'error',
        overrideAgeMs: 30_000,
      }),
      store: actionsStore(NOW),
    });
    const body = await call('/api/radar-full');
    const nz = body.sources.find((s) => s.id === 'nz-press');
    const fed = body.sources.find((s) => s.id === 'fed');
    assert.equal(nz.status, 'error');
    assert.equal(fed.status, 'cached');
    assert.equal(body.health.sources_error, 1);
  });

  test('health stays CLEAN when every non-live source is cached inside the cadence', async () => {
    installFetch({
      full: actionsFull(NOW, { generatedAt: '2026-11-10T20:59:00.000Z', ageMs: 60_000 }),
      store: actionsStore(NOW),
    });
    const feed = await call('/api/iris-feed');
    assert.equal(feed.health.status, 'CLEAN');
    assert.equal(feed.health.sources_cached, SOURCES.length);
    assert.equal(feed.health.sources_live, 0);
    assert.equal(feed.health.sources_error, 0);
    assert.equal(feed.health.sources_empty, 0);
    assert.equal(feed.llm_calls, 0);
  });

  test('a live fetch that answers is live and still CLEAN beside in-cadence cached sources', async () => {
    installFetch({
      full: actionsFull(NOW, { generatedAt: '2026-11-10T20:59:00.000Z', ageMs: 60_000 }),
      store: actionsStore(NOW),
      liveFed: true,
    });
    const body = await call('/api/radar-full');
    const fed = body.sources.find((s) => s.id === 'fed');
    assert.equal(fed.status, 'live');
    assert.ok(body.sources.filter((s) => s.id !== 'fed').every((s) => s.status === 'cached'));
    assert.equal(body.health.status, 'CLEAN');
    assert.equal(body.health.sources_live, 1);
    assert.equal(body.health.sources_cached, SOURCES.length - 1);
    assert.ok(body.items.some((item) => item.title === 'Fed holds the policy rate at the current setting'));
  });
});

test('cadence boundary on the record itself: 14:59 cached, 15:00 cached, 15:01 error, status not ok is error', () => {
  const now = Date.parse('2026-11-10T21:00:00.000Z');
  const failed = [{ id: 'fed', status: 'error', last_error: 'The operation was aborted due to timeout' }];
  const record = (ageMs, status = 'ok') => [{ id: 'fed', status, last_success_at: new Date(now - ageMs).toISOString() }];
  assert.equal(labelLiveAgainstActions(failed, record(14 * 60_000 + 59_000), now)[0].status, 'cached');
  assert.equal(labelLiveAgainstActions(failed, record(15 * 60_000), now)[0].status, 'cached');
  assert.equal(labelLiveAgainstActions(failed, record(15 * 60_000 + 1_000), now)[0].status, 'error');
  assert.equal(labelLiveAgainstActions(failed, record(1_000, 'error'), now)[0].status, 'error');
  assert.equal(labelLiveAgainstActions([{ id: 'fed', status: 'ok' }], record(1_000), now)[0].status, 'live');
  const swallowed = [{ id: 'bis', status: 'empty_feed', last_http_status: null, last_error: 'HTTP null con 0 titulares extraídos' }];
  assert.equal(labelLiveAgainstActions(swallowed, [{ id: 'bis', status: 'ok', last_success_at: new Date(now - (14 * 60_000 + 59_000)).toISOString() }], now)[0].status, 'cached');
  assert.equal(labelLiveAgainstActions([{ id: 'bis', status: 'empty_feed', last_http_status: 200, last_error: 'HTTP 200 con 0 titulares extraídos' }], record(1_000), now)[0].status, 'empty_feed');
});
