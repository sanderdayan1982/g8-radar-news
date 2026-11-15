import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildExecutionWindows,
  executionWindowHeader,
  fetchFxvolShadow,
  fiscalCalendar,
  FXVOL_MAX_AGE_MS,
  FXVOL_SHADOW_URL,
  shiftGotobi,
} from '../src/executionWindows.js';

const SHADOW_KEYS = ['fx_roll', 'imm', 'opex', 'fiscal_jp', 'fiscal_us'];

const PUBLISHED_BEFORE = {
  tz: 'Africa/Malabo',
  analysis: {
    date: '2026-11-15',
    eom: false,
    qend_window: false,
    yend_window: false,
    gotobi: false,
    fix_tokyo: { wat: '01:55', gotobi: false },
    fix_london: { wat: '17:00' },
    nyc_cut: { wat: '16:00' },
    blocked_entry: [],
  },
  next_business_day: {
    date: '2026-11-16',
    eom: false,
    qend_window: false,
    yend_window: false,
    gotobi: false,
    fix_tokyo: { wat: '01:55', gotobi: false },
    fix_london: { wat: '17:00' },
    nyc_cut: { wat: '16:00' },
    blocked_entry: [],
  },
};

function weekday(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
}

function legacyDay(day) {
  const copy = { ...day };
  for (const key of SHADOW_KEYS) delete copy[key];
  return copy;
}

function legacyWindows(block) {
  return {
    tz: block.tz,
    analysis: legacyDay(block.analysis),
    next_business_day: block.next_business_day === 'UNAVAILABLE'
      ? 'UNAVAILABLE'
      : legacyDay(block.next_business_day),
  };
}

function docAt(instant, ageMs, roll, currencies = {}) {
  return {
    generated_utc: new Date(Date.parse(instant) - ageMs).toISOString(),
    fut_roll_window: roll,
    currencies,
  };
}

function fresh(instant, roll, currencies) {
  return docAt(instant, 0, roll, currencies);
}

function walk(value, visit) {
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visit);
    return;
  }
  if (value != null && typeof value === 'object') {
    for (const item of Object.values(value)) walk(item, visit);
    return;
  }
  visit(value);
}

test('la copia public/executionWindows.js es idéntica byte a byte', () => {
  const source = readFileSync(new URL('../src/executionWindows.js', import.meta.url));
  const browser = readFileSync(new URL('../public/executionWindows.js', import.meta.url));
  assert.equal(Buffer.compare(source, browser), 0);
  const text = source.toString('utf8');
  assert.doesNotMatch(text, /\|\|\s*0\b/);
  assert.doesNotMatch(text, /\bor 0\b/);
});

