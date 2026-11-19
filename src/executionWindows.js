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
 * RELOJES-01 C1 (Sander, 15-nov-2026): Tokio no tenía el cierre bancario de fin
 * de año. Se añaden 31-dic y 2-ene y 3-ene donde la tabla publicada llega:
 * 2026-12-31, 2027-01-02, 2027-01-03 y 2027-12-31. El 1-ene ya estaba.
 * 2028-01-02 y 2028-01-03 caen fuera de 2026–2027 y no se insertan: ese año
 * sigue en UNAVAILABLE.
 *
 * FAMILIAS-01 A (Sander, 15-nov-2026), REVISION_TRIPLE §3.A. Campos SHADOW
 * en el día: fx_roll, imm, opex, fiscal_jp, fiscal_us. No entran en
 * blocked_entry y no reescriben eom, gotobi, las ventanas ni los fixings.
 * fx_roll, imm y opex salen de CME_FXVOL_shadow.json (g8-macro-pipeline,
 * scripts/cme_fxvol_shadow.py). El escritor del feed lo pide con
 * fetchFxvolShadow (raw de GitHub) y lo pasa a buildExecutionWindows.
 * Si falta o está
 * viejo, UNAVAILABLE y null. No se rellena con 0 ni con el dato anterior.
 * La ventana de fx_roll no se desplaza: el active del productor se conserva
 * y el estado BEFORE / INSIDE / AFTER se calcula sobre esas fechas.
 * imm se lee de fut_roll_window.imm. Hoy el productor no lo escribe (calcula
 * el tercer miércoles y no lo guarda). Sin esa clave, UNAVAILABLE: no se
 * inventa el miércoles. opex es exp1 por divisa (vencimiento del modelo,
 * DTE >= 7), sin fundir fechas. fiscal_jp y fiscal_us son por regla.
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
  '2026-10-12', '2026-11-03', '2026-11-23', '2026-12-31',
  '2027-01-01', '2027-01-02', '2027-01-03', '2027-01-11', '2027-02-11', '2027-02-23', '2027-03-21', '2027-03-22',
  '2027-04-29', '2027-05-03', '2027-05-04', '2027-05-05',
  '2027-07-19', '2027-08-11', '2027-09-20', '2027-09-23',
  '2027-10-11', '2027-11-03', '2027-11-23', '2027-12-31',
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
  // Un cierre tabulado de Tokio no recibe el gotobi: shiftGotobi solo devuelve
  // un día hábil de Tokio. No hace falta el mes siguiente para saberlo
  // (RELOJES-01 C1). El fin de semana que no está en la tabla sigue el camino
  // de antes.
  const closed = plazaClosed(value, TOKYO);
  if (closed === 'UNAVAILABLE') return 'UNAVAILABLE';
  if (closed === true) return false;
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

// CME options publica a las 13:30 y a las 17:00 UTC. 72 h cubren el viernes
// 17:00 UTC hasta el lunes antes de la pasada siguiente. Pasado ese plazo el
// documento es STALE: no se arrastra la sesión anterior.
export const FXVOL_MAX_AGE_MS = 72 * 60 * 60 * 1000;

export const FXVOL_SHADOW_URL = 'https://raw.githubusercontent.com/sanderdayan1982/g8-macro-pipeline/main/data/CME_FXVOL_shadow.json';

const FXVOL_CCY = ['EUR', 'JPY', 'GBP', 'AUD', 'CAD', 'CHF', 'NZD'];

const OPEX_NOTE = 'exp1 es el vencimiento del modelo (DTE >= 7), no todos los vencimientos';

function isIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d));
  return utc.getUTCFullYear() === y && utc.getUTCMonth() === m - 1 && utc.getUTCDate() === d;
}

function spanState(value, start, end) {
  if (value < start) return 'BEFORE';
  if (value > end) return 'AFTER';
  return 'INSIDE';
}

function blankRoll(reason) {
  return {
    mode: 'SHADOW',
    status: 'UNAVAILABLE',
    reason,
    start: null,
    end: null,
    active: null,
    state: 'UNAVAILABLE',
  };
}

function blankImm(reason) {
  return { mode: 'SHADOW', status: 'UNAVAILABLE', reason, date: null };
}

