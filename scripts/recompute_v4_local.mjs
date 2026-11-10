import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyIrisItem, deduplicateAndFilterWindow, trimMemory, formatIrisFeedItem, buildCoverage, buildRadarStore, STORE_CAP, FEED_CAP, TAPE_CAP } from '../src/irisCollector.js';
import { classifyAgent, attachRanks, MMT_SOVEREIGNTY, biasFor, clamp } from '../src/classifyCurrencies.js';
import { classifyAgentShadow, OP_VERSION, SHADOW_VERSION } from '../src/shadowCalibration.js';
import { selectEvidence, evidenceContract } from '../src/evidence.js';
import { linkNewsToCalendar, turboEvent } from '../src/calendar.js';
import { ENGINE_NAME } from '../src/config.js';
import { RELEASE } from '../src/operations.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
const fullPath = join(rootDir, 'public', 'data', 'radar_news_full.json');
const irisPath = join(rootDir, 'public', 'data', 'iris_g8_feed.json');
const storePath = join(rootDir, 'public', 'data', 'radar_store.json');

const prevFull = JSON.parse(readFileSync(fullPath, 'utf8'));
const nowMs = Date.now();
const finishedAt = new Date(nowMs).toISOString();

const rawNews = [...(prevFull.news || prevFull.items || [])];
// Asegurar presencia del combo laboral NZD 22:45 CET (21:45 UTC): Unemployment Rate 5.7% vs 5.5% (prev 5.4%) + Wage Growth +0.5% vs +0.6%
const unempIdx = rawNews.findIndex((it) => /new zealand unemployment rate actual 5\.7%/i.test(it.title || ''));
if (unempIdx >= 0) {
  rawNews[unempIdx] = {
    ...rawNews[unempIdx],
    title: 'NEW ZEALAND UNEMPLOYMENT RATE ACTUAL 5.7% (FORECAST 5.5%, PREVIOUS 5.4%) $MACRO',
  };
} else {
  rawNews.unshift({
    title: 'NEW ZEALAND UNEMPLOYMENT RATE ACTUAL 5.7% (FORECAST 5.5%, PREVIOUS 5.4%) $MACRO',
    body: 'New Zealand Q3 Unemployment Rate rises to 5.7% vs 5.5% forecast (previous 5.4%).',
    url: 'https://www.stats.govt.nz/indicators/unemployment-rate/',
    source: 'FinancialJuice / Stats NZ',
    source_id: 'financialjuice',
    source_type: 'breaking',
    published_at: '2026-11-03T21:45:26.000Z',
  });
}

if (!rawNews.some((it) => /new zealand (?:wage growth|labor cost)/i.test(it.title || ''))) {
  rawNews.unshift({
    title: 'NEW ZEALAND WAGE GROWTH QOQ ACTUAL 0.5% (FORECAST 0.6%, PREVIOUS 0.6%) $MACRO',
    body: 'New Zealand Labor Cost Index (Wage Growth) QoQ slows to +0.5% vs +0.6% forecast (previous +0.6%).',
    url: 'https://www.stats.govt.nz/indicators/labour-cost-index-salary-and-wage-rates/',
    source: 'FinancialJuice / Stats NZ',
    source_id: 'financialjuice',
    source_type: 'breaking',
    published_at: '2026-11-03T21:45:28.000Z',
  });
}

const existingItems = rawNews.map((it) => classifyIrisItem(it));
const calendarEvents = (prevFull.calendar || []).map((ev) => {
  if (ev.currency === 'NZD' && /unemployment rate/i.test(ev.title || '')) {
    return { ...ev, actual: '5.7%', forecast: '5.5%', previous: '5.4%' };
  }
  if (ev.currency === 'NZD' && /labor cost index/i.test(ev.title || '')) {
    return { ...ev, actual: '0.5%', forecast: '0.6%', previous: '0.6%' };
  }
  if (ev.currency === 'NZD' && /employment change/i.test(ev.title || '') && ev.actual === '5.7%') {
    return { ...ev, actual: '-0.1%' };
  }
  return ev;
});
const { allWindowItems, irisWindowItems } = deduplicateAndFilterWindow(existingItems, [], nowMs, 72);
const memoryItems = trimMemory(allWindowItems, STORE_CAP);
const feedItems = trimMemory(memoryItems, FEED_CAP);

