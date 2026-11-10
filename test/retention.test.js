import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  BREAKING_WINDOW_HOURS,
  OFFICIAL_WINDOW_DAYS,
  STORE_CAP,
  FEED_CAP,
  TAPE_CAP,
  COVERAGE_CURRENCIES,
  retainHeadlines,
  trimMemory,
  buildCoverage,
  buildRadarStore,
  formatIrisFeedItem,
  naturalHoursBetween,
  businessHoursBetween,
} from '../src/irisCollector.js';

const NOW = Date.parse('2026-11-10T12:00:00.000Z');

function breakingItem(i, publishedAt = new Date(NOW - i * 60_000).toISOString()) {
  return {
    title: `Breaking headline number ${i} about the dollar market`,
    url: `https://example.com/breaking/${i}`,
    source_type: 'breaking',
    source: 'FinancialJuice',
    published_at: publishedAt,
    currencies: ['USD'],
  };
}

function officialItem(i) {
  return {
    title: `RBNZ official statement archive ${i}`,
    url: `https://example.com/official-keep/${i}`,
    source_type: 'oficial',
    source: 'RBNZ',
    published_at: new Date(NOW - 10 * 86400_000 - i * 3600_000).toISOString(),
    currencies: ['NZD'],
  };
}

function isKeptOfficial(item) {
  return String(item?.url || '').includes('/official-keep/');
}

test('constantes congeladas de retención: 72 h, 45 días, memoria 5000, feed 3000', () => {
  assert.equal(BREAKING_WINDOW_HOURS, 72);
  assert.equal(OFFICIAL_WINDOW_DAYS, 45);
  assert.equal(STORE_CAP, 5000);
  assert.equal(FEED_CAP, 3000);
  assert.equal(TAPE_CAP, 300);
  assert.deepEqual([...COVERAGE_CURRENCIES], ['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD', 'NZD', 'XAU']);
});

test('400 breaking recientes y 5 oficiales de hace 10 días siguen en items y en el store tras dos ciclos', () => {
  const breaking = Array.from({ length: 400 }, (_, i) => breakingItem(i));
  const official = Array.from({ length: 5 }, (_, i) => officialItem(i));
  const cycle1 = retainHeadlines([...breaking, ...official], [], NOW);
  assert.equal(cycle1.memoryItems.length, 405);
  assert.equal(cycle1.tapeItems.length, 300);
  assert.equal(cycle1.tapeItems.filter(isKeptOfficial).length, 0);

  const later = NOW + 5 * 60_000;
  const viaTape = retainHeadlines(breaking, cycle1.tapeItems, later);
  assert.equal(viaTape.memoryItems.filter(isKeptOfficial).length, 0, 'la cinta de 300 no es memoria: los oficiales de 10 días se pierden');

  const cycle2 = retainHeadlines(breaking, cycle1.memoryItems, later);
  const store = buildRadarStore(cycle2.memoryItems, new Date(later).toISOString());
  const items = cycle2.feedItems.map(formatIrisFeedItem);

  assert.equal(store.schema, 'radar-store/v1');
  assert.equal(store.retention.breaking_hours, 72);
  assert.equal(store.retention.official_days, 45);
  assert.equal(store.retention.cap, 5000);
  assert.equal(store.items.filter(isKeptOfficial).length, 5);
  assert.equal(items.filter(isKeptOfficial).length, 5);
  assert.equal(cycle2.memoryItems.filter(isKeptOfficial).length, 5);
  assert.equal(cycle2.feedItems.filter(isKeptOfficial).length, 5);

  assert.equal(cycle2.coverage.USD.count_72h, 400);
  assert.equal(cycle2.coverage.NZD.count_official_45d, 5);
  assert.equal(cycle2.coverage.NZD.count_72h, 0);
  assert.equal(cycle2.coverage.NZD.last_item_at, official[0].published_at);
  assert.deepEqual(Object.keys(cycle2.coverage), [...COVERAGE_CURRENCIES]);
});

test('el tope recorta primero el breaking más antiguo y no elimina oficiales dentro de ventana', () => {
  const officials = Array.from({ length: 3 }, (_, i) => officialItem(i));
  const breaking = Array.from({ length: STORE_CAP }, (_, i) => breakingItem(i, new Date(NOW - i * 1000).toISOString()));
  const retained = retainHeadlines([...breaking, ...officials], [], NOW);
  assert.equal(retained.memoryItems.filter((item) => item.source_type === 'oficial').length, 3);
  assert.equal(retained.memoryItems.filter((item) => item.source_type === 'breaking').length, STORE_CAP - 3);
  assert.equal(retained.memoryItems.length, STORE_CAP);
  assert.equal(retained.feedItems.filter(isKeptOfficial).length, 3);
  assert.equal(retained.feedItems.filter((item) => item.source_type === 'breaking').length, FEED_CAP - 3);
  assert.equal(retained.feedItems.length, FEED_CAP);

  const onlyOfficial = trimMemory(Array.from({ length: STORE_CAP + 1 }, (_, i) => officialItem(i)), STORE_CAP);
  assert.equal(onlyOfficial.length, STORE_CAP + 1);

  const mixed = trimMemory([
    { title: 'Old breaking dollar headline alpha', url: 'https://example.com/trim/b-old', source_type: 'breaking', published_at: new Date(NOW - 5 * 3600_000).toISOString() },
    { title: 'New breaking dollar headline beta', url: 'https://example.com/trim/b-new', source_type: 'breaking', published_at: new Date(NOW - 1 * 3600_000).toISOString() },
    { title: 'Agency euro headline gamma older', url: 'https://example.com/trim/a-old', source_type: 'agencia', published_at: new Date(NOW - 6 * 3600_000).toISOString() },
    { title: 'RBNZ official statement archive trim', url: 'https://example.com/official-keep/trim', source_type: 'oficial', published_at: new Date(NOW - 12 * 86400_000).toISOString() },
  ], 2);
  assert.deepEqual(mixed.map((item) => item.source_type).sort(), ['agencia', 'oficial']);
});

