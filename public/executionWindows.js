/**
 * Ventanas de ejecución (FLUJOS-01, Sander, 12-nov-2026).
 * Compuerta de timing en WAT (Africa/Malabo, UTC+1 fijo). Sin dirección.
 * No usa fixingCalendar.js: ese calendario es del BCE y de la calibración.
 *
 * Festivos, cada plaza con su tabla, solo 2026 y 2027 (lo publicado):
 * - Tokio: Cabinet Office / NAOJ. Festivo nacional, puente y día entre dos festivos.
 *   https://www8.cao.go.jp/chosei/shukujitsu/gaiyou.html
 * - Londres: bank holidays de Inglaterra y Gales. https://www.gov.uk/bank-holidays
 * - Nueva York: festivos federales observados, OPM, 5 U.S.C. 6103.
 *   https://www.opm.gov/policy-data-oversight/pay-leave/federal-holidays
 *   2027-12-31 es el festivo observado del 1-ene-2028 (tabla OPM de 2028).
 *
 * Sesión hábil: lunes a viernes que no está en ninguna de las tres tablas.
 * Fuera de 2026–2027 no hay tabla: el dato sale UNAVAILABLE.
 *
 * public/executionWindows.js es la misma copia: el navegador no importa src/.
 */

export const WAT_TZ = 'Africa/Malabo';
export const TOKYO_TZ = 'Asia/Tokyo';
export const LONDON_TZ = 'Europe/London';
export const NEW_YORK_TZ = 'America/New_York';

const COVERED_YEARS = new Set([2026, 2027]);

const TOKYO = new Set([
  '2026-01-01', '2026-01-12', '2026-02-11', '2026-02-23', '2026-03-20',
  '2026-04-29', '2026-05-03', '2026-05-04', '2026-05-05', '2026-05-06',
  '2026-07-20', '2026-08-11', '2026-09-21', '2026-09-22', '2026-09-23',
  '2026-10-12', '2026-11-03', '2026-11-23',
  '2027-01-01', '2027-01-11', '2027-02-11', '2027-02-23', '2027-03-21', '2027-03-22',
  '2027-04-29', '2027-05-03', '2027-05-04', '2027-05-05',
  '2027-07-19', '2027-08-11', '2027-09-20', '2027-09-23',
  '2027-10-11', '2027-11-03', '2027-11-23',
]);

const LONDON = new Set([
  '2026-01-01', '2026-04-03', '2026-04-06', '2026-05-04', '2026-05-25',
  '2026-08-31', '2026-12-25', '2026-12-28',
  '2027-01-01', '2027-03-26', '2027-03-29', '2027-05-03', '2027-05-31',
  '2027-08-30', '2027-12-27', '2027-12-28',
]);

const NEW_YORK = new Set([
  '2026-01-01', '2026-01-19', '2026-02-16', '2026-05-25', '2026-06-19',
  '2026-07-03', '2026-09-07', '2026-10-12', '2026-11-11', '2026-11-26', '2026-12-25',
  '2027-01-01', '2027-01-18', '2027-02-15', '2027-05-31', '2027-06-18',
  '2027-07-05', '2027-09-06', '2027-10-11', '2027-11-11', '2027-11-25',
  '2027-12-24', '2027-12-31',
]);

const QUARTER_MONTHS = new Set([3, 6, 9, 12]);
const GOTOBI_DAYS = [5, 10, 15, 20, 25];

function yearOf(iso) {
  return Number(iso.slice(0, 4));
}

function monthOf(iso) {
  return Number(iso.slice(5, 7));
}

function iso(year, month, day) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function addDays(value, n) {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n, 12)).toISOString().slice(0, 10);
}

function weekday(value) {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
}

function isWeekend(value) {
  const day = weekday(value);
  return day === 0 || day === 6;
}

function lastCalendarDay(year, month) {
  return new Date(Date.UTC(year, month, 0, 12)).getUTCDate();
}

function plazaClosed(value, table) {
  if (!COVERED_YEARS.has(yearOf(value))) return 'UNAVAILABLE';
  return table.has(value);
}

function isTokyoBusiness(value) {
  if (isWeekend(value)) return false;
  const closed = plazaClosed(value, TOKYO);
  if (closed === 'UNAVAILABLE') return 'UNAVAILABLE';
  return !closed;
}

