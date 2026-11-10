import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  LOCK_WINDOW_H,
  POST_EVENT_WINDOW_H,
  RETIRAR_LIMITADAS_H,
  classifyEventLock,
  buildAgendaWindow,
  lockSeverityIndex,
} from '../src/lockSeverity.js';
import { computeCalendarLock } from '../src/classifyCurrencies.js';
import { computeLiveCalendarBadge } from '../public/app.js';

const NOW = Date.parse('2026-11-10T12:00:00.000Z');
const H = 3_600_000;

function at(offsetMs) {
  return new Date(NOW + offsetMs).toISOString();
}

function event({ title, impact = null, offsetMs, currency = 'USD', actual = null, forecast = null, previous = null }) {
  return {
    id: `${currency}-${title}-${offsetMs}`,
    currency,
    title,
    impact,
    event_at: at(offsetMs),
    actual,
    forecast,
    previous,
  };
}

test('constantes congeladas: 48 h, POST-EVENTO 24 h, retirar limitadas 2 h', () => {
  assert.equal(LOCK_WINDOW_H, 48);
  assert.equal(POST_EVENT_WINDOW_H, 24);
  assert.equal(RETIRAR_LIMITADAS_H, 2);
  assert.ok(lockSeverityIndex('TOTAL') < lockSeverityIndex('TIER1'));
  assert.ok(lockSeverityIndex('TIER1') < lockSeverityIndex('NO_AMPLIAR'));
  assert.ok(lockSeverityIndex('NO_AMPLIAR') < lockSeverityIndex('AVISO'));
  assert.ok(lockSeverityIndex('AVISO') < lockSeverityIndex('NINGUNO'));
});

test('Federal Funds Rate → TOTAL', () => {
  const row = classifyEventLock(event({ title: 'Federal Funds Rate', offsetMs: 10 * H }), NOW);
  assert.equal(row.lock_class, 'DECISION_BC');
  assert.equal(row.lock_level, 'TOTAL');
  const lower = classifyEventLock(event({ title: 'federal funds rate', offsetMs: 10 * H }), NOW);
  assert.equal(lower.lock_level, 'TOTAL');
});

test('BOJ Policy Rate → TOTAL', () => {
  const row = classifyEventLock(event({ title: 'BOJ Policy Rate', currency: 'JPY', offsetMs: 12 * H }), NOW);
  assert.equal(row.lock_class, 'DECISION_BC');
  assert.equal(row.lock_level, 'TOTAL');
});

test('FOMC Member Bowman Speaks → NO_AMPLIAR', () => {
  const row = classifyEventLock(event({
    title: 'FOMC Member Bowman Speaks',
    impact: 'Medium',
    offsetMs: 10 * H,
  }), NOW);
  assert.equal(row.lock_class, 'DISCURSO');
  assert.equal(row.lock_level, 'NO_AMPLIAR');
  assert.equal(row.retirar_limitadas, false);
});

test('FOMC Member Bowman Speaks a 1,5 h → retirar_limitadas: true', () => {
  const row = classifyEventLock(event({
    title: 'FOMC Member Bowman Speaks',
    impact: 'Medium',
    offsetMs: 1.5 * H,
  }), NOW);
  assert.equal(row.lock_level, 'NO_AMPLIAR');
  assert.equal(row.hours_until, 1.5);
  assert.equal(row.retirar_limitadas, true);
  const atTwo = classifyEventLock(event({
    title: 'FOMC Member Bowman Speaks',
    impact: 'Medium',
    offsetMs: 2 * H,
  }), NOW);
  assert.equal(atTwo.retirar_limitadas, true);
  const afterTwo = classifyEventLock(event({
    title: 'FOMC Member Bowman Speaks',
    impact: 'Medium',
    offsetMs: 2 * H + 60_000,
  }), NOW);
  assert.equal(afterTwo.lock_level, 'NO_AMPLIAR');
  assert.equal(afterTwo.retirar_limitadas, false);
});

