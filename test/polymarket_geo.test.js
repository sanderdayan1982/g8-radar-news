import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  POLYMARKET_BACKOFF_MAX_MS,
  POLYMARKET_BACKOFF_START_MS,
  POLYMARKET_CADENCE_MS,
  POLYMARKET_GEO_THEMES,
  POLYMARKET_HISTORY_DAYS,
  POLYMARKET_MAX_PER_THEME,
  POLYMARKET_MIN_LIQUIDITY_USD,
  POLYMARKET_MIN_VOLUME_USD,
  SOURCES,
} from '../src/config.js';
import {
  applyD24h,
  closestSnapshot,
  d24hFor,
  exclusionReason,
  fetchPolymarketGeo,
  GAMMA_EVENTS_URL,
  selectPolymarketMarkets,
  themesForTitle,
  toPublicMarket,
  trimPolymarketHistory,
  POLYMARKET_HISTORY_SCHEMA,
} from '../src/polymarketGeo.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/gamma_events.json', import.meta.url), 'utf8'));
const BANNED = /\b(long|short|compra|vende)\b|sesgo largo|sesgo corto|vía libre operativa|subirá|bajará/i;
const PUBLIC_KEYS = ['theme', 'event_title', 'question', 'prob', 'd24h_pp', 'volume', 'liquidity', 'end_date', 'url', 'currencies'];
const NOW = Date.parse('2026-11-10T18:00:00.000Z');

function clock() {
  return { lastOk: 0, backoff: 0, nextTry: 0, lastOutcome: null };
}

function titles(rows, theme) {
  return rows.filter((row) => row.theme === theme).map((row) => row.event_title);
}

function byTitle(rows, title) {
  return rows.find((row) => row.event_title === title);
}

test('la tabla y los umbrales congelados viven en config, sin dirección', () => {
  assert.deepEqual(POLYMARKET_GEO_THEMES.map((theme) => theme.theme), [
    'IRAN_ORIENTE_MEDIO', 'RUSIA_UCRANIA', 'ARANCELES_COMERCIO', 'WASHINGTON', 'CHINA_TAIWAN',
  ]);
  assert.deepEqual(POLYMARKET_GEO_THEMES[0].keywords, ['iran', 'iranian', 'israel', 'israeli', 'hormuz', 'houthi', 'gaza', 'saudi', 'strike on']);
  assert.deepEqual(POLYMARKET_GEO_THEMES[0].currencies, ['USD', 'CHF', 'JPY', 'CAD', 'EUR', 'XAU']);
  assert.deepEqual(POLYMARKET_GEO_THEMES[1].keywords, ['russia', 'ukraine', 'putin', 'zelensky', 'ceasefire', 'nato']);
  assert.deepEqual(POLYMARKET_GEO_THEMES[1].currencies, ['EUR', 'CHF', 'GBP', 'XAU']);
  assert.deepEqual(POLYMARKET_GEO_THEMES[2].keywords, ['tariff', 'trade deal', 'trade war', 'usmca', 'section 232', 'section 301']);
  assert.deepEqual(POLYMARKET_GEO_THEMES[2].currencies, ['CAD', 'AUD', 'NZD', 'EUR', 'JPY', 'CHF']);
  assert.deepEqual(POLYMARKET_GEO_THEMES[3].keywords, ['shutdown', 'veto', 'executive order', 'debt ceiling', 'impeach', 'supreme court', 'fed chair', 'congress passes', 'signs into law']);
  assert.deepEqual(POLYMARKET_GEO_THEMES[3].currencies, ['USD', 'XAU']);
  assert.deepEqual(POLYMARKET_GEO_THEMES[4].keywords, ['china', 'chinese', 'taiwan', 'beijing', 'xi jinping']);
  assert.deepEqual(POLYMARKET_GEO_THEMES[4].currencies, ['AUD', 'NZD', 'JPY', 'USD']);
  for (const theme of POLYMARKET_GEO_THEMES) {
    assert.equal(Object.hasOwn(theme, 'direction'), false);
    assert.equal(Object.hasOwn(theme, 'bias'), false);
    assert.equal(Object.hasOwn(theme, 'score'), false);
    assert.equal(Object.hasOwn(theme, 'rank'), false);
  }
  assert.equal(POLYMARKET_MIN_VOLUME_USD, 250_000);
  assert.equal(POLYMARKET_MIN_LIQUIDITY_USD, 25_000);
  assert.equal(POLYMARKET_MAX_PER_THEME, 5);
  assert.equal(POLYMARKET_HISTORY_DAYS, 8);
  assert.equal(POLYMARKET_CADENCE_MS, 30 * 60 * 1000);
  assert.equal(POLYMARKET_BACKOFF_START_MS, 15 * 60 * 1000);
  assert.equal(POLYMARKET_BACKOFF_MAX_MS, 6 * 60 * 60 * 1000);
  assert.equal(SOURCES.length, 35);
  assert.equal(SOURCES.some((source) => /polymarket|fedwatch/i.test(source.id)), false);
});

