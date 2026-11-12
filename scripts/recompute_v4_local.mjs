import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyIrisItem, deduplicateAndFilterWindow, trimMemory, formatIrisFeedItem, buildCoverage, buildRadarStore, projectIrisFeed, STORE_CAP, FEED_CAP, TAPE_CAP } from '../src/irisCollector.js';
import { buildAgendaWindow } from '../src/lockSeverity.js';
import { linkNewsToCalendar, turboEvent } from '../src/calendar.js';
import { buildPairRisk, buildRiskMap } from '../src/riskMap.js';
import { irisHealth } from '../src/sourceHealth.js';
import { OP_VERSION, SHADOW_VERSION } from '../src/shadowCalibration.js';
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
const { allWindowItems } = deduplicateAndFilterWindow(existingItems, [], nowMs, 72);
const memoryItems = trimMemory(allWindowItems, STORE_CAP);
const feedItems = trimMemory(memoryItems, FEED_CAP);

if (calendarEvents.length > 0) {
  linkNewsToCalendar(allWindowItems, calendarEvents);
}

const irisItemsFormatted = feedItems.map(formatIrisFeedItem);
const coverage = buildCoverage(memoryItems, nowMs);
const agendaWindow = buildAgendaWindow(calendarEvents, nowMs);

let prevIris = null;
try { prevIris = JSON.parse(readFileSync(irisPath, 'utf8')); } catch { prevIris = null; }
const polymarket_geo = prevIris?.polymarket_geo && Array.isArray(prevIris.polymarket_geo.markets)
  ? {
      status: prevIris.polymarket_geo.status === 'OK' ? 'OK' : 'STALE',
      updated_at: prevIris.polymarket_geo.updated_at ?? null,
      markets: prevIris.polymarket_geo.markets,
    }
  : { status: 'STALE', updated_at: null, markets: [] };

const riskMap = buildRiskMap({
  coverage,
  calendarEvents,
  items: allWindowItems,
  polymarketGeo: polymarket_geo,
  nowMs,
});
const pairRisk = buildPairRisk(riskMap);
const health = irisHealth(prevFull.sources || [], calendarEvents.length);

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
  risk_map: riskMap,
  pair_risk: pairRisk,
  agenda_window: agendaWindow,
  polymarket_geo,
  engines: [],
  turbo: turboEvent(calendarEvents) ? { currency: turboEvent(calendarEvents).currency, title: turboEvent(calendarEvents).title } : null,
};
delete nextFull.currency_ranking_mmt;
delete nextFull.g8_ranking;

const nextIris = projectIrisFeed({
  version: RELEASE,
  engine_version: OP_VERSION,
  generated_at: finishedAt,
  health,
  coverage,
  risk_map: riskMap,
  pair_risk: pairRisk,
  agenda_window: agendaWindow,
  polymarket_geo,
  items: irisItemsFormatted,
});
nextFull.execution_windows = nextIris.execution_windows;

writeFileSync(fullPath, JSON.stringify(nextFull, null, 2));
writeFileSync(irisPath, JSON.stringify(nextIris, null, 2));
writeFileSync(storePath, JSON.stringify(buildRadarStore(memoryItems, finishedAt), null, 2));

console.log(`=== MAPA DE RIESGO ${OP_VERSION} ===`);
for (const r of riskMap) {
  console.log(`${r.currency.padEnd(4)} ${r.risk_level.padEnd(5)} candado ${r.lock_level} ${r.reasons.join(' · ')}`);
}