test('GDP m/m High → TIER1', () => {
  const row = classifyEventLock(event({ title: 'GDP m/m', impact: 'High', offsetMs: 20 * H }), NOW);
  assert.equal(row.lock_class, 'TIER1_DATO');
  assert.equal(row.lock_level, 'TIER1');
  const medium = classifyEventLock(event({ title: 'GDP m/m', impact: 'Medium', offsetMs: 20 * H }), NOW);
  assert.equal(medium.lock_class, null);
  assert.equal(medium.lock_level, 'NINGUNO');
});

test('CPI y/y High → TIER1', () => {
  const row = classifyEventLock(event({ title: 'CPI y/y', impact: 'High', offsetMs: 8 * H }), NOW);
  assert.equal(row.lock_class, 'TIER1_DATO');
  assert.equal(row.lock_level, 'TIER1');
});

test('Annual Budget Release → TOTAL', () => {
  const row = classifyEventLock(event({ title: 'Annual Budget Release', offsetMs: 16 * H }), NOW);
  assert.equal(row.lock_class, 'PRESUPUESTO');
  assert.equal(row.lock_level, 'TOTAL');
});

test('ISM Services PMI High → AVISO', () => {
  const row = classifyEventLock(event({ title: 'ISM Services PMI', impact: 'High', offsetMs: 6 * H }), NOW);
  assert.equal(row.lock_class, 'OTRO_HIGH');
  assert.equal(row.lock_level, 'AVISO');
});

test('FOMC Member Bowman Speaks Low a 10 h → NINGUNO (clase DISCURSO)', () => {
  const row = classifyEventLock(event({
    title: 'FOMC Member Bowman Speaks',
    impact: 'Low',
    offsetMs: 10 * H,
  }), NOW);
  assert.equal(row.lock_class, 'DISCURSO');
  assert.equal(row.lock_level, 'NINGUNO');
  assert.equal(row.retirar_limitadas, false);
  const unlabeled = classifyEventLock(event({
    title: 'FOMC Member Bowman Speaks',
    offsetMs: 10 * H,
  }), NOW);
  assert.equal(unlabeled.lock_class, 'DISCURSO');
  assert.equal(unlabeled.lock_level, 'NINGUNO');
  assert.equal(unlabeled.retirar_limitadas, false);
  const agenda = buildAgendaWindow([event({
    title: 'FOMC Member Bowman Speaks',
    impact: 'Low',
    offsetMs: 10 * H,
  })], NOW);
  assert.equal(agenda.length, 1);
  assert.equal(agenda[0].title, 'FOMC Member Bowman Speaks');
  assert.equal(agenda[0].lock_class, 'DISCURSO');
  assert.equal(agenda[0].lock_level, 'NINGUNO');
  const lock = computeCalendarLock('USD', [event({
    title: 'FOMC Member Bowman Speaks',
    impact: 'Low',
    offsetMs: 10 * H,
  })], NOW);
  assert.equal(lock.lock_level, 'NINGUNO');
  assert.deepEqual(lock.lock_events, []);
});

test('ECB President Lagarde Speaks Medium a 14 h → NO_AMPLIAR', () => {
  const row = classifyEventLock(event({
    title: 'ECB President Lagarde Speaks',
    currency: 'EUR',
    impact: 'Medium',
    offsetMs: 14 * H,
  }), NOW);
  assert.equal(row.lock_class, 'DISCURSO');
  assert.equal(row.lock_level, 'NO_AMPLIAR');
  assert.equal(row.retirar_limitadas, false);
});

test('ECB President Lagarde Speaks Medium a 1,5 h → retirar_limitadas: true', () => {
  const row = classifyEventLock(event({
    title: 'ECB President Lagarde Speaks',
    currency: 'EUR',
    impact: 'Medium',
    offsetMs: 1.5 * H,
  }), NOW);
  assert.equal(row.lock_class, 'DISCURSO');
  assert.equal(row.lock_level, 'NO_AMPLIAR');
  assert.equal(row.hours_until, 1.5);
  assert.equal(row.retirar_limitadas, true);
});