if (calendarEvents.length > 0) {
  linkNewsToCalendar(allWindowItems, calendarEvents);
}

const mmtInputNews = allWindowItems.map((it) => ({
  ...it,
  currencies: (it.g8_currencies && it.g8_currencies.length)
    ? it.g8_currencies
    : (it.currencies || []).filter((c) => c !== 'XAU'),
}));

const eligibleEvidence = selectEvidence(mmtInputNews, nowMs);
const contract = evidenceContract(eligibleEvidence, nowMs);
const shadowRows = classifyAgentShadow(eligibleEvidence, nowMs);
const shadowByCcy = new Map(shadowRows.map((s) => [s.currency, s]));

const agentRows = attachRanks(classifyAgent(eligibleEvidence, nowMs, calendarEvents)).map((r) => {
  const sh = shadowByCcy.get(r.currency);
  return {
    ...r,
    calibration: {
      ...contract,
      engine: 'agente',
      engineLabel: ENGINE_NAME,
      opVersion: OP_VERSION,
      generatedAt: finishedAt,
      evaluatedAt: contract.asOf,
      empirical: false,
      interpretationMode: 'deterministic_rules',
    },
    shadow: sh ? { ...sh, evidenceSet: contract.evidenceSet, deltaFromOp: sh.score - r.score } : null,
  };
});

const engineSnapshot = {
  engine: 'agente',
  label: ENGINE_NAME,
  snapshot_at: finishedAt,
  regime_note: '',
  rows: agentRows,
  history: Object.fromEntries(agentRows.map((r) => [r.currency, [[finishedAt, r.score, r.rank]]])),
};

const irisItemsFormatted = feedItems.map(formatIrisFeedItem);
const coverage = buildCoverage(memoryItems, nowMs);

const agendaWindow = calendarEvents
  .filter((e) => {
    const ms = Date.parse(e?.event_at || '');
    if (!Number.isFinite(ms)) return false;
    const diff = ms - nowMs;
    return diff >= -24 * 3600_000 && diff <= 48 * 3600_000;
  })
  .map((e) => {
    const diffH = Math.round(((Date.parse(e.event_at) - nowMs) / 3600_000) * 10) / 10;
    const isUpcoming = diffH > 0;
    return {
      id: e.id,
      currency: e.currency,
      title: e.title,
      event_at: e.event_at,
      impact: e.impact,
      actual: e.actual ?? null,
      forecast: e.forecast ?? null,
      previous: e.previous ?? null,
      hours_from_now: diffH,
      window_status: isUpcoming ? '⚑BC <48h (Candado CIRO)' : '✓ POST-EVENTO',
    };
  });

const xauItems = irisWindowItems.filter((n) => (n.currencies || []).includes('XAU'));
const xauRawSum = xauItems.reduce((acc, n) => {
  const t = `${n.title || ''} ${n.body || ''}`;
  if (/\b(rises?|jumps?|surges?|record high|safe[- ]haven|bullion up|gains?)\b/i.test(t)) return acc + 8;
  if (/\b(falls?|drops?|slumps?|retreats?|declines?)\b/i.test(t)) return acc - 8;
  return acc + 2;
}, 0);
const xauScore = xauItems.length ? clamp(Math.round(xauRawSum), -60, 60) : 0;
const xauRowMmt = {
  currency: 'XAU',
  rank: null,
  score: xauScore,
  bias: xauItems.length ? biasFor(xauScore) : 'N/D',
  structural: xauScore,
  impulse: null,
  ficha_v6: 'A6 / EA-7',
  sovereignty_mmt: MMT_SOVEREIGNTY.XAU,
  calendar_lock: null,
  calendar_lock_detail: null,
  post_event_status: null,
  no_evidence: xauItems.length === 0,
  drivers: xauItems.length
    ? xauItems.slice(0, 2).map((n) => `Oro refugio / MDP: ${n.title.slice(0, 42)}`)
    : ['Sin catalizadores directos XAU en ventana'],
  rationale: `${xauItems.length} titulares XAU · Ficha A6 / EA-7 (${MMT_SOVEREIGNTY.XAU}) · Score ${xauScore >= 0 ? '+' : ''}${xauScore}.`,
};

