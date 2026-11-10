import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { SOURCES } from '../src/config.js';
import { ACTIONS_CADENCE_MS } from '../src/sourceHealth.js';
import {
  handler,
  resetLiveCacheForTests,
  GITHUB_RAW_FULL,
  GITHUB_RAW_STORE,
  GITHUB_RAW_STATUS,
} from '../netlify/functions/radar_live.mjs';
const ACTIONS_ITEM_TITLE = 'RBNZ keeps the official cash rate unchanged this week';
const FIFTEEN_MIN_MS = 15 * 60_000;
const TWO_HOURS_MS = 2 * 60 * 60_000;

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

function actionsFull(now, { generatedAt, ageMs, status = 'ok', overrideId = null, overrideStatus = null } = {}) {
  return {
    schema: 'radar-news-full/v1',
    generated_at: generatedAt,
    last_sync: { finished_at: generatedAt },
    sources: SOURCES.map((s) => ({
      id: s.id,
      status: overrideId && s.id === overrideId && overrideStatus ? overrideStatus : status,
      last_success_at: new Date(now - ageMs).toISOString(),
      stored_count: 2,
      consecutive_failures: 0,
    })),
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

// Shape written by scripts/sync_feeds.mjs: objects with the source id, not bare strings.
function failingEntry(id) {
  return {
    id,
    status: 'error',
    last_error: 'HTTP 503',
    last_success_at: null,
    consecutive_failures: 1,
  };
}

function statusDoc(now, ageMs, failingIds = [], { lastCheckAt } = {}) {
  const doc = {
    schema: 'radar-status/v1',
    last_check_at: new Date(now - ageMs).toISOString(),
    feed_generated_at: new Date(now - TWO_HOURS_MS).toISOString(),
    wrote_full_feed: false,
    new_items: 0,
    sources: { ok: SOURCES.length, cached: 0, empty: 0, error: 0, total: SOURCES.length },
    failing_sources: failingIds.map(failingEntry),
    calendar_events: 96,
  };
  if (lastCheckAt !== undefined) doc.last_check_at = lastCheckAt;
  return doc;
}

function installFetch({ full, store, status, statusMode = 'json' } = {}) {
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
    if (href.startsWith(GITHUB_RAW_STATUS)) {
      if (statusMode === 'throw') throw new Error('raw status failed');
      if (statusMode === 'http') return { ok: false, status: 404, async json() { return {}; }, async text() { return ''; } };
      if (statusMode === 'bad-json') return { ok: true, status: 200, async json() { throw new SyntaxError('Unexpected token'); }, async text() { return '{'; } };
      if (!status) throw new Error('raw status failed');
      return jsonResponse(status);
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

describe('live timeout follows the radar_status heartbeat', { concurrency: false }, () => {
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

  test('heartbeat 15:00 old and not in failing_sources is cached', async () => {
    assert.equal(ACTIONS_CADENCE_MS, FIFTEEN_MIN_MS);
    // Full-file timestamps are stale on purpose: the decision is the heartbeat distance.
    const calls = installFetch({
      full: actionsFull(NOW, {
        generatedAt: new Date(NOW - TWO_HOURS_MS).toISOString(),
        ageMs: TWO_HOURS_MS,
      }),
      store: actionsStore(NOW),
      status: statusDoc(NOW, FIFTEEN_MIN_MS),
    });
    const body = await call('/api/radar-full');
    assert.ok(calls.some((href) => href.startsWith(GITHUB_RAW_STATUS) && href.includes('?t=')));
    assert.equal(body.base_source, 'actions_raw');
    assert.ok(body.sources.every((s) => s.status === 'cached'));
    assert.equal(body.health.status, 'CLEAN');
    assert.equal(body.health.sources_cached, SOURCES.length);
    assert.equal(body.health.sources_error, 0);
    assert.equal(body.health.sources_active, SOURCES.length);
  });

  test('heartbeat 15:01 old is error', async () => {
    installFetch({
      full: actionsFull(NOW, {
        generatedAt: new Date(NOW - 60_000).toISOString(),
        ageMs: 60_000,
      }),
      store: actionsStore(NOW),
      status: statusDoc(NOW, FIFTEEN_MIN_MS + 1_000),
    });
    const body = await call('/api/radar-full');
    assert.equal(body.base_source, 'actions_raw');
    assert.ok(body.sources.every((s) => s.status === 'error'));
    assert.equal(body.health.sources_error, SOURCES.length);
    assert.equal(body.health.sources_cached, 0);
    assert.equal(body.health.status, 'CRITICAL');
  });

  test('a source listed in failing_sources is error while the heartbeat is fresh', async () => {
    installFetch({
      full: actionsFull(NOW, {
        generatedAt: new Date(NOW - 60_000).toISOString(),
        ageMs: 60_000,
      }),
      store: actionsStore(NOW),
      status: statusDoc(NOW, 30_000, ['fed']),
    });
    const body = await call('/api/radar-full');
    const fed = body.sources.find((s) => s.id === 'fed');
    const nz = body.sources.find((s) => s.id === 'nz-press');
    assert.equal(fed.status, 'error');
    assert.equal(nz.status, 'cached');
    assert.equal(body.health.sources_error, 1);
    assert.equal(body.health.sources_cached, SOURCES.length - 1);
    assert.equal(body.health.sources_active, SOURCES.length - 1);
    assert.equal(body.health.status, 'DEGRADED');
  });

  test('missing, unreadable, or heartbeat-less radar_status is error', async () => {
    const freshFull = actionsFull(NOW, {
      generatedAt: new Date(NOW - 60_000).toISOString(),
      ageMs: 60_000,
    });
    const cases = [
      { statusMode: 'throw' },
      { statusMode: 'http' },
      { statusMode: 'bad-json' },
      { statusMode: 'json', status: (() => { const doc = statusDoc(NOW, 0); delete doc.last_check_at; return doc; })() },
      { statusMode: 'json', status: statusDoc(NOW, 0, [], { lastCheckAt: '' }) },
      { statusMode: 'json', status: statusDoc(NOW, 0, [], { lastCheckAt: 'not-a-time' }) },
    ];
    for (const entry of cases) {
      resetLiveCacheForTests();
      installFetch({ full: freshFull, store: actionsStore(NOW), ...entry });
      const body = await call('/api/radar-full');
      assert.ok(body.sources.every((s) => s.status === 'error'), entry.statusMode);
      assert.equal(body.health.status, 'CRITICAL');
    }
  });

  test('a 2 h stale radar_news_full stays cached when the heartbeat is fresh and the source is not failing', async () => {
    // Distances from the injected clock. Do not require last_check_at to sort after generated_at:
    // the two files are published by different jobs.
    installFetch({
      full: actionsFull(NOW, {
        generatedAt: new Date(NOW - TWO_HOURS_MS).toISOString(),
        ageMs: TWO_HOURS_MS,
        overrideId: 'nz-press',
        overrideStatus: 'error',
      }),
      store: actionsStore(NOW),
      status: statusDoc(NOW, 30_000),
    });
    const body = await call('/api/radar-full');
    const nz = body.sources.find((s) => s.id === 'nz-press');
    assert.equal(body.base_source, 'actions_raw');
    assert.equal(body.base_published_at, new Date(NOW - TWO_HOURS_MS).toISOString());
    assert.ok(body.items.some((item) => item.title === ACTIONS_ITEM_TITLE));
    assert.equal(nz.status, 'cached');
    assert.ok(body.sources.every((s) => s.status === 'cached'));
    assert.equal(body.health.status, 'CLEAN');
    assert.equal(body.health.sources_cached, SOURCES.length);
    const feed = await call('/api/iris-feed');
    assert.equal(feed.llm_calls, 0);
    assert.equal(feed.health.status, 'CLEAN');
    assert.equal(feed.health.base_source, 'actions_raw');
  });

  test('radar_status is requested while the full-feed fetch is still in flight', async () => {
    let releaseFull = () => {};
    const fullBlocked = new Promise((resolve) => { releaseFull = resolve; });
    let statusWhileFullBlocked = false;
    const full = actionsFull(NOW, {
      generatedAt: new Date(NOW - TWO_HOURS_MS).toISOString(),
      ageMs: TWO_HOURS_MS,
    });
    globalThis.fetch = async (url) => {
      const href = String(url);
      if (href.startsWith(GITHUB_RAW_FULL)) {
        await fullBlocked;
        return jsonResponse(full);
      }
      if (href.startsWith(GITHUB_RAW_STORE)) return jsonResponse(actionsStore(NOW));
      if (href.startsWith(GITHUB_RAW_STATUS)) {
        statusWhileFullBlocked = true;
        return jsonResponse(statusDoc(NOW, 30_000));
      }
      timeoutError();
    };
    const pending = call('/api/radar-full');
    try {
      await new Promise((resolve) => setTimeout(resolve, 30));
      assert.equal(statusWhileFullBlocked, true);
    } finally {
      releaseFull();
      await pending;
    }
  });
});
