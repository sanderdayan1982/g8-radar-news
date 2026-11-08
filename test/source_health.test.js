import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeSourceHealth, healthSummary, publishSignature, isPromotional } from '../src/sourceHealth.js';

const prev = [{ id: 'fed', status: 'ok', last_success_at: '2026-11-07T22:00:00Z', last_news_published_at: '2026-11-07T21:00:00Z', stored_count: 9, consecutive_failures: 0 }];

test('a failed source is never reported as ok', () => {
  const [s] = mergeSourceHealth([{ id: 'fed', status: 'error', last_error: 'HTTP 503', last_attempt_at: '2026-11-08T00:00:00Z' }], prev);
  assert.equal(s.status, 'error');
  assert.equal(s.last_error, 'HTTP 503');
  assert.equal(s.last_attempt_at, '2026-11-08T00:00:00Z');
  assert.equal(s.last_success_at, '2026-11-07T22:00:00Z');   // carried fact, not a fake success
  assert.equal(s.consecutive_failures, 1);
  assert.deepEqual(healthSummary([s]), { ok: 0, cached: 0, empty: 0, error: 1, total: 1 });
});

test('serverless seeds are labelled cached, not ok', () => {
  const [s] = mergeSourceHealth([{ id: 'fed', status: 'error', last_error: 'timeout 700ms' }], prev, { seedMode: true });
  assert.equal(s.status, 'cached'); assert.equal(s.ok, false);
});

test('consecutive failures accumulate and reset on success', () => {
  const a = mergeSourceHealth([{ id: 'fed', status: 'error' }], [{ ...prev[0], status: 'error', consecutive_failures: 2 }]);
  assert.equal(a[0].consecutive_failures, 3);
  assert.equal(mergeSourceHealth([{ id: 'fed', status: 'ok' }], a)[0].consecutive_failures, 0);
});

test('calendar consensus/actual changes force a publication', () => {
  const base = { calendar: [{ id: 'a', forecast: '0.3%', actual: null }], sources: [{ id: 'fed', status: 'ok' }] };
  assert.equal(publishSignature(base), publishSignature(structuredClone(base)));
  assert.notEqual(publishSignature(base), publishSignature({ ...base, calendar: [{ id: 'a', forecast: '0.3%', actual: '0.4%' }] }));
  assert.notEqual(publishSignature(base), publishSignature({ ...base, sources: [{ id: 'fed', status: 'error' }] }));
});

test('promotional posts do not become alerts', () => {
  assert.equal(isPromotional({ title: 'Sneak peak of some data in FJ 2.0 - launching soon 😍', currencies: [] }), true);
  assert.equal(isPromotional({ title: 'US CPI ACTUAL 0.4% FORECAST 0.3%', currencies: ['USD'], actual: '0.4' }), false);
  assert.equal(isPromotional({ title: 'Fed subscribe to tightening path', currencies: ['USD'] }), false);
});