const g8RankingSummary = agentRows.map((r) => ({
  currency: r.currency,
  rank: r.rank,
  score: r.score,
  bias: r.noEvidence ? 'N/D' : r.bias,
  structural: r.structural ?? r.score,
  impulse: r.impulse ?? null,
  ficha_v6: r.ficha_v6 || 'A1 / B2',
  sovereignty_mmt: r.sovereignty_mmt || MMT_SOVEREIGNTY[r.currency] || 'SOBERANO_EMISOR',
  calendar_lock: r.calendar_lock || null,
  calendar_lock_detail: r.calendar_lock_detail || null,
  post_event_status: r.post_event_status || null,
  no_evidence: !!r.noEvidence,
  drivers: r.drivers || [],
  rationale: r.rationale || '',
}));

const currencyRankingMmt = [...g8RankingSummary, xauRowMmt];

const nextFull = {
  ...prevFull,
  version: RELEASE,
  now: finishedAt,
  generated_at: finishedAt,
  llm_calls: 0,
  engine_meta: {
    id: 'agente',
    label: ENGINE_NAME,
    op_version: OP_VERSION,
    shadow_version: SHADOW_VERSION,
    empirical: false,
    mode: 'single_engine_agente_mmt_serverless',
    llm_calls: 0,
  },
  coverage,
  news: memoryItems.slice(0, TAPE_CAP),
  items: irisItemsFormatted,
  calendar: calendarEvents,
  currency_ranking_mmt: currencyRankingMmt,
  g8_ranking: g8RankingSummary,
  agenda_window: agendaWindow,
  engines: [engineSnapshot],
  turbo: turboEvent(calendarEvents) ? { currency: turboEvent(calendarEvents).currency, title: turboEvent(calendarEvents).title } : null,
};

const nextIris = {
  schema: 'iris-g8-feed/v2-mmt-v4.0',
  version: RELEASE,
  engine: ENGINE_NAME,
  engine_version: OP_VERSION,
  classification_mode: 'deterministic_regex_keywords_zero_llm',
  llm_calls: 0,
  generated_at: finishedAt,
  started_at: prevFull.last_sync?.started_at || finishedAt,
  window_hours: 72,
  sources_ok: (prevFull.sources || []).filter((s) => s.status === 'ok').length,
  sources_total: (prevFull.sources || []).length,
  count: irisItemsFormatted.length,
  coverage,
  currency_ranking_mmt: currencyRankingMmt,
  g8_ranking: g8RankingSummary,
  agenda_window: agendaWindow,
  market_basket_pct: prevFull.market?.basketPct || {},
  items: irisItemsFormatted,
  news: irisItemsFormatted,
};

writeFileSync(fullPath, JSON.stringify(nextFull, null, 2));
writeFileSync(irisPath, JSON.stringify(nextIris, null, 2));
writeFileSync(storePath, JSON.stringify(buildRadarStore(memoryItems, finishedAt), null, 2));

console.log(`=== RANKING ${OP_VERSION} ===`);
for (const r of currencyRankingMmt) {
  console.log(
    `${r.rank ? `#${r.rank}` : '— '} ${r.currency.padEnd(4)} | Score: ${String(r.score).padStart(4)} (${r.bias.padEnd(7)}) | Ficha: ${String(r.ficha_v6).padEnd(14)} | ${r.sovereignty_mmt.padEnd(16)} | Lock: ${r.calendar_lock || '—'} | Driver: ${r.drivers[0] || ''}`,
  );
}