test('cada palabra clave del título selecciona su tema y una subcadena ajena no', () => {
  for (const theme of POLYMARKET_GEO_THEMES) {
    for (const keyword of theme.keywords) {
      assert.ok(themesForTitle(`Headline about ${keyword} today`).some((hit) => hit.theme === theme.theme), keyword);
    }
  }
  assert.equal(themesForTitle('Alternative energy bill').length, 0);
  assert.equal(themesForTitle('China ports').some((hit) => hit.theme === 'CHINA_TAIWAN'), true);
});

function pricedEvent(title) {
  return {
    id: title,
    title,
    slug: 'boundary-check',
    closed: false,
    active: true,
    volume: 1_000_000,
    liquidity: 50_000,
    markets: [{
      id: 'boundary-m',
      question: 'Yes or no?',
      closed: false,
      active: true,
      volumeNum: 1_000,
      outcomes: '["Yes","No"]',
      outcomePrices: '["0.5","0.5"]',
    }],
  };
}

test('la palabra clave empieza en un límite de palabra', () => {
  const senator = selectPolymarketMarkets([pricedEvent('A senator addresses the chamber')]);
  assert.equal(senator.some((row) => row.theme === 'RUSIA_UCRANIA'), false);
  assert.equal(senator.length, 0);
  assert.equal(themesForTitle('senator').some((hit) => hit.theme === 'RUSIA_UCRANIA'), false);

  const chinese = selectPolymarketMarkets([pricedEvent('Chinese ports stay open')]);
  assert.deepEqual(titles(chinese, 'CHINA_TAIWAN'), ['Chinese ports stay open']);
  assert.equal(themesForTitle('Chinese ports').some((hit) => hit.theme === 'CHINA_TAIWAN'), true);

  const israeli = selectPolymarketMarkets([pricedEvent('Israeli cabinet meets')]);
  assert.deepEqual(titles(israeli, 'IRAN_ORIENTE_MEDIO'), ['Israeli cabinet meets']);
  assert.equal(themesForTitle('Israeli').some((hit) => hit.theme === 'IRAN_ORIENTE_MEDIO'), true);

  const iranian = selectPolymarketMarkets([pricedEvent('Iranian ports reopen')]);
  assert.deepEqual(titles(iranian, 'IRAN_ORIENTE_MEDIO'), ['Iranian ports reopen']);
  assert.equal(themesForTitle('Iranian').some((hit) => hit.theme === 'IRAN_ORIENTE_MEDIO'), true);

  assert.equal(themesForTitle('The trade deal holds').some((hit) => hit.theme === 'ARANCELES_COMERCIO'), true);
  assert.equal(themesForTitle('US strike on Mexico').some((hit) => hit.theme === 'IRAN_ORIENTE_MEDIO'), true);
  assert.equal(themesForTitle('Section 232 steel review').some((hit) => hit.theme === 'ARANCELES_COMERCIO'), true);
});

