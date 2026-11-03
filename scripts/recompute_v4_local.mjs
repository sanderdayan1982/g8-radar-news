import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyIrisItem, deduplicateAndFilterWindow } from '../src/irisCollector.js';
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

const prevFull = JSON.parse(readFileSync(fullPath, 'utf8'));
const nowMs = Date.now();
const finishedAt = new Date(nowMs).toISOString();

const existingItems = (prevFull.news || prevFull.items || []).map((it) => classifyIrisItem(it));
const calendarEvents = prevFull.calendar || [];
const { allWindowItems, irisWindowItems } = deduplicateAndFilterWindow(existingItems, [], nowMs, 72);

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

const irisItemsFormatted = irisWindowItems.slice(0, 250).map((n) => ({
  id: n.sha256,
  sha256: n.sha256,
  title: n.title,
  url: n.url || '',
  source: n.source,
  source_id: n.source_id,
  source_type: n.source_type,
  published_at: n.published_at,
  currencies: n.currencies || [],
  divisas: n.currencies || [],
  category: n.iris_category,
  categories: n.iris_categories || [n.iris_category],
  legacy_category: n.category,
  ficha_v6: n.ficha_v6 || 'A1 / B2',
  mmt_lens: n.mmt_lens || 'REPRICING_MONETARIO',
  sovereignty_mmt: n.sovereignty_mmt || 'SOBERANO_EMISOR',
  impact: n.impact ?? 1,
  actual: n.actual ?? null,
  forecast: n.forecast ?? null,
  previous: n.previous ?? null,
  calendar_title: n.calendar_title ?? null,
  z: n.z ?? null,
}));

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
  news: allWindowItems.slice(0, 300),
  items: irisItemsFormatted,
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
  currency_ranking_mmt: currencyRankingMmt,
  g8_ranking: g8RankingSummary,
  agenda_window: agendaWindow,
  market_basket_pct: prevFull.market?.basketPct || {},
  items: irisItemsFormatted,
  news: irisItemsFormatted,
};

writeFileSync(fullPath, JSON.stringify(nextFull, null, 2));
writeFileSync(irisPath, JSON.stringify(nextIris, null, 2));

console.log(`=== RANKING ${OP_VERSION} ===`);
for (const r of currencyRankingMmt) {
  console.log(
    `${r.rank ? `#${r.rank}` : '— '} ${r.currency.padEnd(4)} | Score: ${String(r.score).padStart(4)} (${r.bias.padEnd(7)}) | Ficha: ${String(r.ficha_v6).padEnd(14)} | ${r.sovereignty_mmt.padEnd(16)} | Lock: ${r.calendar_lock || '—'} | Driver: ${r.drivers[0] || ''}`,
  );
}