test('el JSON ausente deja fx_roll, imm y opex en UNAVAILABLE y no toca lo publicado', () => {
  const instant = '2026-11-15T13:18:53.268Z';
  const block = buildExecutionWindows(instant);
  assert.equal(block.analysis.fx_roll.status, 'UNAVAILABLE');
  assert.equal(block.analysis.fx_roll.reason, 'MISSING');
  assert.equal(block.analysis.fx_roll.start, null);
  assert.equal(block.analysis.fx_roll.end, null);
  assert.equal(block.analysis.fx_roll.active, null);
  assert.equal(block.analysis.fx_roll.state, 'UNAVAILABLE');
  assert.equal(block.analysis.imm.status, 'UNAVAILABLE');
  assert.equal(block.analysis.imm.date, null);
  assert.equal(block.analysis.opex.status, 'UNAVAILABLE');
  assert.equal(block.analysis.opex.currencies, null);
  assert.equal(block.analysis.opex.earliest, null);
  assert.match(block.analysis.opex.note, /DTE >= 7/);
  assert.match(block.analysis.opex.note, /no todos los vencimientos/);
  assert.equal(block.analysis.fiscal_jp.start, '2026-04-01');
  assert.equal(block.analysis.fiscal_jp.end, '2027-03-31');
  assert.equal(block.analysis.fiscal_jp.state, 'INSIDE');
  assert.equal(block.analysis.fiscal_us.start, '2026-10-01');
  assert.equal(block.analysis.fiscal_us.end, '2027-09-30');
  assert.equal(block.analysis.fiscal_us.state, 'INSIDE');
  assert.deepEqual(block.analysis.fiscal_us.baseline.map((row) => row.date), [
    '2026-12-15', '2027-01-15', '2027-04-15', '2027-06-15', '2027-09-15',
  ]);
  for (const row of block.analysis.fiscal_us.baseline) {
    assert.equal(row.scope, 'BASELINE');
    assert.equal(row.effect, 'TGA/reserves');
  }
  assert.deepEqual(legacyWindows(block), PUBLISHED_BEFORE);
  assert.equal(executionWindowHeader(block), '⏱ sin ventana');
  for (const key of SHADOW_KEYS) {
    walk(block.analysis[key], (leaf) => {
      assert.notEqual(leaf, 0);
    });
  }
  const iris = JSON.parse(readFileSync(new URL('../public/data/iris_g8_feed.json', import.meta.url), 'utf8'));
  const full = JSON.parse(readFileSync(new URL('../public/data/radar_news_full.json', import.meta.url), 'utf8'));
  assert.deepEqual(legacyWindows(iris.execution_windows), PUBLISHED_BEFORE);
  assert.deepEqual(legacyWindows(full.execution_windows), PUBLISHED_BEFORE);
  assert.equal(iris.execution_windows.analysis.fx_roll.start, '2026-12-07');
  assert.equal(iris.execution_windows.analysis.fx_roll.end, '2026-12-19');
  assert.equal(iris.execution_windows.analysis.fx_roll.active, false);
  assert.equal(iris.execution_windows.analysis.fx_roll.state, 'BEFORE');
  assert.equal(iris.execution_windows.analysis.imm.reason, 'ABSENT');
  assert.equal(iris.execution_windows.analysis.imm.date, null);
  assert.equal(iris.execution_windows.analysis.opex.currencies.EUR.exp1, '2026-12-04');
  assert.equal(iris.execution_windows.analysis.opex.currencies.EUR.dte1, 22);
  assert.equal(iris.execution_windows.analysis.opex.currencies.NZD.exp1, null);
  assert.equal(iris.execution_windows.analysis.opex.currencies.NZD.dte1, null);
  assert.deepEqual(full.execution_windows, iris.execution_windows);
});

test('los bordes de fx_roll son inclusivos y la ventana no se mueve en fin de semana ni en festivo', () => {
  const roll = { start: '2026-11-14', end: '2026-11-16', active: false };
  assert.equal(weekday('2026-11-14'), 6);
  const sunday = '2026-11-15T12:00:00Z';
  const onWeekend = buildExecutionWindows(sunday, fresh(sunday, roll));
  assert.equal(onWeekend.analysis.fx_roll.state, 'INSIDE');
  assert.equal(onWeekend.analysis.fx_roll.start, '2026-11-14');
  assert.equal(onWeekend.analysis.fx_roll.end, '2026-11-16');
  assert.equal(onWeekend.analysis.fx_roll.active, false);

  const friday = '2026-11-13T12:00:00Z';
  const before = buildExecutionWindows(friday, fresh(friday, { start: '2026-11-16', end: '2026-11-18', active: true }));
  assert.equal(before.analysis.date, '2026-11-13');
  assert.equal(before.analysis.fx_roll.state, 'BEFORE');
  assert.equal(before.analysis.fx_roll.active, true);
  assert.equal(before.next_business_day.date, '2026-11-16');
  assert.equal(before.next_business_day.fx_roll.state, 'INSIDE');
  assert.equal(before.next_business_day.fx_roll.start, '2026-11-16');

  const last = '2026-11-18T12:00:00Z';
  const edge = buildExecutionWindows(last, fresh(last, { start: '2026-11-16', end: '2026-11-18', active: false }));
  assert.equal(edge.analysis.fx_roll.state, 'INSIDE');
  assert.equal(edge.next_business_day.date, '2026-11-19');
  assert.equal(edge.next_business_day.fx_roll.state, 'AFTER');
  assert.equal(edge.next_business_day.fx_roll.end, '2026-11-18');

  const after = '2026-11-19T12:00:00Z';
  const past = buildExecutionWindows(after, fresh(after, { start: '2026-11-16', end: '2026-11-18', active: false }));
  assert.equal(past.analysis.fx_roll.state, 'AFTER');

  const holiday = '2026-12-25T12:00:00Z';
  const xmas = { start: '2026-12-24', end: '2026-12-26', active: false };
  const closed = buildExecutionWindows(holiday, fresh(holiday, xmas, { EUR: { exp1: '2026-12-04', dte1: 22 } }));
  const plain = buildExecutionWindows(holiday);
  assert.equal(closed.analysis.fx_roll.state, 'INSIDE');
  assert.equal(closed.analysis.fx_roll.start, '2026-12-24');
  assert.equal(closed.analysis.fx_roll.end, '2026-12-26');
  assert.deepEqual(legacyWindows(closed), legacyWindows(plain));
  assert.equal(closed.analysis.gotobi, true);
  assert.deepEqual(closed.analysis.blocked_entry.map((band) => band.fix), ['fix_tokyo', 'fix_london']);
});

