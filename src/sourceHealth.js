// Honest source health. A failed source is never reported as "ok".
// Current attempt fields (status, last_error, last_attempt_at, last_http_status) always win;
// only facts that remain true are carried from the previous run (last success, last headline, counts).
export function mergeSourceHealth(current = [], previous = [], { seedMode = false } = {}) {
  const prevById = new Map((previous || []).map((s) => [s.id, s]));
  return (current || []).map((s) => {
    const prev = prevById.get(s.id);
    if (s.status === 'ok') return { ...s, consecutive_failures: 0 };
    const merged = {
      ...s,
      last_success_at: s.last_success_at || prev?.last_success_at || null,
      last_news_published_at: s.last_news_published_at || prev?.last_news_published_at || null,
      stored_count: s.stored_count || prev?.stored_count || 0,
      consecutive_failures: (prev?.consecutive_failures || 0) + 1,
    };
    // Serverless function: sources that did not answer inside the 700 ms budget are served from the
    // last scheduled run. That is a cache, not a live success, and it is labelled as such.
    if (seedMode && prev?.status === 'ok') {
      merged.status = 'cached';
      merged.ok = false;
      merged.cached_reason = s.last_error || 'sin respuesta en la ventana de la función';
      merged.consecutive_failures = prev?.consecutive_failures || 0;
    }
    return merged;
  });
}

export function healthSummary(sources = []) {
  const by = (st) => sources.filter((s) => s.status === st).length;
  return { ok: by('ok'), cached: by('cached'), empty: by('empty_feed'), error: by('error'), total: sources.length };
}

// Stable fingerprint of what consumers rely on besides headlines: calendar values and source states.
export function publishSignature(full) {
  const cal = (full?.calendar || []).map((e) => `${e.id}|${e.forecast ?? ''}|${e.actual ?? ''}|${e.previous ?? ''}`).sort().join(';');
  const src = (full?.sources || []).map((s) => `${s.id}:${s.status}`).sort().join(';');
  return `${cal}#${src}`;
}

const PROMO = /\b(sneak pea[kc]|launching soon|subscribe|subscription|discount|promo(?:tion)?|webinar|join us|sign up|giveaway|free trial)\b/i;
export function isPromotional(item) {
  return PROMO.test(String(item?.title || '')) && !(item?.currencies || []).length && !item?.actual;
}

// Health block of the IRIS contract (what ENZO audits). "cached" sources answered in the last
// scheduled sync (<= 5 min) but not inside the serverless 700 ms window: they count as active,
// and are reported separately; only errors and empty feeds degrade the status.
export function irisHealth(sources = [], agendaEvents = 0) {
  const h = healthSummary(sources);
  const active = h.ok + h.cached;
  const status = h.total === 0 ? 'UNKNOWN' : h.error + h.empty === 0 ? 'CLEAN' : active / h.total >= 0.8 ? 'DEGRADED' : 'CRITICAL';
  return { sources_active: active, sources_live: h.ok, sources_cached: h.cached, sources_total: h.total,
           sources_empty: h.empty, sources_error: h.error, agenda_events_count: agendaEvents, status };
}