test('hours_since_last es horario natural y hours_since_last_business excluye sábado y domingo UTC', () => {
  const friday2200 = Date.parse('2026-11-06T22:00:00.000Z');
  const monday0200 = Date.parse('2026-11-09T02:00:00.000Z');
  assert.equal(naturalHoursBetween(friday2200, monday0200), 52);
  assert.equal(businessHoursBetween(friday2200, monday0200), 4);

  const saturday1000 = Date.parse('2026-11-07T10:00:00.000Z');
  const sunday1000 = Date.parse('2026-11-08T10:00:00.000Z');
  assert.equal(naturalHoursBetween(saturday1000, sunday1000), 24);
  assert.equal(businessHoursBetween(saturday1000, sunday1000), 0);

  const monday1000 = Date.parse('2026-11-09T10:00:00.000Z');
  const monday1330 = Date.parse('2026-11-09T13:30:00.000Z');
  assert.equal(naturalHoursBetween(monday1000, monday1330), 3.5);
  assert.equal(businessHoursBetween(monday1000, monday1330), 3.5);

  const friday2300 = Date.parse('2026-11-06T23:00:00.000Z');
  const saturday0100 = Date.parse('2026-11-07T01:00:00.000Z');
  assert.equal(businessHoursBetween(friday2300, saturday0100), 1);
  assert.equal(naturalHoursBetween(friday2300, saturday0100), 2);

  const monday1800 = Date.parse('2026-11-09T18:00:00.000Z');
  const coverage = buildCoverage([
    {
      title: 'Fed holds the dollar policy rate',
      url: 'https://example.com/coverage/usd',
      source_type: 'breaking',
      published_at: '2026-11-09T02:00:00.000Z',
      currencies: ['USD'],
    },
    {
      title: 'RBNZ official statement archive coverage',
      url: 'https://example.com/official-keep/coverage',
      source_type: 'oficial',
      published_at: '2026-11-05T18:00:00.000Z',
      currencies: ['NZD'],
    },
  ], monday1800);

  assert.equal(coverage.USD.count_72h, 1);
  assert.equal(coverage.USD.count_official_45d, 0);
  assert.equal(coverage.USD.hours_since_last, 16);
  assert.equal(coverage.USD.hours_since_last_business, 16);
  assert.equal(coverage.NZD.count_72h, 0);
  assert.equal(coverage.NZD.count_official_45d, 1);
  assert.equal(coverage.NZD.hours_since_last, 96);
  assert.equal(coverage.NZD.hours_since_last_business, 48);
  assert.equal(coverage.XAU.count_72h, 0);
  assert.equal(coverage.XAU.last_item_at, null);
  assert.equal(coverage.XAU.hours_since_last, null);
  assert.equal(coverage.XAU.hours_since_last_business, null);
});

test('un oficial dentro de 72 h cuenta en count_72h y en count_official_45d', () => {
  const coverage = buildCoverage([
    {
      title: 'Fed official statement on the dollar',
      url: 'https://example.com/official-keep/fed',
      source_type: 'oficial',
      published_at: new Date(NOW - 2 * 3600_000).toISOString(),
      currencies: ['USD'],
    },
  ], NOW);
  assert.equal(coverage.USD.count_72h, 1);
  assert.equal(coverage.USD.count_official_45d, 1);
  assert.equal(coverage.USD.hours_since_last, 2);
  assert.equal(coverage.USD.hours_since_last_business, 2);
});

test('la sincronización y la función live leen radar_store.json y el feed ya no corta a 250', () => {
  const sync = readFileSync(new URL('../scripts/sync_feeds.mjs', import.meta.url), 'utf8');
  const live = readFileSync(new URL('../netlify/functions/radar_live.mjs', import.meta.url), 'utf8');
  const collector = readFileSync(new URL('../src/irisCollector.js', import.meta.url), 'utf8');
  const loop = readFileSync(new URL('../scripts/sync_loop.sh', import.meta.url), 'utf8');
  const workflow = readFileSync(new URL('../.github/workflows/update_radar_news.yml', import.meta.url), 'utf8');

  assert.match(sync, /radar_store\.json/);
  assert.match(sync, /readRadarStore/);
  assert.match(sync, /buildRadarStore/);
  assert.match(live, /radar_store\.json/);
  assert.match(live, /readRadarStore/);
  assert.match(collector, /radar-store\/v1/);
  assert.doesNotMatch(collector, /slice\(0,\s*250\)/);
  assert.match(loop, /public\/data\/radar_store\.json/);
  assert.match(loop, /chore\(feed\): sync radar news \[skip netlify\]/);
  assert.match(workflow, /test\/retention\.test\.js/);
});