test('el cambio horario de marzo, de octubre y de noviembre no mueve la ventana FX', () => {
  const roll = { start: '2026-03-01', end: '2026-11-30', active: false };
  const samples = [
    ['2026-03-06T12:00:00Z', '17:00', '16:00'],
    ['2026-03-09T12:00:00Z', '17:00', '15:00'],
    ['2026-03-30T12:00:00Z', '16:00', '15:00'],
    ['2026-10-23T12:00:00Z', '16:00', '15:00'],
    ['2026-10-26T12:00:00Z', '17:00', '15:00'],
    ['2026-10-30T12:00:00Z', '17:00', '15:00'],
    ['2026-11-02T12:00:00Z', '17:00', '16:00'],
  ];
  for (const [instant, london, nyc] of samples) {
    const withDoc = buildExecutionWindows(instant, fresh(instant, roll));
    const without = buildExecutionWindows(instant);
    assert.equal(withDoc.analysis.fx_roll.state, 'INSIDE');
    assert.equal(withDoc.analysis.fx_roll.start, roll.start);
    assert.equal(withDoc.analysis.fx_roll.end, roll.end);
    assert.equal(withDoc.analysis.fix_london.wat, london);
    assert.equal(withDoc.analysis.nyc_cut.wat, nyc);
    assert.deepEqual(legacyWindows(withDoc), legacyWindows(without));
  }
});

test('un JSON viejo o futuro no presta start, active, imm ni exp1', () => {
  const instant = '2026-11-15T12:00:00.000Z';
  const body = {
    fut_roll_window: { start: '2026-12-07', end: '2026-12-19', active: true, imm: '2026-12-16' },
    currencies: { EUR: { exp1: '2026-12-04', dte1: 22 }, JPY: { exp1: '2026-12-11', dte1: 29 } },
  };
  const stale = buildExecutionWindows(instant, docAt(instant, FXVOL_MAX_AGE_MS + 1, body.fut_roll_window, body.currencies));
  assert.equal(stale.analysis.fx_roll.status, 'UNAVAILABLE');
  assert.equal(stale.analysis.fx_roll.reason, 'STALE');
  assert.equal(stale.analysis.fx_roll.start, null);
  assert.equal(stale.analysis.fx_roll.active, null);
  assert.equal(stale.analysis.imm.date, null);
  assert.equal(stale.analysis.imm.reason, 'STALE');
  assert.equal(stale.analysis.opex.currencies, null);
  assert.equal(stale.analysis.opex.earliest, null);

  const edge = buildExecutionWindows(instant, docAt(instant, FXVOL_MAX_AGE_MS, body.fut_roll_window, body.currencies));
  assert.equal(edge.analysis.fx_roll.status, 'OK');
  assert.equal(edge.analysis.fx_roll.start, '2026-12-07');
  assert.equal(edge.analysis.fx_roll.state, 'BEFORE');
  assert.equal(edge.analysis.imm.date, '2026-12-16');

  const future = buildExecutionWindows(instant, docAt(instant, -1, body.fut_roll_window, body.currencies));
  assert.equal(future.analysis.fx_roll.reason, 'STALE');
  assert.equal(future.analysis.opex.earliest, null);

  const first = buildExecutionWindows(instant, fresh(instant, body.fut_roll_window, body.currencies));
  const second = buildExecutionWindows(instant, null);
  assert.equal(first.analysis.fx_roll.start, '2026-12-07');
  assert.equal(second.analysis.fx_roll.start, null);
  assert.equal(second.analysis.opex.currencies, null);
});