test('MPC Member Pill Speaks Low a 1 h → NINGUNO y retirar_limitadas false', () => {
  const row = classifyEventLock(event({
    title: 'MPC Member Pill Speaks',
    currency: 'GBP',
    impact: 'Low',
    offsetMs: 1 * H,
  }), NOW);
  assert.equal(row.lock_class, 'DISCURSO');
  assert.equal(row.lock_level, 'NINGUNO');
  assert.equal(row.retirar_limitadas, false);
  const agenda = buildAgendaWindow([event({
    title: 'MPC Member Pill Speaks',
    currency: 'GBP',
    impact: 'Low',
    offsetMs: 1 * H,
  })], NOW);
  assert.equal(agenda.length, 1);
  assert.equal(agenda[0].lock_level, 'NINGUNO');
  const lock = computeCalendarLock('GBP', [
    event({ title: 'MPC Member Pill Speaks', currency: 'GBP', impact: 'Low', offsetMs: 1 * H }),
    event({ title: 'ISM Services PMI', currency: 'GBP', impact: 'High', offsetMs: 6 * H }),
  ], NOW);
  assert.equal(lock.lock_level, 'AVISO');
  assert.equal(lock.lock_events.some((e) => e.lock_class === 'DISCURSO'), false);
});

test('German Buba President Nagel Speaks → NO_AMPLIAR', () => {
  const row = classifyEventLock(event({
    title: 'German Buba President Nagel Speaks',
    currency: 'EUR',
    impact: 'Medium',
    offsetMs: 9 * H,
  }), NOW);
  assert.equal(row.lock_class, 'DISCURSO');
  assert.equal(row.lock_level, 'NO_AMPLIAR');
});

test('evento High a 49 h → NINGUNO', () => {
  const row = classifyEventLock(event({ title: 'Factory Orders', impact: 'High', offsetMs: 49 * H }), NOW);
  assert.equal(row.lock_level, 'NINGUNO');
  assert.equal(row.active, false);
  assert.equal(row.lock_class, 'OTRO_HIGH');
  const edge = classifyEventLock(event({ title: 'GDP m/m', impact: 'High', offsetMs: 48 * H }), NOW);
  assert.equal(edge.lock_level, 'TIER1');
});

test('divisa con DISCURSO y DECISION_BC activos → TOTAL', () => {
  const events = [
    event({ title: 'FOMC Member Bowman Speaks', impact: 'Medium', offsetMs: 5 * H }),
    event({ title: 'Federal Funds Rate', impact: 'High', offsetMs: 30 * H }),
  ];
  const lock = computeCalendarLock('USD', events, NOW);
  assert.equal(lock.lock_level, 'TOTAL');
  assert.equal(lock.lock_class, 'DECISION_BC');
  assert.equal(lock.calendar_lock, 'TOTAL');
  assert.equal(lock.lock_events.length, 2);
  const speech = lock.lock_events.find((e) => e.lock_class === 'DISCURSO');
  const decision = lock.lock_events.find((e) => e.lock_class === 'DECISION_BC');
  assert.equal(speech.title, 'FOMC Member Bowman Speaks');
  assert.equal(speech.time, events[0].event_at);
  assert.equal(speech.hours_until, 5);
  assert.equal(decision.title, 'Federal Funds Rate');
  assert.equal(decision.hours_until, 30);
  assert.equal(lock.retirar_limitadas, false);
});

test('la severidad elige TIER1 por encima de NO_AMPLIAR y AVISO', () => {
  const events = [
    event({ title: 'ISM Services PMI', impact: 'High', offsetMs: 40 * H }),
    event({ title: 'FOMC Member Bowman Speaks', impact: 'Medium', offsetMs: 20 * H }),
    event({ title: 'GDP m/m', impact: 'High', offsetMs: 30 * H }),
  ];
  const lock = computeCalendarLock('USD', events, NOW);
  assert.equal(lock.lock_level, 'TIER1');
  assert.equal(lock.lock_class, 'TIER1_DATO');
});

test('press conference gana a speaks: la primera clase que encaja', () => {
  const row = classifyEventLock(event({
    title: 'Powell Speaks at the Press Conference',
    offsetMs: 4 * H,
  }), NOW);
  assert.equal(row.lock_class, 'DECISION_BC');
  assert.equal(row.lock_level, 'TOTAL');
});