test('la respuesta fija de Gamma selecciona, filtra y excluye', () => {
  const rows = selectPolymarketMarkets(fixture);
  assert.deepEqual(titles(rows, 'IRAN_ORIENTE_MEDIO'), [
    'Will the US invade Iran before 2027?',
    'Strait of Hormuz traffic returns to normal?',
    'Houthi attacks on shipping',
    'Gaza humanitarian corridor opens',
    'US strike on Mexico by June',
  ]);

  const invade = byTitle(rows, 'Will the US invade Iran before 2027?');
  assert.equal(invade.question, 'Will the US invade Iran before 2027?');
  assert.equal(invade.prob, 42);
  assert.equal(invade.volume, 90_000_000);
  assert.equal(invade.liquidity, 500_000);
  assert.equal(invade.end_date, '2027-01-01T00:00:00Z');
  assert.equal(invade.url, 'https://polymarket.com/event/will-the-us-invade-iran-before-2027');
  assert.deepEqual(invade.currencies, ['USD', 'CHF', 'JPY', 'CAD', 'EUR', 'XAU']);
  invade.currencies.push('ZZZ');
  assert.deepEqual(POLYMARKET_GEO_THEMES[0].currencies, ['USD', 'CHF', 'JPY', 'CAD', 'EUR', 'XAU']);

  const hormuz = byTitle(rows, 'Strait of Hormuz traffic returns to normal?');
  assert.equal(hormuz.prob, 15);
  assert.equal(hormuz.question, 'Strait of Hormuz traffic returns to normal?');
  assert.equal(hormuz.end_date, '2026-12-31T00:00:00Z');

  assert.equal(byTitle(rows, 'Saudi defense pact signed'), undefined);
  assert.equal(byTitle(rows, 'Iran rumor mill'), undefined);
  assert.equal(byTitle(rows, 'Iran outcome missing'), undefined);
  assert.equal(byTitle(rows, 'Iran conflict resolved'), undefined);
  assert.equal(byTitle(rows, 'Gaza corridor already settled'), undefined);
  assert.equal(byTitle(rows, 'Putin statement on grain'), undefined);
  assert.equal(byTitle(rows, 'Oil prices next week'), undefined);
  assert.equal(byTitle(rows, 'Alternative energy bill'), undefined);

  const russia = titles(rows, 'RUSIA_UCRANIA');
  assert.deepEqual(russia, [
    'Russia and Ukraine ceasefire talks',
    'NATO exercise in the Baltic',
    'Zelensky press note',
  ]);
  assert.equal(byTitle(rows, 'Zelensky press note').volume, 250_000);
  assert.equal(byTitle(rows, 'Zelensky press note').liquidity, 25_000);
  assert.equal(byTitle(rows, 'Russia and Ukraine ceasefire talks').prob, 33);
  assert.deepEqual(byTitle(rows, 'NATO exercise in the Baltic').currencies, ['EUR', 'CHF', 'GBP', 'XAU']);

  assert.deepEqual(titles(rows, 'CHINA_TAIWAN'), [
    'Will China invade Taiwan by end of 2026?',
    'China tariff package',
    'Xi Jinping out before 2027',
  ]);
  assert.equal(byTitle(rows, 'Xi Jinping out before 2027').url, null);
  assert.deepEqual(byTitle(rows, 'Will China invade Taiwan by end of 2026?').currencies, ['AUD', 'NZD', 'JPY', 'USD']);

  assert.deepEqual(titles(rows, 'ARANCELES_COMERCIO'), [
    'US tariff schedule and trade war talks',
    'China tariff package',
    'Section 232 steel review',
  ]);
  assert.equal(byTitle(rows, 'Section 232 steel review').volume, 1_000_000);
  assert.equal(byTitle(rows, 'Section 232 steel review').liquidity, 30_000.5);
  assert.deepEqual(byTitle(rows, 'China tariff package').currencies, ['CAD', 'AUD', 'NZD', 'EUR', 'JPY', 'CHF']);
  const chinaCopy = rows.filter((row) => row.event_title === 'China tariff package' && row.theme === 'CHINA_TAIWAN');
  assert.equal(chinaCopy.length, 1);
  assert.deepEqual(chinaCopy[0].currencies, ['AUD', 'NZD', 'JPY', 'USD']);

  assert.deepEqual(titles(rows, 'WASHINGTON'), [
    'Will Congress end the shutdown?',
    'Who will be confirmed as Fed Chair?',
  ]);
  assert.equal(byTitle(rows, 'Who will be confirmed as Fed Chair?').prob, 61);
  assert.deepEqual(byTitle(rows, 'Who will be confirmed as Fed Chair?').currencies, ['USD', 'XAU']);

  for (const title of [
    'NBA finals Israel exhibition',
    'Israel derby special',
    'Gaza concert night',
    'What price will Bitcoin hit if China invades Taiwan?',
    'Clarity Act signed into law in 2026?',
    'Will Ukraine win the Oscar for best documentary?',
    'How many Fed rate cuts if the shutdown ends?',
    'Shutdown timing for the December meeting',
    'FedWatch odds during a shutdown',
    'Taiwan strait archived case',
  ]) {
    assert.equal(byTitle(rows, title), undefined, title);
  }

  assert.equal(exclusionReason(fixture.find((event) => event.id === 'nba-israel')), 'sports');
  assert.equal(exclusionReason(fixture.find((event) => event.id === 'israel-derby')), 'sports');
  assert.equal(exclusionReason(fixture.find((event) => event.id === 'gaza-concert')), 'entertainment');
  assert.equal(exclusionReason(fixture.find((event) => event.id === 'bitcoin-china')), 'crypto');
  assert.equal(exclusionReason(fixture.find((event) => event.id === 'clarity')), 'crypto');
  assert.equal(exclusionReason(fixture.find((event) => event.id === 'oscar')), 'entertainment');
  assert.equal(exclusionReason(fixture.find((event) => event.id === 'fed-rate')), 'central_bank');
  assert.equal(exclusionReason(fixture.find((event) => event.id === 'fomc-tag')), 'central_bank');
  assert.equal(exclusionReason(fixture.find((event) => event.id === 'fedwatch')), 'central_bank');
  assert.equal(exclusionReason(fixture.find((event) => event.id === 'fed-chair')), null);

  for (const row of rows) {
    const pub = toPublicMarket(row);
    assert.deepEqual(Object.keys(pub), PUBLIC_KEYS);
    for (const key of ['score', 'rank', 'bias', 'direction', 'risk_level', 'lock_level', 'side']) {
      assert.equal(Object.hasOwn(pub, key), false);
    }
  }
  assert.equal(rows.filter((row) => row.theme === 'IRAN_ORIENTE_MEDIO').length, 5);
  assert.doesNotMatch(JSON.stringify(rows.map(toPublicMarket)), BANNED);
});

