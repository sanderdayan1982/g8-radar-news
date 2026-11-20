import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildExecutionWindows,
  fetchFxvolShadow,
  FXVOL_SHADOW_URL,
  publishedWindowsHaveValidStale,
  resolvePublishedFxvolInput,
} from '../src/executionWindows.js';
import { projectIrisFeed } from '../src/irisCollector.js';

const PUBLIC_URL = 'https://raw.githubusercontent.com/sanderdayan1982/g8-macro-pipeline/main/data/public/CME_FXVOL_public.json';

const PUBLIC_DOC = {
  status: 'OK',
  as_of: '2026-11-19',
  generated_utc: '2026-11-19T12:00:00Z',
  fut_roll_window: {
    start: '2026-12-07',
    end: '2026-12-19',
    active: false,
    imm: '2026-12-16',
  },
  currencies: {
    EUR: { status: 'OK', vote: 'WAIT', date: '2026-11-19', exp1: '2026-12-04' },
    JPY: { status: 'OK', vote: 'WAIT', date: '2026-11-19', exp1: '2026-12-11' },
    GBP: { status: 'OK', vote: 'WAIT', date: '2026-11-19', exp1: '2026-12-04' },
    AUD: { status: 'OK', vote: 'WAIT', date: '2026-11-19', exp1: null },
    CAD: { status: 'OK', vote: 'WAIT', date: '2026-11-19', exp1: null },
    CHF: { status: 'OK', vote: 'WAIT', date: '2026-11-19', exp1: null },
    NZD: { status: 'NO_CME_OPTIONS', vote: null, date: '2026-11-19', exp1: null },
  },
};

function feedShell(extra) {
  return {
    version: '3.0.0',
    engine_version: 'mmt-agent-op-v4.1-G8',
    generated_at: '2026-11-19T12:00:00Z',
    health: { status: 'CLEAN', sources_live: 1 },
    coverage: {},
    risk_map: [],
    pair_risk: [],
    agenda_window: [],
    polymarket_geo: { status: 'STALE', updated_at: null, markets: [] },
    items: [],
    ...extra,
  };
}

test('FXVOL_SHADOW_URL apunta a la proyección pública y las copias coinciden', () => {
  assert.equal(FXVOL_SHADOW_URL, PUBLIC_URL);
  const source = readFileSync(new URL('../src/executionWindows.js', import.meta.url));
  const browser = readFileSync(new URL('../public/executionWindows.js', import.meta.url));
  assert.equal(Buffer.compare(source, browser), 0);
  assert.match(source.toString('utf8'), /data\/public\/CME_FXVOL_public\.json/);
  assert.doesNotMatch(source.toString('utf8'), /data\/CME_FXVOL_shadow\.json/);
});

test('la proyección pública alimenta roll, imm y opex, y los días salen de exp1', () => {
  const instant = '2026-11-19T12:00:00Z';
  const block = buildExecutionWindows(instant, PUBLIC_DOC);
  assert.equal(block.analysis.fx_roll.status, 'OK');
  assert.equal(block.analysis.fx_roll.start, '2026-12-07');
  assert.equal(block.analysis.fx_roll.end, '2026-12-19');
  assert.equal(block.analysis.fx_roll.active, false);
  assert.equal(block.analysis.fx_roll.state, 'BEFORE');
  assert.equal(block.analysis.imm.status, 'OK');
  assert.equal(block.analysis.imm.date, '2026-12-16');
  assert.equal(block.analysis.opex.status, 'OK');
  assert.equal(block.analysis.opex.currencies.EUR.exp1, '2026-12-04');
  assert.equal(block.analysis.opex.currencies.EUR.dte1, 15);
  assert.equal(block.analysis.opex.currencies.JPY.exp1, '2026-12-11');
  assert.equal(block.analysis.opex.currencies.JPY.dte1, 22);
  assert.equal(block.analysis.opex.currencies.NZD.exp1, null);
  assert.equal(block.analysis.opex.currencies.NZD.dte1, null);
  assert.deepEqual(block.analysis.opex.earliest, { exp1: '2026-12-04', currencies: ['EUR', 'GBP'] });
});

test('en un documento público se ignora dte1 y se calcula desde exp1', () => {
  const doc = {
    ...PUBLIC_DOC,
    currencies: {
      ...PUBLIC_DOC.currencies,
      EUR: { ...PUBLIC_DOC.currencies.EUR, dte1: 99 },
    },
  };
  const block = buildExecutionWindows('2026-11-19T12:00:00Z', doc);
  assert.equal(block.analysis.opex.currencies.EUR.dte1, 15);
  assert.notEqual(block.analysis.opex.currencies.EUR.dte1, 99);
});

test('sin generated_utc, as_of de la proyección pública basta para la frescura', () => {
  const { generated_utc, ...noGenerated } = PUBLIC_DOC;
  const fresh = buildExecutionWindows('2026-11-19T18:00:00Z', noGenerated);
  assert.equal(fresh.analysis.imm.status, 'OK');
  const stale = buildExecutionWindows('2026-11-23T00:00:01Z', noGenerated);
  assert.equal(stale.analysis.imm.reason, 'STALE');
  assert.equal(stale.analysis.fx_roll.reason, 'STALE');
});

test('fetchFxvolShadow reintenta la URL pública y conserva un STALE publicado', async () => {
  const calls = [];
  const staleWindows = buildExecutionWindows('2026-11-19T12:00:00Z', {
    generated_utc: '2026-11-12T00:00:00Z',
  });
  assert.equal(staleWindows.analysis.fx_roll.reason, 'STALE');
  assert.equal(publishedWindowsHaveValidStale(staleWindows), true);

  const fetched = await fetchFxvolShadow(async (url) => {
    calls.push(url);
    if (calls.length < 3) throw new Error('down');
    return { ok: true, json: async () => PUBLIC_DOC };
  }, { backoffMs: 0, sleep: async () => {} });
  assert.deepEqual(calls, [PUBLIC_URL, PUBLIC_URL, PUBLIC_URL]);
  assert.equal(fetched.generated_utc, PUBLIC_DOC.generated_utc);
  assert.equal(fetched.fut_roll_window.imm, '2026-12-16');

  const kept = resolvePublishedFxvolInput(null, staleWindows);
  assert.deepEqual(kept, { execution_windows: staleWindows });
  const rebuilt = projectIrisFeed(feedShell(kept));
  assert.equal(rebuilt.execution_windows.analysis.fx_roll.reason, 'STALE');
  assert.notEqual(rebuilt.execution_windows.analysis.fx_roll.reason, 'MISSING');

  const freshWins = resolvePublishedFxvolInput(PUBLIC_DOC, staleWindows);
  assert.deepEqual(freshWins, { fxvol: PUBLIC_DOC });
  const applied = projectIrisFeed(feedShell(freshWins));
  assert.equal(applied.execution_windows.analysis.imm.date, '2026-12-16');
  assert.equal(applied.execution_windows.analysis.opex.currencies.EUR.dte1, 15);
});
