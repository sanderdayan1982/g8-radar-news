import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectRadarAndIrisData, buildRadarStore, readRadarStore, projectIrisFeed } from '../src/irisCollector.js';
import { readPolymarketHistory, writePolymarketHistory } from '../src/polymarketGeo.js';
import { mergeSourceHealth, healthSummary, publishSignature, irisHealth } from '../src/sourceHealth.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(__dirname);
const DATA_DIR = join(ROOT, 'public', 'data');
const FULL_PATH = join(DATA_DIR, 'radar_news_full.json');
const IRIS_PATH = join(DATA_DIR, 'iris_g8_feed.json');
const STATUS_PATH = join(DATA_DIR, 'radar_status.json');
const STORE_PATH = join(DATA_DIR, 'radar_store.json');
const POLY_PATH = join(DATA_DIR, 'polymarket_geo_history.json');

mkdirSync(DATA_DIR, { recursive: true });

function readJson(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

const prevFull = readJson(FULL_PATH);
const prevStore = readRadarStore(readJson(STORE_PATH));
const prevPoly = readPolymarketHistory(readJson(POLY_PATH));
// Memoria = radar_store.json. La cinta prevFull.news está recortada a 300 y no se usa como memoria.
// Solo el primer ciclo, si el archivo aún no existe, arranca desde esa cinta para no vaciar el feed.
const existingItems = prevStore
  ? prevStore.items
  : (Array.isArray(prevFull?.news) ? prevFull.news : []);
const prevShaSet = new Set(
  (prevStore?.items || (Array.isArray(prevFull?.items) ? prevFull.items : existingItems))
    .map((x) => x.sha256 || x.id)
    .filter(Boolean),
);

const t0 = Date.now();
const collected = await collectRadarAndIrisData({
  existingItems,
  previousMarket: prevFull?.market || null,
  previousCalendar: prevFull?.calendar || [],
  polymarketHistory: prevPoly,
  timeoutMs: 8000,
});
let { irisFeed } = collected;
const { fullState, memoryItems, polymarketHistory } = collected;
const elapsedMs = Date.now() - t0;

// A failed source stays failed; only its last success and last headline are carried forward.
fullState.sources = mergeSourceHealth(fullState.sources, prevFull?.sources || []);
const health = healthSummary(fullState.sources);
irisFeed = projectIrisFeed({
  ...irisFeed,
  health: irisHealth(fullState.sources, fullState.calendar?.length || 0),
});

const newItemsCount = irisFeed.items.filter((x) => !prevShaSet.has(x.sha256)).length;
// Publish when consumers would see a difference: new headlines, calendar values (consensus/actual), source states.
const signatureChanged = publishSignature(fullState) !== publishSignature(prevFull);
// A contract change (new top-level fields) must reach consumers without waiting for a new headline.
const prevIris = readJson(IRIS_PATH);
const prevIrisKeys = prevIris ? Object.keys(prevIris).sort().join(',') : '';
const schemaChanged = prevIrisKeys !== Object.keys(irisFeed).sort().join(',');
const itemKey = (item) => item?.sha256 || item?.id || '';
const prevItemIds = (prevIris?.items || []).map(itemKey).join('\n');
const nextItemIds = irisFeed.items.map(itemKey).join('\n');
const itemsChanged = prevItemIds !== nextItemIds;
const prevStoreIds = (prevStore?.items || []).map(itemKey).join('\n');
const nextStoreIds = memoryItems.map(itemKey).join('\n');
const storeChanged = !prevStore || prevStoreIds !== nextStoreIds;
const polyChanged = JSON.stringify(irisFeed.polymarket_geo) !== JSON.stringify(prevIris?.polymarket_geo);
const historyChanged = JSON.stringify(polymarketHistory) !== JSON.stringify(prevPoly);
const shouldWrite = !prevFull
  || newItemsCount > 0
  || signatureChanged
  || schemaChanged
  || itemsChanged
  || polyChanged
  || historyChanged
  || (prevFull?.items?.length || 0) === 0
  || (prevFull?.sources?.length || 0) !== fullState.sources.length
  || process.argv.includes('--force');

if (storeChanged) {
  writeFileSync(STORE_PATH, JSON.stringify(buildRadarStore(memoryItems, fullState.generated_at), null, 2));
}
if (historyChanged) writePolymarketHistory(POLY_PATH, polymarketHistory);
if (shouldWrite) {
  writeFileSync(FULL_PATH, JSON.stringify(fullState, null, 2));
  writeFileSync(IRIS_PATH, JSON.stringify(irisFeed, null, 2));
}
// Heartbeat: a small file written on every run, so staleness is visible even without new headlines.
const status = {
  schema: 'radar-status/v1',
  last_check_at: new Date().toISOString(),
  feed_generated_at: shouldWrite ? fullState.generated_at : (prevFull?.generated_at || null),
  wrote_full_feed: shouldWrite,
  new_items: newItemsCount,
  sources: health,
  failing_sources: fullState.sources.filter((s) => s.status !== 'ok').map((s) => ({ id: s.id, status: s.status, last_error: s.last_error || null, last_success_at: s.last_success_at || null, consecutive_failures: s.consecutive_failures })),
  calendar_events: fullState.calendar?.length || 0,
  cadence: 'Hourly GitHub Actions trigger + self-clocked loop: every 5 min, every 60 s within 15 min of a High-impact event',
};
writeFileSync(STATUS_PATH, JSON.stringify(status, null, 2));

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `new_items=${newItemsCount}\nupdated=${shouldWrite ? 'true' : 'false'}\n`);
}

console.log(JSON.stringify({
  ok: true,
  elapsedMs,
  sourcesOk: health.ok,
  sourcesTotal: health.total,
  totalItems72h: irisFeed.items.length,
  storeCount: memoryItems.length,
  newItemsCount,
  wroteFiles: shouldWrite,
  wroteStore: storeChanged,
}));