test('d24h_pp usa la instantánea más cercana a 24 h dentro de ±1 h', () => {
  const rows = selectPolymarketMarkets(fixture);
  const iran = byTitle(rows, 'Will the US invade Iran before 2027?');
  const exact = '2026-11-09T18:00:00.000Z';
  const nearerOther = '2026-11-09T18:40:00.000Z';
  const decorated = applyD24h(rows, [
    { at: exact, rows: [{ key: iran.key, prob: 30 }] },
    { at: nearerOther, rows: [{ key: iran.key, prob: 99 }] },
  ], NOW);
  assert.equal(byTitle(decorated, iran.event_title).d24h_pp, 12);

  const edge = closestSnapshot([
    { at: '2026-11-09T17:00:00.000Z', rows: [{ key: iran.key, prob: 10 }] },
    { at: '2026-11-09T19:00:00.000Z', rows: [{ key: iran.key, prob: 80 }] },
  ], NOW);
  assert.equal(edge.at, '2026-11-09T17:00:00.000Z');
  assert.equal(d24hFor(iran.key, 42, [
    { at: '2026-11-09T17:00:00.000Z', rows: [{ key: iran.key, prob: 10 }] },
    { at: '2026-11-09T19:00:00.000Z', rows: [{ key: iran.key, prob: 80 }] },
  ], NOW), 32);

  assert.equal(d24hFor(iran.key, 42, [
    { at: '2026-11-09T16:59:00.000Z', rows: [{ key: iran.key, prob: 1 }] },
  ], NOW), null);

  assert.equal(d24hFor(iran.key, 42, [
    { at: exact, rows: [{ key: 'other', prob: 30 }] },
    { at: nearerOther, rows: [{ key: iran.key, prob: 99 }] },
  ], NOW), null);

  assert.equal(d24hFor(iran.key, 42, [
    { at: exact, rows: [{ key: iran.key, prob: 49 }] },
  ], NOW), -7);

  const negative = applyD24h([iran], [
    { at: exact, rows: [{ key: iran.key, prob: 49 }] },
  ], NOW)[0];
  assert.equal(negative.d24h_pp, -7);
  assert.equal(Object.hasOwn(toPublicMarket(negative), 'risk_level'), false);
});

test('la historia guarda 8 días y el borde exacto se queda', () => {
  const old = new Date(NOW - 8 * 24 * 60 * 60 * 1000 - 1).toISOString();
  const edge = new Date(NOW - 8 * 24 * 60 * 60 * 1000).toISOString();
  const trimmed = trimPolymarketHistory({
    schema: POLYMARKET_HISTORY_SCHEMA,
    latest: null,
    snapshots: [
      { at: old, rows: [{ key: 'a', prob: 1 }] },
      { at: edge, rows: [{ key: 'b', prob: 2 }] },
    ],
  }, NOW);
  assert.equal(trimmed.snapshots.length, 1);
  assert.equal(trimmed.snapshots[0].rows[0].key, 'b');
});

