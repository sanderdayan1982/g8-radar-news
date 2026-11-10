/**
 * Severidad de candados (RADAR v5.1 Parte B).
 * Constantes congeladas el 10-nov-2026: ventana 48 h, POST-EVENTO 24 h,
 * retirar limitadas 2 h antes de un DISCURSO.
 *
 * La implementación vive en public/ porque la UI estática y el motor
 * (src/lockSeverity.js reexporta este módulo) tienen que usar la misma regla.
 * La primera clase que encaja gana. No distingue mayúsculas.
 */

export const LOCK_WINDOW_H = 48;
export const POST_EVENT_WINDOW_H = 24;
export const RETIRAR_LIMITADAS_H = 2;

export const LOCK_LEVELS = Object.freeze(['TOTAL', 'TIER1', 'NO_AMPLIAR', 'AVISO', 'NINGUNO']);

export const LOCK_LEVEL_BY_CLASS = Object.freeze({
  DECISION_BC: 'TOTAL',
  PRESUPUESTO: 'TOTAL',
  DISCURSO: 'NO_AMPLIAR',
  TIER1_DATO: 'TIER1',
  OTRO_HIGH: 'AVISO',
});

const DECISION_PHRASES = [
  'federal funds rate',
  'fomc statement',
  'official bank rate',
  'bank rate votes',
  'main refinancing rate',
  'deposit facility rate',
  'monetary policy statement',
  'official cash rate',
  'cash rate',
  'overnight rate',
  'policy rate',
  'rate statement',
  'rate decision',
  'monetary policy assessment',
  'press conference',
];

const PRESUPUESTO_PHRASES = [
  'budget',
  'fiscal statement',
  'spending review',
  'fiscal update',
  'prefu',
];

const TIER1_PHRASES = [
  'cpi',
  'hicp',
  'inflation rate',
  'non-farm',
  'nonfarm',
  'employment change',
  'unemployment rate',
  'gdp',
  'retail sales',
  'pce',
];

const WINDOW_MS = LOCK_WINDOW_H * 3_600_000;
const POST_MS = POST_EVENT_WINDOW_H * 3_600_000;
const RETIRAR_MS = RETIRAR_LIMITADAS_H * 3_600_000;

export function lockSeverityIndex(level) {
  const i = LOCK_LEVELS.indexOf(level);
  return i === -1 ? LOCK_LEVELS.length - 1 : i;
}

function includesPhrase(title, phrase) {
  return String(title || '').toLowerCase().includes(phrase);
}

function speechLocks(impact) {
  const level = String(impact || '').toLowerCase();
  return level === 'high' || level === 'medium';
}

function hasBalanceWord(title) {
  return /\bbalance\b/i.test(String(title || ''));
}

export function matchLockClass(title, impact) {
  const text = String(title || '');
  if (DECISION_PHRASES.some((phrase) => includesPhrase(text, phrase))) return 'DECISION_BC';
  // «balance» es un dato (p. ej. Federal Budget Balance), no un presupuesto.
  if (!hasBalanceWord(text) && PRESUPUESTO_PHRASES.some((phrase) => includesPhrase(text, phrase))) return 'PRESUPUESTO';
  if (/\bspeaks\b/i.test(text) || includesPhrase(text, 'testifies') || includesPhrase(text, 'testimony')) {
    return 'DISCURSO';
  }
  if (String(impact || '').toLowerCase() !== 'high') return null;
  if (TIER1_PHRASES.some((phrase) => includesPhrase(text, phrase))) return 'TIER1_DATO';
  return 'OTRO_HIGH';
}

/**
 * Clasifica un evento de agenda.
 * Ventana activa: 0 < horas exactas ≤ 48. Fuera de ella lock_level es NINGUNO.
 * Un DISCURSO solo bloquea con impacto High o Medium (enmienda B-bis).
 * Low o sin impacto conserva la clase y no cuenta para el candado de la divisa.
 * hours_until se publica a 0,1 h, igual que hours_from_now.
 */
export function classifyEventLock(event, nowMs = Date.now()) {
  const lockClass = matchLockClass(event?.title, event?.impact);
  const evMs = Date.parse(event?.event_at || '');
  const known = Number.isFinite(evMs);
  const diffMs = known ? evMs - nowMs : null;
  const hoursUntil = known ? Math.round((diffMs / 3_600_000) * 10) / 10 : null;
  const speechActive = lockClass !== 'DISCURSO' || speechLocks(event?.impact);
  const active = lockClass != null && speechActive && known && diffMs > 0 && diffMs <= WINDOW_MS;
  const inPost = known && diffMs <= 0 && diffMs >= -POST_MS;
  return {
    lock_class: lockClass,
    lock_level: active ? LOCK_LEVEL_BY_CLASS[lockClass] : 'NINGUNO',
    hours_until: hoursUntil,
    retirar_limitadas: active && lockClass === 'DISCURSO' && diffMs <= RETIRAR_MS,
    active,
    in_post_window: inPost,
  };
}

function agendaWindowStatus(lock) {
  if (lock.active) return lock.lock_level;
  if (lock.in_post_window) return '✓ POST-EVENTO';
  return null;
}

/**
 * Misma ventana de lista que el feed (un actual se conserva hasta -48 h)
 * y la misma severidad en la sincronización y en la función live.
 * La etiqueta POST-EVENTO dura 24 h.
 */
export function buildAgendaWindow(calendarEvents, nowMs = Date.now()) {
  return (calendarEvents || [])
    .filter((e) => {
      const ms = Date.parse(e?.event_at || '');
      if (!Number.isFinite(ms)) return false;
      const diff = ms - nowMs;
      return diff >= (e.actual ? -48 : -24) * 3_600_000 && diff <= WINDOW_MS;
    })
    .map((e) => {
      const lock = classifyEventLock(e, nowMs);
      return {
        id: e.id,
        currency: e.currency,
        title: e.title,
        event_at: e.event_at,
        impact: e.impact,
        actual: e.actual ?? null,
        forecast: e.forecast ?? null,
        previous: e.previous ?? null,
        hours_from_now: lock.hours_until,
        window_status: agendaWindowStatus(lock),
        lock_class: lock.lock_class,
        lock_level: lock.lock_level,
        retirar_limitadas: lock.retirar_limitadas,
      };
    });
}

export function rankingLockFields(row) {
  return {
    calendar_lock: row?.calendar_lock ?? null,
    calendar_lock_detail: row?.calendar_lock_detail ?? null,
    post_event_status: row?.post_event_status ?? null,
    lock_level: row?.lock_level || 'NINGUNO',
    lock_class: row?.lock_class ?? null,
    lock_events: Array.isArray(row?.lock_events) ? row.lock_events.map((e) => ({ ...e })) : [],
    retirar_limitadas: row?.retirar_limitadas === true,
  };
}
