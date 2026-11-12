import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildExecutionWindows,
  executionWindowHeader,
  shiftGotobi,
  WAT_TZ,
} from '../src/executionWindows.js';
import { projectIrisFeed } from '../src/irisCollector.js';

const FORBIDDEN = /\blong\b|\bshort\b|\bcompra\b|\bvende\b|subirá|bajará/i;
const IRIS_KEYS = [
  'schema_version', 'version', 'engine_version', 'llm_calls', 'generated_at',
  'health', 'coverage', 'risk_map', 'pair_risk', 'agenda_window', 'polymarket_geo',
  'execution_windows', 'items',
];

function weekday(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
}

function offsetMinutes(iso, timeZone) {
  const date = new Date(iso);
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date).map((part) => [part.type, part.value]));
  const hour = parts.hour === '24' ? 0 : Number(parts.hour);
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), hour, Number(parts.minute), Number(parts.second));
  return Math.round((asUtc - date.getTime()) / 60000);
}

test('el gotobi de un domingo se mueve al viernes', () => {
  assert.equal(weekday('2026-11-15'), 0);
  assert.equal(weekday('2026-11-13'), 5);
  assert.equal(shiftGotobi('2026-11-15'), '2026-11-13');
  const friday = buildExecutionWindows('2026-11-13T12:00:00+01:00');
  const sunday = buildExecutionWindows('2026-11-15T12:00:00+01:00');
  assert.equal(friday.analysis.date, '2026-11-13');
  assert.equal(friday.analysis.gotobi, true);
  assert.equal(friday.analysis.fix_tokyo.gotobi, true);
  assert.equal(sunday.analysis.gotobi, false);
  assert.equal(sunday.analysis.fix_tokyo.gotobi, false);
  assert.equal(shiftGotobi('2026-03-20'), '2026-03-19');
  assert.equal(shiftGotobi('2026-05-05'), '2026-05-01');
});

test('el cambio horario de marzo y de octubre mueve Londres y Nueva York en WAT', () => {
  for (const iso of ['2026-01-15T12:00:00Z', '2026-03-30T12:00:00Z', '2026-07-15T12:00:00Z', '2026-10-26T12:00:00Z']) {
    assert.equal(offsetMinutes(iso, WAT_TZ), 60);
  }
  const beforeBoth = buildExecutionWindows('2026-03-06T12:00:00+01:00');
  const afterNewYork = buildExecutionWindows('2026-03-09T12:00:00+01:00');
  const afterLondon = buildExecutionWindows('2026-03-30T12:00:00+01:00');
  assert.equal(beforeBoth.analysis.fix_london.wat, '17:00');
  assert.equal(afterNewYork.analysis.fix_london.wat, '17:00');
  assert.equal(afterLondon.analysis.fix_london.wat, '16:00');
  assert.equal(beforeBoth.analysis.nyc_cut.wat, '16:00');
  assert.equal(afterNewYork.analysis.nyc_cut.wat, '15:00');
  assert.equal(afterLondon.analysis.nyc_cut.wat, '15:00');
  assert.equal(beforeBoth.analysis.fix_tokyo.wat, '01:55');
  assert.equal(afterLondon.analysis.fix_tokyo.wat, '01:55');

  const beforeOctober = buildExecutionWindows('2026-10-23T12:00:00+01:00');
  const afterOctober = buildExecutionWindows('2026-10-26T12:00:00+01:00');
  assert.equal(beforeOctober.analysis.fix_london.wat, '16:00');
  assert.equal(afterOctober.analysis.fix_london.wat, '17:00');
  assert.equal(beforeOctober.analysis.nyc_cut.wat, '15:00');
  assert.equal(afterOctober.analysis.nyc_cut.wat, '15:00');
  assert.equal(beforeOctober.analysis.fix_tokyo.wat, '01:55');
});

test('el 31-dic-2026 es fin de mes, de trimestre y de año, y gotobi', () => {
  const block = buildExecutionWindows('2026-12-31T12:00:00+01:00');
  assert.equal(block.tz, 'Africa/Malabo');
  assert.equal(block.analysis.date, '2026-12-31');
  assert.equal(block.analysis.eom, true);
  assert.equal(block.analysis.qend_window, true);
  assert.equal(block.analysis.yend_window, true);
  assert.equal(block.analysis.gotobi, true);
  assert.equal(block.analysis.fix_tokyo.wat, '01:55');
  assert.equal(block.analysis.fix_tokyo.gotobi, true);
  assert.equal(block.analysis.fix_london.wat, '17:00');
  assert.equal(block.analysis.nyc_cut.wat, '16:00');
  assert.deepEqual(block.analysis.blocked_entry, [
    { fix: 'fix_tokyo', from: '00:55', to: '01:55' },
    { fix: 'fix_london', from: '16:00', to: '17:00' },
  ]);
  assert.equal(executionWindowHeader(block), '⏱ Fin de trimestre y de año T-0 · gotobi');
  assert.equal(block.next_business_day.date, '2027-01-04');
});