test('Gamma fijo: OK, cadencia de 30 min, STALE sin inventar y espera creciente', async () => {
  const seen = [];
  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('network'); };
  try {
    let calls = 0;
    const fetchImpl = async (url, init) => {
      calls += 1;
      seen.push({ url: String(url), init });
      const offset = Number(new URL(url).searchParams.get('offset') || 0);
      if (offset !== 0) throw new Error('page');
      return { ok: true, status: 200, json: async () => fixture };
    };
    const state = clock();
    const first = await fetchPolymarketGeo({ history: null, now: NOW, fetchImpl, state });
    assert.equal(calls, 1);
    assert.equal(first.block.status, 'OK');
    assert.equal(first.block.updated_at, '2026-11-10T18:00:00.000Z');
    assert.equal(byTitle(first.block.markets, 'Will the US invade Iran before 2027?').prob, 42);
    assert.equal(byTitle(first.block.markets, 'Will the US invade Iran before 2027?').d24h_pp, null);
    assert.equal(first.history.schema, POLYMARKET_HISTORY_SCHEMA);
    assert.equal(first.history.snapshots.length, 1);
    assert.equal(seen[0].init.headers.Authorization, undefined);
    assert.equal(seen[0].init.headers.authorization, undefined);
    assert.equal(seen[0].url.startsWith(`${GAMMA_EVENTS_URL}?`), true);
    assert.match(seen[0].url, /closed=false/);
    assert.match(seen[0].url, /order=volume/);
    assert.doesNotMatch(seen[0].url, /api_key|apikey|token=/i);
    assert.doesNotMatch(JSON.stringify(first.block), BANNED);

    const second = await fetchPolymarketGeo({
      history: first.history,
      now: NOW + 10 * 60 * 1000,
      fetchImpl,
      state: clock(),
    });
    assert.equal(calls, 1);
    assert.equal(second.block.status, 'OK');
    assert.equal(second.block.updated_at, first.block.updated_at);

    const third = await fetchPolymarketGeo({
      history: first.history,
      now: NOW + 30 * 60 * 1000,
      fetchImpl,
      state: clock(),
    });
    assert.equal(calls, 2);
    assert.equal(third.history.snapshots.length, 2);

    const prior = selectPolymarketMarkets(fixture).find((row) => row.event_title.startsWith('Will the US invade'));
    const history = {
      schema: POLYMARKET_HISTORY_SCHEMA,
      latest: { at: '2026-11-10T10:00:00.000Z', markets: [prior] },
      snapshots: [
        { at: '2026-11-09T12:00:00.000Z', rows: [{ key: prior.key, prob: 30 }] },
        { at: '2026-11-10T10:00:00.000Z', rows: [{ key: prior.key, prob: prior.prob }] },
      ],
    };
    let failed = 0;
    const failing = async () => {
      failed += 1;
      throw new Error('gamma down');
    };
    const staleState = clock();
    const stale = await fetchPolymarketGeo({
      history,
      now: NOW,
      fetchImpl: failing,
      state: staleState,
    });
    assert.equal(failed, 1);
    assert.equal(stale.block.status, 'STALE');
    assert.equal(stale.block.updated_at, '2026-11-10T10:00:00.000Z');
    assert.equal(stale.block.markets.length, 1);
    assert.equal(stale.block.markets[0].prob, 42);
    assert.equal(stale.block.markets[0].event_title, prior.event_title);
    assert.equal(stale.history.snapshots.length, history.snapshots.length);
    assert.equal(staleState.backoff, POLYMARKET_BACKOFF_START_MS);
    assert.equal(staleState.nextTry, NOW + POLYMARKET_BACKOFF_START_MS);

    const held = await fetchPolymarketGeo({
      history,
      now: NOW + 5 * 60 * 1000,
      fetchImpl: failing,
      state: staleState,
    });
    assert.equal(failed, 1);
    assert.equal(held.block.status, 'STALE');
    assert.equal(held.block.markets[0].prob, 42);

    const again = await fetchPolymarketGeo({
      history,
      now: NOW + POLYMARKET_BACKOFF_START_MS,
      fetchImpl: failing,
      state: staleState,
    });
    assert.equal(failed, 2);
    assert.equal(again.block.status, 'STALE');
    assert.equal(staleState.backoff, POLYMARKET_BACKOFF_START_MS * 2);

    staleState.backoff = POLYMARKET_BACKOFF_MAX_MS;
    staleState.nextTry = NOW;
    staleState.lastOutcome = 'STALE';
    await fetchPolymarketGeo({ history, now: NOW, fetchImpl: failing, state: staleState });
    assert.equal(staleState.backoff, POLYMARKET_BACKOFF_MAX_MS);

    const empty = await fetchPolymarketGeo({
      history: null,
      now: NOW,
      fetchImpl: failing,
      state: clock(),
    });
    assert.equal(empty.block.status, 'STALE');
    assert.equal(empty.block.updated_at, null);
    assert.deepEqual(empty.block.markets, []);

    const partialState = clock();
    let partialCalls = 0;
    const partial = await fetchPolymarketGeo({
      history,
      now: NOW,
      state: partialState,
      fetchImpl: async (url) => {
        partialCalls += 1;
        const offset = Number(new URL(url).searchParams.get('offset') || 0);
        if (offset === 0) {
          return {
            ok: true,
            status: 200,
            json: async () => Array.from({ length: 100 }, (_, i) => ({
              id: `filler-${i}`,
              title: `Unrelated weather ${i}`,
              closed: false,
              active: true,
              volume: 5_000_000,
              liquidity: 100_000,
              markets: [{
                id: `filler-m-${i}`,
                question: 'Rain?',
                closed: false,
                active: true,
                volumeNum: 1,
                outcomes: '["Yes","No"]',
                outcomePrices: '["0.5","0.5"]',
              }],
            })),
          };
        }
        throw new Error('second page failed');
      },
    });
    assert.equal(partialCalls, 2);
    assert.equal(partial.block.status, 'STALE');
    assert.equal(partial.block.markets.length, 1);
    assert.equal(partial.block.markets[0].prob, 42);
    assert.equal(partial.block.updated_at, '2026-11-10T10:00:00.000Z');

    const badBody = await fetchPolymarketGeo({
      history,
      now: NOW,
      state: clock(),
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ events: fixture }) }),
    });
    assert.equal(badBody.block.status, 'STALE');
    assert.equal(badBody.block.markets[0].prob, 42);

    const http = await fetchPolymarketGeo({
      history: null,
      now: NOW,
      state: clock(),
      fetchImpl: async () => ({ ok: false, status: 503, json: async () => [] }),
    });
    assert.equal(http.block.status, 'STALE');
    assert.deepEqual(http.block.markets, []);
  } finally {
    globalThis.fetch = original;
  }
});