function blankOpex(reason) {
  return {
    mode: 'SHADOW',
    status: 'UNAVAILABLE',
    reason,
    note: OPEX_NOTE,
    currencies: null,
    earliest: null,
  };
}

export function fiscalCalendar(value) {
  const y = yearOf(value);
  const jpStartYear = value < iso(y, 4, 1) ? y - 1 : y;
  const jpStart = iso(jpStartYear, 4, 1);
  const jpEnd = iso(jpStartYear + 1, 3, 31);
  const usStartYear = value < iso(y, 10, 1) ? y - 1 : y;
  const usStart = iso(usStartYear, 10, 1);
  const usEnd = iso(usStartYear + 1, 9, 30);
  const baseline = [
    iso(usStartYear, 12, 15),
    iso(usStartYear + 1, 1, 15),
    iso(usStartYear + 1, 4, 15),
    iso(usStartYear + 1, 6, 15),
    iso(usStartYear + 1, 9, 15),
  ].map((date) => ({ date, scope: 'BASELINE', effect: 'TGA/reserves' }));
  return {
    fiscal_jp: {
      mode: 'SHADOW',
      status: 'OK',
      start: jpStart,
      end: jpEnd,
      state: spanState(value, jpStart, jpEnd),
    },
    fiscal_us: {
      mode: 'SHADOW',
      status: 'OK',
      start: usStart,
      end: usEnd,
      state: spanState(value, usStart, usEnd),
      baseline,
    },
  };
}

function resolveFxvol(fxvol, instant) {
  if (fxvol == null) return { kind: 'MISSING' };
  if (typeof fxvol !== 'object' || Array.isArray(fxvol)) return { kind: 'STALE' };
  const generated = Date.parse(fxvol.generated_utc);
  const at = instant.getTime();
  if (!Number.isFinite(generated) || !Number.isFinite(at)) return { kind: 'STALE' };
  const age = at - generated;
  if (age < 0 || age > FXVOL_MAX_AGE_MS) return { kind: 'STALE' };
  return { kind: 'FRESH', doc: fxvol };
}

function fxRollFor(value, fx) {
  if (fx.kind !== 'FRESH') return blankRoll(fx.kind === 'MISSING' ? 'MISSING' : 'STALE');
  const roll = fx.doc.fut_roll_window;
  if (roll == null || typeof roll !== 'object' || Array.isArray(roll)) return blankRoll('ABSENT');
  const start = isIsoDate(roll.start) ? roll.start : null;
  const end = isIsoDate(roll.end) ? roll.end : null;
  if (start == null || end == null || end < start) return blankRoll('INVALID');
  return {
    mode: 'SHADOW',
    status: 'OK',
    reason: null,
    start,
    end,
    active: typeof roll.active === 'boolean' ? roll.active : null,
    state: spanState(value, start, end),
  };
}

function immFor(fx) {
  if (fx.kind !== 'FRESH') return blankImm(fx.kind === 'MISSING' ? 'MISSING' : 'STALE');
  const roll = fx.doc.fut_roll_window;
  const raw = roll != null && typeof roll === 'object' && !Array.isArray(roll) ? roll.imm : undefined;
  if (!isIsoDate(raw)) return blankImm('ABSENT');
  return { mode: 'SHADOW', status: 'OK', reason: null, date: raw };
}

function opexFor(fx) {
  if (fx.kind !== 'FRESH') return blankOpex(fx.kind === 'MISSING' ? 'MISSING' : 'STALE');
  const table = fx.doc.currencies;
  if (table == null || typeof table !== 'object' || Array.isArray(table)) return blankOpex('ABSENT');
  const keys = Object.keys(table);
  const ordered = [
    ...FXVOL_CCY.filter((code) => keys.includes(code)),
    ...keys.filter((code) => !FXVOL_CCY.includes(code)),
  ];
  const currencies = {};
  let earliest = null;
  for (const currency of ordered) {
    const row = table[currency];
    const rowObj = row != null && typeof row === 'object' && !Array.isArray(row) ? row : null;
    const exp1 = rowObj != null && isIsoDate(rowObj.exp1) ? rowObj.exp1 : null;
    const dte1 = rowObj != null && typeof rowObj.dte1 === 'number' && Number.isFinite(rowObj.dte1) ? rowObj.dte1 : null;
    currencies[currency] = { exp1, dte1 };
    if (exp1 == null) continue;
    if (earliest == null || exp1 < earliest.exp1) earliest = { exp1, currencies: [currency] };
    else if (exp1 === earliest.exp1) earliest.currencies.push(currency);
  }
  const any = earliest != null;
  return {
    mode: 'SHADOW',
    status: any ? 'OK' : 'UNAVAILABLE',
    reason: any ? null : 'ABSENT',
    note: OPEX_NOTE,
    currencies,
    earliest,
  };
}

