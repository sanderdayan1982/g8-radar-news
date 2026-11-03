import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectRadarAndIrisData } from '../src/irisCollector.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(__dirname);
const DATA_DIR = join(ROOT, 'public', 'data');
const FULL_PATH = join(DATA_DIR, 'radar_news_full.json');
const IRIS_PATH = join(DATA_DIR, 'iris_g8_feed.json');

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

if (Array.isArray(prevFull?.sources) && Array.isArray(fullState.sources)) {
  const prevById = new Map(prevFull.sources.map((s) => [s.id, s]));
  fullState.sources = fullState.sources.map((s) => {
    if (s.status === 'ok') return s;
    const prev = prevById.get(s.id);
    return prev && prev.status === 'ok' ? prev : s;
  });
  irisFeed.sources_ok = fullState.sources.filter((s) => s.status === 'ok').length;
}

const newItemsCount = irisFeed.items.filter((x) => !prevShaSet.has(x.sha256)).length;
const shouldWrite = !prevFull
  || newItemsCount > 0
  || (prevFull?.items?.length || 0) === 0
  || (prevFull?.sources?.length || 0) !== fullState.sources.length
  || process.argv.includes('--force');

if (shouldWrite) {
  writeFileSync(FULL_PATH, JSON.stringify(fullState, null, 2));
  writeFileSync(IRIS_PATH, JSON.stringify(irisFeed, null, 2));
}

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