test('2026-12-25 sigue siendo gotobi: Tokio abre, Londres y Nueva York no', () => {
  const block = buildExecutionWindows('2026-12-25T12:00:00+01:00');
  assert.equal(block.analysis.date, '2026-12-25');
  assert.equal(weekday('2026-12-25'), 5);
  assert.equal(block.analysis.gotobi, true);
  assert.equal(block.analysis.fix_tokyo.gotobi, true);
  assert.equal(block.analysis.eom, false);
  assert.equal(block.analysis.qend_window, false);
  assert.equal(block.analysis.yend_window, false);
  assert.equal(block.analysis.fix_tokyo.wat, '01:55');
  assert.equal(block.analysis.fix_london.wat, '17:00');
  assert.equal(block.analysis.nyc_cut.wat, '16:00');
  assert.equal(block.analysis.blocked_entry.some((band) => band.fix === 'nyc_cut'), false);
  assert.equal(block.analysis.blocked_entry.length, 2);
  assert.equal(block.next_business_day.date, '2026-12-29');
});

test('2027-12-31 no es sesión hábil: Nueva York observa el año nuevo', () => {
  const block = buildExecutionWindows('2027-12-31T12:00:00+01:00');
  assert.equal(block.analysis.eom, false);
  assert.equal(block.analysis.qend_window, false);
  assert.equal(block.analysis.gotobi, true);
  const eve = buildExecutionWindows('2027-12-30T12:00:00+01:00');
  assert.equal(eve.analysis.eom, true);
  assert.equal(eve.analysis.qend_window, true);
  assert.equal(eve.analysis.yend_window, true);
});

test('la cabecera nombra la ventana y el gotobi del día siguiente, sin dirección', () => {
  const quarter = buildExecutionWindows('2026-03-24T12:00:00+01:00');
  assert.equal(quarter.analysis.qend_window, true);
  assert.equal(quarter.analysis.yend_window, false);
  assert.equal(quarter.analysis.gotobi, false);
  assert.equal(quarter.next_business_day.date, '2026-03-25');
  assert.equal(quarter.next_business_day.gotobi, true);
  assert.equal(executionWindowHeader(quarter), '⏱ Fin de trimestre T-5 · gotobi mañana');
  const quiet = buildExecutionWindows('2026-11-11T12:00:00+01:00');
  assert.equal(quiet.analysis.eom, false);
  assert.equal(quiet.next_business_day.date, '2026-11-12');
  assert.equal(executionWindowHeader(quiet), '⏱ sin ventana');
  const tomorrow = buildExecutionWindows('2026-11-12T12:00:00+01:00');
  assert.equal(tomorrow.analysis.gotobi, false);
  assert.equal(tomorrow.next_business_day.gotobi, true);
  assert.equal(executionWindowHeader(tomorrow), '⏱ gotobi mañana');
  const outside = buildExecutionWindows('2028-06-15T12:00:00+01:00');
  assert.equal(outside.status, 'UNAVAILABLE');
  assert.equal(executionWindowHeader(outside), '⏱ calendario no disponible');
  assert.doesNotMatch(executionWindowHeader(quarter), FORBIDDEN);
  assert.doesNotMatch(executionWindowHeader(tomorrow), FORBIDDEN);
});

test('el feed IRIS suma execution_windows y conserva el contrato', () => {
  const source = readFileSync(new URL('../src/executionWindows.js', import.meta.url), 'utf8');
  const browser = readFileSync(new URL('../public/executionWindows.js', import.meta.url), 'utf8');
  assert.equal(browser, source);
  assert.doesNotMatch(source, /from\s+['"][^'"]*fixingCalendar/);
  assert.doesNotMatch(source, FORBIDDEN);
  const workflow = readFileSync(new URL('../.github/workflows/update_radar_news.yml', import.meta.url), 'utf8');
  assert.match(workflow, /test\/execution_windows\.test\.js/);
  const feed = projectIrisFeed({
    version: '3.0.0',
    engine_version: 'mmt-agent-op-v4.1-G8',
    generated_at: '2026-11-12T00:20:40.609Z',
    health: { status: 'CLEAN', sources_live: 35 },
    coverage: { USD: { silence: false } },
    risk_map: [{ currency: 'USD', risk_level: 'BAJO' }],
    pair_risk: [],
    agenda_window: [{ lock_class: 'DECISION_BC', lock_level: 'TOTAL' }],
    polymarket_geo: { status: 'STALE', updated_at: null, markets: [] },
    items: [{ title: 'se queda' }],
    currency_ranking_mmt: [{ bias: 'fuera' }],
  });
  assert.equal(feed.schema_version, 'iris-g8-feed/v3-risk');
  assert.equal(feed.llm_calls, 0);
  assert.deepEqual(Object.keys(feed), IRIS_KEYS);
  assert.equal(feed.items[0].title, 'se queda');
  assert.equal(feed.health.sources_live, 35);
  assert.equal(feed.agenda_window[0].lock_level, 'TOTAL');
  assert.equal(Object.hasOwn(feed, 'currency_ranking_mmt'), false);
  assert.deepEqual(feed.execution_windows, buildExecutionWindows('2026-11-12T00:20:40.609Z'));
  const published = JSON.parse(readFileSync(new URL('../public/data/iris_g8_feed.json', import.meta.url), 'utf8'));
  assert.deepEqual(Object.keys(published), IRIS_KEYS);
  assert.equal(published.llm_calls, 0);
  assert.deepEqual(published.execution_windows, buildExecutionWindows(published.generated_at));
});