test('imm se lee si viene y no se calcula si falta; opex no funde exp1', () => {
  const instant = '2026-11-15T12:00:00Z';
  const absent = buildExecutionWindows(instant, fresh(instant, {
    start: '2026-12-07', end: '2026-12-19', active: false,
  }, {
    EUR: { exp1: '2026-12-04', dte1: 22 },
  }));
  assert.equal(absent.analysis.fx_roll.status, 'OK');
  assert.equal(absent.analysis.imm.status, 'UNAVAILABLE');
  assert.equal(absent.analysis.imm.reason, 'ABSENT');
  assert.equal(absent.analysis.imm.date, null);

  const echoed = buildExecutionWindows(instant, fresh(instant, {
    start: '2026-12-07', end: '2026-12-19', active: false, imm: '2026-12-17',
  }));
  assert.equal(echoed.analysis.imm.date, '2026-12-17');
  assert.notEqual(echoed.analysis.imm.date, '2026-12-16');

  const broken = buildExecutionWindows(instant, fresh(instant, {
    start: '2026-12-19', end: '2026-12-07', active: 0, imm: 0,
  }));
  assert.equal(broken.analysis.fx_roll.status, 'UNAVAILABLE');
  assert.equal(broken.analysis.fx_roll.reason, 'INVALID');
  assert.equal(broken.analysis.fx_roll.active, null);
  assert.equal(broken.analysis.imm.date, null);

  const keptZero = buildExecutionWindows(instant, fresh(instant, {
    start: '2026-12-07', end: '2026-12-19', active: false,
  }, { EUR: { exp1: '2026-12-04', dte1: 0 } }));
  assert.equal(keptZero.analysis.opex.currencies.EUR.dte1, 0);
  const missingDte = buildExecutionWindows(instant, fresh(instant, {
    start: '2026-12-07', end: '2026-12-19', active: false,
  }, { EUR: { exp1: '2026-12-04' } }));
  assert.equal(missingDte.analysis.opex.currencies.EUR.exp1, '2026-12-04');
  assert.equal(missingDte.analysis.opex.currencies.EUR.dte1, null);

  const split = buildExecutionWindows(instant, fresh(instant, {
    start: '2026-12-07', end: '2026-12-19', active: false,
  }, {
    JPY: { exp1: '2026-12-11', dte1: 29 },
    EUR: { exp1: '2026-12-04', dte1: 22 },
    GBP: { exp1: '2026-12-04', dte1: 22 },
    NZD: { status: 'NA' },
  }));
  assert.equal(split.analysis.opex.currencies.EUR.exp1, '2026-12-04');
  assert.equal(split.analysis.opex.currencies.JPY.exp1, '2026-12-11');
  assert.equal(split.analysis.opex.currencies.GBP.exp1, '2026-12-04');
  assert.equal(split.analysis.opex.currencies.NZD.exp1, null);
  assert.equal(split.analysis.opex.currencies.NZD.dte1, null);
  assert.deepEqual(split.analysis.opex.earliest, { exp1: '2026-12-04', currencies: ['EUR', 'GBP'] });
  assert.match(split.analysis.opex.note, /no todos los vencimientos/);
  assert.deepEqual(Object.keys(split.analysis.opex.currencies), ['EUR', 'JPY', 'GBP', 'NZD']);
});

test('el 31-mar en sábado sigue siendo el cierre fiscal y el 15 que cae en domingo no se mueve', () => {
  assert.equal(weekday('2029-03-31'), 6);
  const end = fiscalCalendar('2029-03-31');
  assert.equal(end.fiscal_jp.start, '2028-04-01');
  assert.equal(end.fiscal_jp.end, '2029-03-31');
  assert.equal(end.fiscal_jp.state, 'INSIDE');
  assert.equal(weekday('2029-04-01'), 0);
  const next = fiscalCalendar('2029-04-01');
  assert.equal(next.fiscal_jp.start, '2029-04-01');
  assert.equal(next.fiscal_jp.state, 'INSIDE');

  const covered = buildExecutionWindows('2027-03-31T12:00:00+01:00');
  assert.equal(covered.analysis.fiscal_jp.end, '2027-03-31');
  assert.equal(covered.analysis.fiscal_jp.state, 'INSIDE');
  const opened = buildExecutionWindows('2026-04-01T12:00:00+01:00');
  assert.equal(opened.analysis.fiscal_jp.start, '2026-04-01');
  assert.equal(opened.analysis.fiscal_jp.state, 'INSIDE');
  const usEnd = buildExecutionWindows('2026-09-30T12:00:00+01:00');
  assert.equal(usEnd.analysis.fiscal_us.end, '2026-09-30');
  assert.equal(usEnd.analysis.fiscal_us.state, 'INSIDE');
  const usOpen = buildExecutionWindows('2026-10-01T12:00:00+01:00');
  assert.equal(usOpen.analysis.fiscal_us.start, '2026-10-01');
  assert.equal(usOpen.analysis.fiscal_us.state, 'INSIDE');

  assert.equal(weekday('2025-06-15'), 0);
  const baseline = fiscalCalendar('2025-06-15').fiscal_us.baseline;
  assert.equal(baseline.find((row) => row.date === '2025-06-15').scope, 'BASELINE');
  assert.equal(baseline.some((row) => row.date === '2025-06-16'), false);
  assert.equal(baseline.some((row) => row.date === '2025-06-13'), false);
  assert.equal(baseline.length, 5);
});

