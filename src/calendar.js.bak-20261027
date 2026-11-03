import { createHash } from 'node:crypto';
import { CURRENCIES, UA, WINDOWS } from './config.js';
import { parseNumber } from './enrich.js';

const FF = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';

function weekStart(d = new Date()) {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = x.getUTCDay() || 7;
  x.setUTCDate(x.getUTCDate() - day + 1);
  return x.toISOString().slice(0, 10);
}

export async function fetchCalendar() {
  const res = await fetch(FF, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(WINDOWS.fetchTimeoutMs) });
  if (!res.ok) throw new Error(`ForexFactory HTTP ${res.status}`);
  const rows = await res.json();
  const events = [];
  for (const r of rows) {
    const currency = CURRENCIES.includes(r.country) ? r.country : null;
    if (!currency && r.impact !== 'Holiday') continue;
    const eventAt = new Date(r.date).toISOString();
    const id = createHash('sha1').update(`${r.title}|${r.country}|${eventAt}`).digest('hex').slice(0, 16);
    events.push({
      id,
      title: r.title,
      currency: currency || 'USD',
      event_at: eventAt,
      impact: r.impact || 'Low',
      forecast: r.forecast || null,
      previous: r.previous || null,
      actual: r.actual || null,
      news_item_id: null,
      prealerted: 0,
    });
  }
  return { events, week_start: weekStart(), source: FF };
}

const MATCH_MS = 18 * 3600_000;

export function eventFamily(title) {
  const t = String(title || '').toLowerCase();
  if (/\bpmi\b|purchasing managers/.test(t)) {
    if (/composite/.test(t)) return 'pmi_comp';
    if (/service/.test(t)) return 'pmi_svc';
    if (/manufactur|\bmfg\b/.test(t)) return 'pmi_mfg';
    return 'pmi';
  }
  if (/core retail/.test(t)) return 'retail_core';
  if (/retail/.test(t)) return 'retail';
  if (/unemployment|jobless|claims|payroll|employment|\bnfp\b/.test(t)) return 'labour';
  if (/\bcpi\b|\bipc\b|inflation/.test(t)) return 'cpi';
  if (/\bgdp\b|\bpib\b/.test(t)) return 'gdp';
  if (/housing|home sales|building permit/.test(t)) return 'housing';
  if (/trade balance|current account/.test(t)) return 'trade';
  if (/confidence|ifo|zew/.test(t)) return 'confidence';
  if (/industrial|factory|production/.test(t)) return 'production';
  return null;
}

export function eventPlace(title) {
  const t = String(title || '').toLowerCase();
  if (/french|france/.test(t)) return 'fr';
  if (/german|germany/.test(t)) return 'de';
  if (/\buk\b|britain|united kingdom|\bgfk\b/.test(t)) return 'gb';
  if (/\bu\.?s\.?\b|united states/.test(t)) return 'us';
  if (/japan|japanese/.test(t)) return 'jp';
  if (/australia|australian/.test(t)) return 'au';
  if (/canada|canadian/.test(t)) return 'ca';
  if (/eurozone|euro zone|euro area/.test(t)) return 'ez';
  return null;
}

function kindsCompatible(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a === 'pmi' && b.startsWith('pmi')) return true;
  if (b === 'pmi' && a.startsWith('pmi')) return true;
  return false;
}

function wordOverlap(a, b) {
  const na = norm(a); const nb = norm(b);
  if (!na || !nb) return false;
  if (na.includes(nb) || nb.includes(na)) return true;
  const wa = new Set(na.split(' ').filter((w) => w.length > 3));
  const wb = nb.split(' ').filter((w) => w.length > 3);
  return wb.filter((w) => wa.has(w)).length >= 2;
}

function matchQuality(news, event) {
  if (!news.currencies?.includes(event.currency)) return -Infinity;
  const dt = Math.abs(Date.parse(event.event_at) - Date.parse(news.published_at));
  if (!Number.isFinite(dt) || dt > MATCH_MS) return -Infinity;
  const kn = eventFamily(news.title);
  const ke = eventFamily(event.title);
  const pn = eventPlace(news.title);
  const pe = eventPlace(event.title);
  if (pn && pe && pn !== pe) return -Infinity;
  if (kn && ke && !kindsCompatible(kn, ke)) return -Infinity;
  if (kn && ke && kindsCompatible(kn, ke)) {
    let q = 1 - dt / MATCH_MS;
    if (kn === ke) q += 2;
    else q += 0.6;
    if (pn && pe && pn === pe) q += 2;
    return q;
  }
  if (wordOverlap(news.title, event.title)) return 0.5 + (1 - dt / MATCH_MS);
  return -Infinity;
}

export function linkNewsToCalendar(news, events) {
  for (const n of news) {
    if (!n.actual && !n.forecast) continue;
    let best = null;
    let bestQ = 0.2;
    for (const e of events) {
      const q = matchQuality(n, e);
      if (q > bestQ) {
        bestQ = q;
        best = e;
      }
    }
    if (!best) continue;
    n.calendar_title = best.title;
    if (best.impact === 'High') n.impact = Math.max(n.impact || 1, 4);
    best.news_item_id = n.id || best.news_item_id;
    if (n.actual && !best.actual) best.actual = n.actual;
  }
}

function norm(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9% ]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function duePrealerts(events, now = Date.now()) {
  return events.filter((e) => e.impact === 'High'
    && !e.prealerted
    && Date.parse(e.event_at) - now <= 15 * 60_000
    && Date.parse(e.event_at) - now > 0);
}

export function turboEvent(events, now = Date.now()) {
  return events.find((e) => e.impact === 'High' && Math.abs(Date.parse(e.event_at) - now) <= 5 * 60_000) || null;
}

export { parseNumber, weekStart };