function isSession(value) {
  if (isWeekend(value)) return false;
  for (const table of [TOKYO, LONDON, NEW_YORK]) {
    const closed = plazaClosed(value, table);
    if (closed === 'UNAVAILABLE') return 'UNAVAILABLE';
    if (closed) return false;
  }
  return true;
}

export function shiftGotobi(nominal) {
  let cursor = nominal;
  for (let i = 0; i < 40; i += 1) {
    const open = isTokyoBusiness(cursor);
    if (open === 'UNAVAILABLE') return 'UNAVAILABLE';
    if (open) return cursor;
    const prev = addDays(cursor, -1);
    if (!COVERED_YEARS.has(yearOf(prev)) && !isWeekend(prev)) return 'UNAVAILABLE';
    cursor = prev;
  }
  return 'UNAVAILABLE';
}

function gotobiSet(year, month) {
  if (!COVERED_YEARS.has(year)) return 'UNAVAILABLE';
  const days = [...GOTOBI_DAYS, lastCalendarDay(year, month)];
  const set = new Set();
  for (const day of days) {
    const adjusted = shiftGotobi(iso(year, month, day));
    if (adjusted === 'UNAVAILABLE') return 'UNAVAILABLE';
    set.add(adjusted);
  }
  return set;
}

function isGotobiDate(value) {
  const own = gotobiSet(yearOf(value), monthOf(value));
  if (own === 'UNAVAILABLE') return 'UNAVAILABLE';
  if (own.has(value)) return true;
  const month = monthOf(value);
  const nextYear = month === 12 ? yearOf(value) + 1 : yearOf(value);
  const nextMonth = month === 12 ? 1 : month + 1;
  if (!COVERED_YEARS.has(nextYear)) return 'UNAVAILABLE';
  const ahead = gotobiSet(nextYear, nextMonth);
  if (ahead === 'UNAVAILABLE') return 'UNAVAILABLE';
  return ahead.has(value);
}

function lastSessionOfMonth(year, month) {
  let cursor = iso(year, month, lastCalendarDay(year, month));
  for (let i = 0; i < 40; i += 1) {
    const session = isSession(cursor);
    if (session === 'UNAVAILABLE') return 'UNAVAILABLE';
    if (session) return cursor;
    const prev = addDays(cursor, -1);
    if (monthOf(prev) !== month) return 'UNAVAILABLE';
    cursor = prev;
  }
  return 'UNAVAILABLE';
}

function sessionsAfter(fromIso, endIso) {
  if (endIso === 'UNAVAILABLE') return 'UNAVAILABLE';
  let count = 0;
  let cursor = addDays(fromIso, 1);
  while (cursor <= endIso) {
    const session = isSession(cursor);
    if (session === 'UNAVAILABLE') return 'UNAVAILABLE';
    if (session) count += 1;
    cursor = addDays(cursor, 1);
  }
  return count;
}

function nextBusinessDay(value) {
  let cursor = addDays(value, 1);
  for (let i = 0; i < 40; i += 1) {
    const session = isSession(cursor);
    if (session === 'UNAVAILABLE') return 'UNAVAILABLE';
    if (session) return cursor;
    cursor = addDays(cursor, 1);
  }
  return 'UNAVAILABLE';
}

function inQendWindow(value) {
  if (!QUARTER_MONTHS.has(monthOf(value))) return false;
  const session = isSession(value);
  if (session === 'UNAVAILABLE') return 'UNAVAILABLE';
  if (!session) return false;
  const end = lastSessionOfMonth(yearOf(value), monthOf(value));
  const left = sessionsAfter(value, end);
  if (left === 'UNAVAILABLE') return 'UNAVAILABLE';
  return left <= 9;
}

function inYendWindow(value) {
  if (monthOf(value) !== 12) return false;
  return inQendWindow(value);
}

function isEom(value) {
  const session = isSession(value);
  if (session === 'UNAVAILABLE') return 'UNAVAILABLE';
  if (!session) return false;
  const end = lastSessionOfMonth(yearOf(value), monthOf(value));
  if (end === 'UNAVAILABLE') return 'UNAVAILABLE';
  return value === end;
}