test('el colector, la sincronización, la función live y la puerta publican el bloque', () => {
  const collector = readFileSync(new URL('../src/irisCollector.js', import.meta.url), 'utf8');
  const sync = readFileSync(new URL('../scripts/sync_feeds.mjs', import.meta.url), 'utf8');
  const loop = readFileSync(new URL('../scripts/sync_loop.sh', import.meta.url), 'utf8');
  const live = readFileSync(new URL('../netlify/functions/radar_live.mjs', import.meta.url), 'utf8');
  const workflow = readFileSync(new URL('../.github/workflows/update_radar_news.yml', import.meta.url), 'utf8');
  const spec = readFileSync(new URL('../SPEC.md', import.meta.url), 'utf8');
  const source = readFileSync(new URL('../src/polymarketGeo.js', import.meta.url), 'utf8');

  assert.match(collector, /fetchPolymarketGeo/);
  assert.match(collector, /polymarket_geo/);
  assert.match(collector, /llm_calls: 0/);
  assert.match(sync, /polymarket_geo_history\.json/);
  assert.match(sync, /polymarketHistory/);
  assert.match(loop, /public\/data\/polymarket_geo_history\.json/);
  assert.match(loop, /chore\(feed\): sync radar news \[skip netlify\]/);
  assert.match(live, /polymarket_geo_history\.json/);
  assert.match(live, /polymarketHistory/);
  assert.match(workflow, /test\/polymarket_geo\.test\.js/);
  assert.match(workflow, /test\/live_base\.test\.js/);
  assert.match(spec, /Contrato Polymarket geopolítico/);
  assert.match(source, /gamma-api\.polymarket\.com/);
  assert.doesNotMatch(source, /openai|gemini|anthropic|cmegroup|fedwatch\.com/i);
  assert.equal((source.match(/llm_calls/g) || []).length, 0);
});
