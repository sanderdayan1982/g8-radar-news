import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectRadarAndIrisData } from '../src/irisCollector.js';
import { mergeSourceHealth, healthSummary, publishSignature, irisHealth } from '../src/sourceHealth.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(__dirname);
const DATA_DIR = join(ROOT, 'public', 'data');
const FULL_PATH = join(DATA_DIR, 'radar_news_full.json');
const IRIS_PATH = join(DATA_DIR, 'iris_g8_feed.json');
const STATUS_PATH = join(DATA_DIR, 'radar_status.json');

mkdirSync(DATA_DIR, { recursive: true });

let prevFull = null;
if (existsSync(FULL_PATH)) {
  try {
    prevFull = JSON.parse(readFileSync(FULL_PATH, 'utf8'));
  } catch {
    prevFull = null;
  }
}

const existingItems = Array.isArray(prevFull?.news) ? prevFull.news : [];
const prevShaSet = new Set(
  (Array.isArray(prevFull?.items) ? prevFull.items : existingItems)
    .map((x) => x.sha256 || x.id)
    .filter(Boolean),
);

const t0 = Date.now();
const { irisFeed, fullState } = await collectRadarAndIrisData({
  existingItems,
  previousMarket: prevFull?.market || null,
  previousCalendar: prevFull?.calendar || [],
  timeoutMs: 8000,
});
const elapsedMs = Date.now() - t0;

// A failed source stays failed; only its last success and last headline are carried forward.
fullState.sources = mergeSourceHealth(fullState.sources, prevFull?.sources || []);
const health = healthSummary(fullState.sources);
irisFeed.sources_ok = health.ok;
irisFeed.health = irisHealth(fullState.sources, fullState.calendar?.length || 0);

const newItemsCount = irisFeed.items.filter((x) => !prevShaSet.has(x.sha256)).length;
// Publish when consumers would see a difference: new headlines, calendar values (consensus/actual), source states.
const signatureChanged = publishSignature(fullState) !== publishSignature(prevFull);
const shouldWrite = !prevFull
  || newItemsCount > 0
  || signatureChanged
  || (prevFull?.items?.length || 0) === 0
  || (prevFull?.sources?.length || 0) !== fullState.sources.length
  || process.argv.includes('--force');

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
  sourcesOk: irisFeed.sources_ok,
  sourcesTotal: irisFeed.sources_total,
  totalItems72h: irisFeed.count,
  newItemsCount,
  wroteFiles: shouldWrite,
}));
