import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { nextInterval } from '../scripts/next_interval.mjs';

const now = Date.parse('2026-11-10T13:20:00Z');
test('cadence: 60 s within 15 min of a High event, 300 s otherwise', () => {
  assert.equal(nextInterval([{ impact: 'High', event_at: '2026-11-10T13:30:00Z' }], now), 60);
  assert.equal(nextInterval([{ impact: 'High', event_at: '2026-11-10T13:05:00Z' }], now), 60);
  assert.equal(nextInterval([{ impact: 'Medium', event_at: '2026-11-10T13:30:00Z' }], now), 300);
  assert.equal(nextInterval([{ impact: 'High', event_at: '2026-11-10T15:00:00Z' }], now), 300);
  assert.equal(nextInterval([], now), 300);
});
test('scheduler: hourly loop, bounded runtime, no overlap, Netlify lock kept', () => {
  const wf = readFileSync(new URL('../.github/workflows/update_radar_news.yml', import.meta.url), 'utf8');
  const loop = readFileSync(new URL('../scripts/sync_loop.sh', import.meta.url), 'utf8');
  assert.match(wf, /cron:\s*'3 \* \* \* \*'/);
  assert.match(wf, /cancel-in-progress: false/);
  assert.match(wf, /timeout-minutes: 62/);
  assert.match(loop, /BUDGET_SEC:-3420/);
  assert.match(loop, /chore\(feed\): sync radar news \[skip netlify\]/);
});