test('al publicarse el candado termina y POST-EVENTO dura 24 h con Act/Est/Prev', () => {
  const published = event({
    title: 'CPI y/y',
    impact: 'High',
    offsetMs: -4 * H,
    actual: '2.4%',
    forecast: '2.5%',
    previous: '2.6%',
  });
  const justOut = event({
    title: 'CPI y/y',
    impact: 'High',
    offsetMs: -24 * H - 60_000,
    actual: '2.1%',
    forecast: '2.2%',
    previous: '2.0%',
  });
  const atZero = classifyEventLock(event({
    title: 'Federal Funds Rate',
    offsetMs: 0,
    actual: '4.00%',
  }), NOW);
  assert.equal(atZero.lock_level, 'NINGUNO');
  assert.equal(atZero.in_post_window, true);

  const lock = computeCalendarLock('USD', [published], NOW);
  assert.equal(lock.lock_level, 'NINGUNO');
  assert.equal(lock.lock_events.length, 0);
  assert.equal(lock.calendar_lock, '✓ POST-EVENTO');
  assert.match(lock.post_event_status, /Act 2\.4% vs Est 2\.5%/);

  const expired = computeCalendarLock('USD', [justOut], NOW);
  assert.equal(expired.lock_level, 'NINGUNO');
  assert.equal(expired.post_event_status, null);
  assert.equal(expired.calendar_lock, null);

  const onTheHour = computeCalendarLock('USD', [event({
    title: 'GDP m/m',
    impact: 'High',
    offsetMs: -24 * H,
    actual: '0.2%',
    forecast: '0.1%',
    previous: '0.3%',
  })], NOW);
  assert.equal(onTheHour.calendar_lock, '✓ POST-EVENTO');
  assert.match(onTheHour.post_event_status, /Act 0\.2% vs Est 0\.1%/);
});

test('agenda_window lleva la clase y el nivel, y no repite el candado único', () => {
  const events = [
    event({ title: 'Federal Funds Rate', impact: 'High', offsetMs: 10 * H }),
    event({ title: 'FOMC Member Bowman Speaks', impact: 'Medium', offsetMs: 1.5 * H }),
    event({ title: 'ISM Services PMI', impact: 'High', offsetMs: 6 * H }),
    event({ title: 'CPI y/y', impact: 'High', offsetMs: -4 * H, actual: '2.4%', forecast: '2.5%', previous: '2.6%' }),
    event({ title: 'GDP m/m', impact: 'High', offsetMs: -30 * H, actual: '0.1%', forecast: '0.2%', previous: '0.0%' }),
    event({ title: 'Factory Orders', impact: 'High', offsetMs: 49 * H }),
    event({ title: 'Building Permits', impact: 'Low', offsetMs: 5 * H }),
  ];
  const agenda = buildAgendaWindow(events, NOW);
  const byTitle = Object.fromEntries(agenda.map((e) => [e.title, e]));

  assert.equal(byTitle['Federal Funds Rate'].lock_class, 'DECISION_BC');
  assert.equal(byTitle['Federal Funds Rate'].lock_level, 'TOTAL');
  assert.equal(byTitle['Federal Funds Rate'].window_status, 'TOTAL');
  assert.equal(byTitle['Federal Funds Rate'].retirar_limitadas, false);

  assert.equal(byTitle['FOMC Member Bowman Speaks'].lock_level, 'NO_AMPLIAR');
  assert.equal(byTitle['FOMC Member Bowman Speaks'].retirar_limitadas, true);
  assert.equal(byTitle['FOMC Member Bowman Speaks'].window_status, 'NO_AMPLIAR');

  assert.equal(byTitle['ISM Services PMI'].lock_level, 'AVISO');
  assert.equal(byTitle['ISM Services PMI'].window_status, 'AVISO');

  assert.equal(byTitle['CPI y/y'].lock_level, 'NINGUNO');
  assert.equal(byTitle['CPI y/y'].window_status, '✓ POST-EVENTO');
  assert.equal(byTitle['CPI y/y'].actual, '2.4%');
  assert.equal(byTitle['CPI y/y'].forecast, '2.5%');
  assert.equal(byTitle['CPI y/y'].previous, '2.6%');

  assert.ok(byTitle['GDP m/m'], 'un actual a -30 h sigue en la lista');
  assert.equal(byTitle['GDP m/m'].lock_level, 'NINGUNO');
  assert.equal(byTitle['GDP m/m'].window_status, null);
  assert.equal(byTitle['GDP m/m'].actual, '0.1%');

  assert.equal(byTitle['Factory Orders'], undefined);
  assert.equal(byTitle['Building Permits'].lock_class, null);
  assert.equal(byTitle['Building Permits'].lock_level, 'NINGUNO');
  assert.equal(byTitle['Building Permits'].window_status, null);

  for (const row of agenda) {
    assert.notEqual(row.window_status, '⚑BC <48h (Candado CIRO)');
  }
});