// raw.githubusercontent.com already timed out at 4 s (g8-radar-news, 18-nov).
// Three tries with backoff and a 10 s timeout per try. On a total failure the
// caller keeps a previously published STALE/OK block instead of writing MISSING.
export const FXVOL_FETCH_TIMEOUT_MS = 10_000;
export const FXVOL_FETCH_ATTEMPTS = 3;
export const FXVOL_FETCH_BACKOFF_MS = 1000;

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchFxvolShadow(fetchImpl = globalThis.fetch, options = {}) {
  const timeoutMs = options.timeoutMs ?? FXVOL_FETCH_TIMEOUT_MS;
  const attempts = options.attempts ?? FXVOL_FETCH_ATTEMPTS;
  const backoffMs = options.backoffMs ?? FXVOL_FETCH_BACKOFF_MS;
  const sleep = options.sleep ?? defaultSleep;
  for (let i = 1; i <= attempts; i += 1) {
    try {
      const res = await fetchImpl(FXVOL_SHADOW_URL, { signal: AbortSignal.timeout(timeoutMs) });
      if (res != null && res.ok === true) {
        const doc = await res.json();
        if (doc != null && typeof doc === 'object' && !Array.isArray(doc)) return doc;
      }
    } catch {
      // timeout, network or invalid JSON: retry, then give up
    }
    if (i < attempts) await sleep(backoffMs * i);
  }
  return null;
}

const SHADOW_DAY_KEYS = ['fx_roll', 'imm', 'opex'];

export function publishedWindowsHaveValidStale(windows) {
  if (windows == null || typeof windows !== 'object' || Array.isArray(windows)) return false;
  const days = [windows.analysis, windows.next_business_day].filter(
    (day) => day != null && typeof day === 'object' && !Array.isArray(day),
  );
  for (const day of days) {
    for (const key of SHADOW_DAY_KEYS) {
      const block = day[key];
      if (block == null || typeof block !== 'object' || Array.isArray(block)) continue;
      if (block.reason === 'STALE' || block.status === 'OK') return true;
    }
  }
  return false;
}

// Fetch failure must not downgrade a published STALE/OK block to MISSING.
// A successful fetch still wins, even if the new document is itself STALE by age.
export function resolvePublishedFxvolInput(fetched, previousWindows) {
  if (fetched != null) return { fxvol: fetched };
  if (publishedWindowsHaveValidStale(previousWindows)) {
    return { execution_windows: previousWindows };
  }
  return { fxvol: null };
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

function dayBlock(value, fx) {
  const gotobi = isGotobiDate(value);
  const eom = isEom(value);
  const qendWindow = inQendWindow(value);
  const yendWindow = inYendWindow(value);
  const fiscal = fiscalCalendar(value);
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
    fx_roll: fxRollFor(value, fx),
    imm: immFor(fx),
    opex: opexFor(fx),
    fiscal_jp: fiscal.fiscal_jp,
    fiscal_us: fiscal.fiscal_us,
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

export function buildExecutionWindows(instant, fxvol) {
  const date = instant == null || instant === ''
    ? new Date()
    : instant instanceof Date ? instant : new Date(instant);
  if (!Number.isFinite(date.getTime())) return { tz: WAT_TZ, status: 'UNAVAILABLE' };
  const analysisDate = watDate(date);
  if (!COVERED_YEARS.has(yearOf(analysisDate))) return { tz: WAT_TZ, status: 'UNAVAILABLE' };
  const fx = resolveFxvol(fxvol, date);
  const next = nextBusinessDay(analysisDate);
  return {
    tz: WAT_TZ,
    analysis: dayBlock(analysisDate, fx),
    next_business_day: next === 'UNAVAILABLE' ? 'UNAVAILABLE' : dayBlock(next, fx),
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