function zonedOffsetMinutes(utcMs, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(utcMs)).map((part) => [part.type, part.value]));
  const hour = parts.hour === '24' ? 0 : Number(parts.hour);
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    hour,
    Number(parts.minute),
    Number(parts.second),
  );
  return Math.round((asUtc - utcMs) / 60000);
}

function zonedWallToUtc(value, hh, mm, timeZone) {
  const [y, m, d] = value.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm, 0);
  const first = zonedOffsetMinutes(guess, timeZone);
  let utc = guess - first * 60000;
  const second = zonedOffsetMinutes(utc, timeZone);
  if (second !== first) utc = guess - second * 60000;
  return utc;
}

function formatWat(utcMs) {
  const shifted = utcMs + zonedOffsetMinutes(utcMs, WAT_TZ) * 60000;
  const wall = new Date(shifted);
  const hh = String(wall.getUTCHours()).padStart(2, '0');
  const mm = String(wall.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function watOf(value, hh, mm, timeZone) {
  return formatWat(zonedWallToUtc(value, hh, mm, timeZone));
}

function minusHour(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const total = (h * 60 + m - 60 + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function blockedEntry(value, flags) {
  const triggers = [flags.eom, flags.qend_window, flags.yend_window, flags.gotobi];
  if (triggers.includes('UNAVAILABLE')) return 'UNAVAILABLE';
  if (!triggers.some(Boolean)) return [];
  const tokyo = watOf(value, 9, 55, TOKYO_TZ);
  const london = watOf(value, 16, 0, LONDON_TZ);
  return [
    { fix: 'fix_tokyo', from: minusHour(tokyo), to: tokyo },
    { fix: 'fix_london', from: minusHour(london), to: london },
  ];
}

function dayBlock(value) {
  const gotobi = isGotobiDate(value);
  const eom = isEom(value);
  const qendWindow = inQendWindow(value);
  const yendWindow = inYendWindow(value);
  return {
    date: value,
    eom,
    qend_window: qendWindow,
    yend_window: yendWindow,
    gotobi,
    fix_tokyo: { wat: watOf(value, 9, 55, TOKYO_TZ), gotobi },
    fix_london: { wat: watOf(value, 16, 0, LONDON_TZ) },
    nyc_cut: { wat: watOf(value, 10, 0, NEW_YORK_TZ) },
    blocked_entry: blockedEntry(value, {
      eom,
      qend_window: qendWindow,
      yend_window: yendWindow,
      gotobi,
    }),
  };
}

export function watDate(instant) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: WAT_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function buildExecutionWindows(instant) {
  const date = instant == null || instant === ''
    ? new Date()
    : instant instanceof Date ? instant : new Date(instant);
  if (!Number.isFinite(date.getTime())) return { tz: WAT_TZ, status: 'UNAVAILABLE' };
  const analysisDate = watDate(date);
  if (!COVERED_YEARS.has(yearOf(analysisDate))) return { tz: WAT_TZ, status: 'UNAVAILABLE' };
  const next = nextBusinessDay(analysisDate);
  return {
    tz: WAT_TZ,
    analysis: dayBlock(analysisDate),
    next_business_day: next === 'UNAVAILABLE' ? 'UNAVAILABLE' : dayBlock(next),
  };
}

export function executionWindowHeader(block) {
  if (!block || block.status === 'UNAVAILABLE' || !block.analysis) return '⏱ calendario no disponible';
  const day = block.analysis;
  const next = block.next_business_day;
  const flags = [day.eom, day.qend_window, day.yend_window, day.gotobi];
  if (flags.includes('UNAVAILABLE')) return '⏱ calendario no disponible';
  const parts = [];
  if (day.qend_window) {
    const end = lastSessionOfMonth(yearOf(day.date), monthOf(day.date));
    const left = sessionsAfter(day.date, end);
    const label = day.yend_window ? 'Fin de trimestre y de año' : 'Fin de trimestre';
    parts.push(`${label} T-${left}`);
  } else if (day.eom) {
    parts.push('fin de mes');
  }
  if (day.gotobi) parts.push('gotobi');
  else if (next && next.gotobi === true) {
    parts.push(next.date === addDays(day.date, 1) ? 'gotobi mañana' : 'gotobi el siguiente hábil');
  }
  return parts.length ? `⏱ ${parts.join(' · ')}` : '⏱ sin ventana';
}