test('la UI distingue TOTAL, NO_AMPLIAR y AVISO y conserva POST-EVENTO', () => {
  const decision = computeLiveCalendarBadge('USD', {}, [
    event({ title: 'Federal Funds Rate', impact: 'High', offsetMs: 30 * H }),
    event({ title: 'FOMC Member Bowman Speaks', impact: 'Medium', offsetMs: 1.5 * H }),
  ], NOW);
  assert.match(decision, /TOTAL/);
  assert.match(decision, /Federal Funds Rate/);
  assert.match(decision, /retirar limitadas/);
  assert.doesNotMatch(decision, /Candado CIRO/);
  assert.doesNotMatch(decision, /⚑BC/);

  const speech = computeLiveCalendarBadge('EUR', {}, [
    event({ title: 'German Buba President Nagel Speaks', currency: 'EUR', impact: 'Medium', offsetMs: 9 * H }),
  ], NOW);
  assert.match(speech, /NO_AMPLIAR/);
  assert.doesNotMatch(speech, /TOTAL/);

  const aviso = computeLiveCalendarBadge('USD', {}, [
    event({ title: 'ISM Services PMI', impact: 'High', offsetMs: 6 * H }),
  ], NOW);
  assert.match(aviso, /AVISO/);
  assert.notEqual(decision, aviso);

  const post = computeLiveCalendarBadge('USD', {}, [
    event({
      title: 'CPI y/y',
      impact: 'High',
      offsetMs: -4 * H,
      actual: '2.4%',
      forecast: '2.5%',
      previous: '2.6%',
    }),
  ], NOW);
  assert.match(post, /POST-EVENTO/);
  assert.match(post, /Act 2\.4%/);
  assert.match(post, /2\.5%/);
  assert.doesNotMatch(post, /TIER1/);
});

test('el texto generado del candado no usa lenguaje de ejecución', () => {
  const events = [
    event({ title: 'Federal Funds Rate', impact: 'High', offsetMs: 10 * H }),
    event({ title: 'FOMC Member Bowman Speaks', impact: 'Medium', offsetMs: 1.5 * H }),
    event({ title: 'Annual Budget Release', offsetMs: 12 * H }),
  ];
  const lock = computeCalendarLock('USD', events, NOW);
  const badge = computeLiveCalendarBadge('USD', {}, events, NOW);
  const blob = `${lock.calendar_lock} ${lock.calendar_lock_detail} ${lock.post_event_status || ''} ${badge}`;
  assert.doesNotMatch(blob, /\b(long|short)\b/i);
  assert.doesNotMatch(blob, /sesgo largo|sesgo corto|vía libre operativa/i);
  assert.doesNotMatch(blob, /\bcompra\b|\bvende\b|subirá|bajará/i);
});

test('sincronización y función live no reimplementan el candado único', () => {
  const live = readFileSync(new URL('../netlify/functions/radar_live.mjs', import.meta.url), 'utf8');
  const sync = readFileSync(new URL('../scripts/sync_feeds.mjs', import.meta.url), 'utf8');
  const collector = readFileSync(new URL('../src/irisCollector.js', import.meta.url), 'utf8');
  assert.match(live, /collectRadarAndIrisData/);
  assert.match(sync, /collectRadarAndIrisData/);
  assert.match(collector, /buildAgendaWindow/);
  assert.doesNotMatch(live, /Candado CIRO/);
  assert.doesNotMatch(sync, /Candado CIRO/);
  assert.doesNotMatch(collector, /Candado CIRO/);
  assert.doesNotMatch(readFileSync(new URL('../public/app.js', import.meta.url), 'utf8'), /Candado CIRO/);
});