test('Tokio deja de tratar el 31-dic como hábil y el 2 y el 3 de enero están en la tabla', () => {
  const source = readFileSync(new URL('../src/executionWindows.js', import.meta.url), 'utf8');
  for (const iso of ['2026-12-31', '2027-01-02', '2027-01-03', '2027-12-31', '2026-01-01', '2027-01-01']) {
    assert.match(source, new RegExp(`'${iso}'`));
  }
  assert.match(source, /2028-01-02/);
  assert.match(source, /2028-01-03/);
  assert.equal(buildExecutionWindows('2028-01-03T12:00:00+01:00').status, 'UNAVAILABLE');

  const eve = buildExecutionWindows('2026-12-30T12:00:00+01:00');
  assert.equal(eve.analysis.date, '2026-12-30');
  assert.notEqual(eve.next_business_day.date, '2026-12-31');
  assert.equal(eve.next_business_day.date, '2027-01-04');
  assert.equal(eve.analysis.eom, true);
  assert.equal(eve.analysis.gotobi, true);

  const yearEnd = buildExecutionWindows('2026-12-31T12:00:00+01:00');
  assert.equal(yearEnd.analysis.eom, false);
  assert.equal(yearEnd.analysis.qend_window, false);
  assert.equal(yearEnd.analysis.yend_window, false);
  assert.equal(yearEnd.analysis.gotobi, false);
  assert.deepEqual(yearEnd.analysis.blocked_entry, []);
  assert.equal(executionWindowHeader(yearEnd), '⏱ sin ventana');
  assert.equal(yearEnd.next_business_day.date, '2027-01-04');
  assert.equal(shiftGotobi('2026-12-31'), '2026-12-30');

  const nextYear = buildExecutionWindows('2027-12-31T12:00:00+01:00');
  assert.equal(nextYear.analysis.eom, false);
  assert.equal(nextYear.analysis.gotobi, false);
  assert.deepEqual(nextYear.analysis.blocked_entry, []);
  assert.equal(executionWindowHeader(nextYear), '⏱ sin ventana');
  assert.equal(shiftGotobi('2027-12-31'), '2027-12-30');
  const untouchedSunday = buildExecutionWindows('2027-12-26T12:00:00+01:00');
  assert.equal(weekday('2027-12-26'), 0);
  assert.equal(untouchedSunday.analysis.gotobi, 'UNAVAILABLE');
  const beforeNext = buildExecutionWindows('2027-12-30T12:00:00+01:00');
  assert.equal(beforeNext.analysis.eom, true);
  assert.notEqual(beforeNext.next_business_day, '2027-12-31');
  assert.notEqual(beforeNext.next_business_day?.date, '2027-01-02');
  assert.notEqual(beforeNext.next_business_day?.date, '2027-01-03');
});

test('fetchFxvolShadow pide el JSON publicado y un fallo es null', async () => {
  const calls = [];
  const doc = await fetchFxvolShadow(async (url) => {
    calls.push(url);
    return {
      ok: true,
      json: async () => ({
        generated_utc: '2026-11-15T12:00:00Z',
        fut_roll_window: { start: '2026-12-07', end: '2026-12-19', active: false },
        currencies: { EUR: { exp1: '2026-12-04', dte1: 22 } },
      }),
    };
  });
  assert.deepEqual(calls, [FXVOL_SHADOW_URL]);
  const block = buildExecutionWindows('2026-11-15T12:00:00Z', doc);
  assert.equal(block.analysis.fx_roll.start, '2026-12-07');
  assert.equal(block.analysis.fx_roll.active, false);
  assert.equal(block.analysis.opex.currencies.EUR.exp1, '2026-12-04');
  assert.equal(await fetchFxvolShadow(async () => { throw new Error('down'); }), null);
  assert.equal(await fetchFxvolShadow(async () => ({ ok: false, json: async () => ({}) })), null);
});
