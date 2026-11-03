// Scheduled ECB reference-rate publication days (TARGET euro calendar).
// Source: https://www.ecb.europa.eu/ecb/contacts/working-hours/html/index.en.html
// Exceptional source outages remain gaps, never synthetic fixings.
export const FIXING_CALENDAR_VERSION = 'ecb-target-calendar-v1';
export const FIXING_TIMEZONE = 'Europe/Berlin';

function dateOf(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value ? d : null;
}

function easterSunday(year) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  return new Date(Date.UTC(year, Math.floor((h + l - 7 * m + 114) / 31) - 1, (h + l - 7 * m + 114) % 31 + 1, 12));
}

export function isBusinessDayIso(isoDate) {
  const d = dateOf(isoDate);
  if (!d || d.getUTCFullYear() < 1999 || d.getUTCFullYear() > 2099) return false;
  if ([0, 6].includes(d.getUTCDay())) return false;
  if (['01-01', '05-01', '12-25', '12-26'].includes(isoDate.slice(5))) return false;
  const easter = easterSunday(d.getUTCFullYear());
  const diff = Math.round((d - easter) / 86400000);
  return diff !== -2 && diff !== 1; // Good Friday and Easter Monday.
}

export function addBusinessDays(isoDate, n) {
  const d = dateOf(isoDate);
  if (!d || !Number.isSafeInteger(n) || Math.abs(n) > 3660) return null;
  let remaining = Math.abs(n);
  const step = n < 0 ? -1 : 1;
  while (remaining) {
    d.setUTCDate(d.getUTCDate() + step);
    if (d.getUTCFullYear() < 1999 || d.getUTCFullYear() > 2099) return null;
    if (isBusinessDayIso(d.toISOString().slice(0, 10))) remaining--;
  }
  return d.toISOString().slice(0, 10);
}

export function businessDaysBetween(start, end) {
  const d = dateOf(start), last = dateOf(end);
  if (!d || !last || d > last || (last - d) / 86400000 > 3660) return [];
  const result = [];
  while (d <= last) {
    const date = d.toISOString().slice(0, 10);
    if (isBusinessDayIso(date)) result.push(date);
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return result;
}

export function signalLocalDate(snapshotIso) {
  if (typeof snapshotIso !== 'string' || !/(?:Z|[+-]\d{2}:\d{2})$/.test(snapshotIso)) return null;
  const d = new Date(snapshotIso);
  if (!Number.isFinite(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: FIXING_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d);
  const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

export const DAILY_FIXING_ENTRY_POLICY = Object.freeze({
  version: 'ecb-next-reference-day-v2',
  source: 'ecb_frankfurter_daily',
  calendarVersion: FIXING_CALENDAR_VERSION,
  timeZone: FIXING_TIMEZONE,
  cutoffUtc: null,
  sameDayEntryAllowed: false,
  rule: 'Entrada conservadora en el primer día previsto de publicación BCE/TARGET estrictamente posterior a la fecha local de la señal en Europe/Berlin. No se usa el fixing del mismo día, ni se confunde formación del precio con publicación o captura. Los retornos son de referencia, no precios ejecutables ni validación intradía. Si falta la fecha esperada, queda pendiente o se marca hueco.',
});

export function entryFixingDateForSignal(snapshotIso) {
  const localDate = signalLocalDate(snapshotIso);
  if (!localDate) return null;
  const entry = addBusinessDays(localDate, 1);
  if (!entry) return null;
  return {
    entry_fixing_date: entry,
    expected_t1_date: addBusinessDays(entry, 1),
    expected_t3_date: addBusinessDays(entry, 3),
  };
}
