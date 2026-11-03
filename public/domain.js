// Shared presentation contracts. Scores remain descriptive, never probabilities.
export function inverseChange(percent) {
  return Number.isFinite(percent) && percent > -100 ? 100 * (1 / (1 + percent / 100) - 1) : null;
}
export function hasNoEvidence(row) {
  if (!row || !Number.isFinite(row.score)) return true;
  if (typeof row.noEvidence === 'boolean') return row.noEvidence;
  return !row.drivers?.length && !row.ledger?.length;
}
export function rankRows(rows) {
  const measured = rows.filter(r => !hasNoEvidence(r)).sort((a,b) => b.score - a.score || a.currency.localeCompare(b.currency));
  let rank = 0;
  return [...measured.map((r,i) => {
    if (!i || r.score !== measured[i-1].score) rank = i+1;
    return {...r, rank, tied: measured.filter(x => x.score === r.score).length > 1, noEvidence:false};
  }), ...rows.filter(hasNoEvidence).map(r => ({...r,score:0,structural:0,impulse:null,bias:'neutral',rank:null,noEvidence:true}))];
}
export function connectionState(data, error, lastReceived, now = Date.now()) {
  if (error || (lastReceived && now-lastReceived > 90_000)) return {kind:'offline',label:'Sin conexión'};
  if (!data) return {kind:'loading',label:'Conectando'};
  if (data.error) return {kind:'error',label:'Error de fuentes'};
  const sync = Date.parse(data.last_sync?.finished_at);
  if (!Number.isFinite(sync)) return {kind:'loading',label:'Primera sincronización'};
  if (now-sync > 15*60_000) return {kind:'stale',label:'Datos desactualizados'};
  if (data.sources?.some(s => s.status !== 'ok' || (s.freshness === 'review' && !s.channel_note))) return {kind:'partial',label:'Cobertura parcial'};
  return data.syncing ? {kind:'syncing',label:'Actualizando'} : {kind:'ready',label:'Actualizado'};
}
export function nextCalendarEvent(events, now = Date.now()) {
  return events.filter(e => ['High','Medium'].includes(e.impact) && Date.parse(e.event_at)>now)
    .sort((a,b) => Date.parse(a.event_at)-Date.parse(b.event_at))[0] || null;
}
export function fxClosed(now = new Date()) {
  const p=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',weekday:'short',hour:'numeric',hourCycle:'h23'}).formatToParts(now).map(x=>[x.type,x.value]));
  return p.weekday==='Sat' || (p.weekday==='Fri' && Number(p.hour)>=17) || (p.weekday==='Sun' && Number(p.hour)<17);
}
export function safeUrl(value, fallback = '#') {
  try { const u = new URL(value); return ['https:','http:'].includes(u.protocol) ? u.href : fallback; } catch { return fallback; }
}
