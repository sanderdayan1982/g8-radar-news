import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { surpriseZ } from '../src/enrich.js';
import { projectIrisFeed } from '../src/irisCollector.js';
import {
  SURP_SPEC,
  annotateTurns,
  appendCloses,
  appendCsvText,
  computeClose,
  hysteresisStates,
  percentileInc,
  percentileRank,
  populationStdev,
  previousClose,
  renderCsv,
  runSurpCycle,
  scoreReleases,
  sessionCloseForRelease,
  surpPublishEnabled,
} from '../src/surp.js';

const CLOSE = '2026-11-18T22:00:00.000Z';
const DAY = 86400000;
const ROOT = new URL('..', import.meta.url);
const IRIS_KEYS = [
  'schema_version', 'version', 'engine_version', 'llm_calls', 'generated_at',
  'health', 'coverage', 'risk_map', 'pair_risk', 'agenda_window', 'polymarket_geo', 'execution_windows', 'items',
];

function near(actual, expected) {
  assert.equal(typeof actual, 'number');
  assert.ok(Math.abs(actual - expected) < 1e-9);
}

function fresh(closeAt) {
  return { loopUpdatedAt: closeAt, sourceUpdatedAt: closeAt };
}

function release(partial) {
  return {
    country: 'US',
    title: 'CPI m/m',
    forecast: '10',
    actual: '10.4',
    release_at: CLOSE,
    ...partial,
  };
}

function usd(block) {
  return block.rows.find((row) => row.ccy === 'USD');
}

function pstdev(values) {
  const n = values.length;
  const mean = values.reduce((sum, value) => sum + value, 0) / n;
  const acc = values.reduce((sum, value) => sum + (value - mean) ** 2, 0);
  return Math.sqrt(acc / n);
}

function seriesOf(count) {
  return Array.from({ length: count }, (_, index) => release({
    actual: String(10 + index + 1),
    release_at: new Date(Date.parse(CLOSE) - (count - index - 1) * DAY).toISOString(),
  }));
}

function hashPublic() {
  const root = new URL('../public/', import.meta.url);
  const hash = createHash('sha256');
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name);
      const info = statSync(path);
      hash.update(path.replace(root.pathname, ''));
      if (info.isDirectory()) walk(path);
      else hash.update(readFileSync(path));
    }
  };
  walk(root.pathname);
  return hash.digest('hex');
}

function findNamed(dir, name, found = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.git') continue;
    const path = join(dir, entry);
    const info = statSync(path);
    if (info.isDirectory()) findNamed(path, name, found);
    else if (entry === name) found.push(path);
  }
  return found;
}

test('T-S1 sigma with 11/12/24/25 releases', () => {
  const expectSigma = (previous, surprises) => {
    const scored = scoreReleases(seriesOf(previous + 1));
    const last = scored[scored.length - 1];
    if (surprises) assert.equal(surprises.includes(last.surprise), false);
    if (previous < SURP_SPEC.sigmaMinReleases) {
      assert.equal(last.sigma_prov, true);
      near(last.sigma, 0.4);
      return;
    }
    assert.equal(last.sigma_prov, false);
    near(last.sigma, pstdev(surprises));
    near(last.sigma, populationStdev(surprises));
  };
  expectSigma(11, null);
  expectSigma(12, Array.from({ length: 12 }, (_, i) => i + 1));
  expectSigma(24, Array.from({ length: 24 }, (_, i) => i + 1));
  expectSigma(25, Array.from({ length: 24 }, (_, i) => i + 2));
});

test('T-S2 z clipped +-3', () => {
  const zOf = (actual) => scoreReleases([release({ actual })])[0].z;
  assert.equal(zOf('14'), SURP_SPEC.zClip);
  assert.equal(zOf('6'), -SURP_SPEC.zClip);
  near(zOf('10.4'), 1);
  const high = computeClose({ releases: [release({ actual: '14' })], closeAt: CLOSE, ...fresh(CLOSE) });
  const low = computeClose({ releases: [release({ actual: '6' })], closeAt: CLOSE, ...fresh(CLOSE) });
  assert.equal(usd(high).surp, SURP_SPEC.zClip);
  assert.equal(usd(low).surp, -SURP_SPEC.zClip);
});

test('T-S3 decay at 0/10/20 days', () => {
  for (const [age, factor] of [[0, 1], [10, 0.5], [20, 0.25]]) {
    const at = new Date(Date.parse(CLOSE) - age * DAY).toISOString();
    const block = computeClose({
      releases: [release({ release_at: at })],
      closeAt: CLOSE,
      ...fresh(CLOSE),
    });
    near(usd(block).surp, factor);
  }
});

test('T-S4 class weights and rate exclusion', () => {
  const weights = [
    ['Nonfarm payrolls', '10.4', 'LABOUR'],
    ['Initial jobless claims', '9.6', 'CLAIMS'],
    ['CPI m/m', '10.4', 'CPI'],
    ['Core PCE m/m', '10.4', 'PCE'],
    ['GDP q/q', '10.4', 'GDP'],
    ['Retail sales m/m', '10.4', 'RETAIL_SALES'],
    ['Manufacturing PMI', '10.4', 'PMI'],
    ['ISM manufacturing', '10.4', 'ISM'],
    ['Industrial production m/m', '10.4', 'INDUSTRIAL_PRODUCTION'],
    ['PPI m/m', '10.4', 'PPI'],
    ['Trade balance', '10.4', 'TRADE'],
    ['Consumer confidence', '10.4', 'CONSUMER_CONFIDENCE'],
    ['Housing starts', '10.4', 'OTHER'],
  ];
  for (const [title, actual, category] of weights) {
    const scored = scoreReleases([release({ title, actual })])[0];
    assert.equal(scored.category, category);
    near(scored.z, 1);
    const block = computeClose({
      releases: [release({ title, actual })],
      closeAt: CLOSE,
      ...fresh(CLOSE),
    });
    const expected = category === 'OTHER' ? SURP_SPEC.weights.REST : SURP_SPEC.weights[category];
    near(usd(block).surp, expected);
  }
  const misparsed = scoreReleases([release({
    title: 'Effective Fed Funds 3.88% November 12',
    actual: '12',
    forecast: '3.9',
  })])[0];
  assert.equal(misparsed.include, false);
  assert.equal(misparsed.category, 'RATE');
  assert.notEqual(misparsed.actual, 12);
  const blocked = computeClose({
    releases: [release({
      title: 'Effective Fed Funds 3.88% November 12',
      actual: '12',
      forecast: '3.9',
    })],
    closeAt: CLOSE,
    ...fresh(CLOSE),
  });
  assert.equal(usd(blocked).surp, 'UNAVAILABLE');
  const decision = scoreReleases([release({ title: 'Monetary policy statement', actual: '5.25', forecast: '5' })])[0];
  assert.equal(decision.include, false);
  assert.equal(decision.category, 'MONETARY_POLICY');
});

test('T-S5 unemployment inverted once', () => {
  const jobless = scoreReleases([release({ title: 'Unemployment rate', actual: '10.4' })])[0];
  const claims = scoreReleases([release({ title: 'Initial jobless claims', actual: '10.4' })])[0];
  const payrolls = scoreReleases([release({ title: 'Nonfarm payrolls', actual: '10.4' })])[0];
  near(jobless.surprise, 0.4);
  near(jobless.z, -1);
  near(claims.z, -1);
  near(payrolls.z, 1);
  near(Math.abs(jobless.z), Math.abs(payrolls.z));
});

test('T-S6 SURP_rel and pair with one UNAVAILABLE currency', () => {
  const specs = [
    ['US', '10.4'],
    ['Germany', '10.8'],
    ['UK', '10.2'],
    ['Japan', '9.6'],
    ['Switzerland', '10'],
    ['Canada', '10.6'],
    ['Australia', '9.8'],
  ];
  const releases = specs.map(([country, actual]) => release({ country, actual }));
  const block = computeClose({ releases, closeAt: CLOSE, ...fresh(CLOSE) });
  const rows = block.rows;
  const numbers = rows.filter((row) => typeof row.surp === 'number');
  assert.equal(numbers.length, 7);
  const mean = numbers.reduce((sum, row) => sum + row.surp, 0) / numbers.length;
  for (const row of numbers) near(row.surp_rel, row.surp - mean);
  const nzd = rows.find((row) => row.ccy === 'NZD');
  assert.equal(nzd.surp, 'UNAVAILABLE');
  assert.equal(nzd.surp_rel, 'UNAVAILABLE');
  assert.equal(block.block.pairs.NZDUSD, 'UNAVAILABLE');
  const eur = rows.find((row) => row.ccy === 'EUR').surp;
  const dollar = rows.find((row) => row.ccy === 'USD').surp;
  near(block.block.pairs.EURUSD, eur - dollar);
});

test('T-S7 edges 80/70, 20/30 and 2 closes', () => {
  const sample = (inside, size) => {
    const current = 0;
    const values = [];
    for (let i = 0; i < inside - 1; i += 1) values.push(current);
    for (let i = 0; i < size - inside; i += 1) values.push(current + 1);
    values.push(current);
    return values;
  };
  assert.equal(percentileRank(sample(48, 60)), 80);
  assert.equal(percentileRank(sample(42, 60)), 70);
  assert.equal(percentileRank(sample(12, 60)), 20);
  assert.equal(percentileRank(sample(18, 60)), 30);
  const last = (series) => hysteresisStates(series).at(-1);
  assert.equal(last([80]), 'NEUTRO');
  assert.equal(last([80, 80]), 'BEAT');
  assert.equal(last([80, 80, 70]), 'BEAT');
  assert.equal(last([80, 80, 69]), 'BEAT');
  assert.equal(last([80, 80, 69, 69]), 'NEUTRO');
  assert.equal(last([80, 75]), 'NEUTRO');
  assert.equal(last([20]), 'NEUTRO');
  assert.equal(last([20, 20]), 'MISS');
  assert.equal(last([20, 20, 30]), 'MISS');
  assert.equal(last([20, 20, 31]), 'MISS');
  assert.equal(last([20, 20, 31, 31]), 'NEUTRO');
});

test('T-S8 TURN with and without sign change', () => {
  const same = annotateTurns([1, 1, 1, 1, 1, 1, 4]);
  assert.equal(Math.sign(4), Math.sign(1));
  assert.equal(same.at(-1).turn, false);

  const flip = annotateTurns([1, 1, 1, 1, 1, 1, -1]);
  assert.notEqual(Math.sign(-1), Math.sign(1));
  assert.equal(flip.at(-1).d5, -2);
  const flipAbs = flip.map((row) => row.d5).filter((value) => typeof value === 'number').map(Math.abs);
  const flipCut = percentileInc(flipAbs, 0.8);
  assert.ok(Math.abs(flip.at(-1).d5) >= flipCut);
  assert.equal(flip.at(-1).turn, true);

  const quiet = [];
  for (let i = 0; i < 21; i += 1) quiet.push(i % 2 === 0 ? 20 : -20);
  quiet[15] = -0.05;
  quiet[20] = 0.05;
  const quietFlags = annotateTurns(quiet);
  const quietAbs = quietFlags.map((row) => row.d5).filter((value) => typeof value === 'number').map(Math.abs);
  assert.notEqual(Math.sign(quiet[20]), Math.sign(quiet[15]));
  assert.ok(Math.abs(quietFlags[20].d5) < percentileInc(quietAbs, 0.8));
  assert.equal(quietFlags[20].turn, false);

  const priors = [0, 1, 2, 3, 4].map((step) => ({
    close_at: new Date(Date.parse(CLOSE) - (5 - step) * DAY).toISOString(),
    ccy: 'USD',
    surp: 1,
    surp_reason: 'ok',
  }));
  const down = computeClose({
    releases: [release({ actual: '9.6' })],
    closeAt: CLOSE,
    priorRows: priors,
    ...fresh(CLOSE),
  });
  const up = computeClose({
    releases: [release({ actual: '10.4' })],
    closeAt: CLOSE,
    priorRows: priors,
    ...fresh(CLOSE),
  });
  assert.equal(usd(down).surp_turn, true);
  assert.equal(usd(up).surp_turn, false);
});

test('T-S9 PROV at n = 59/60/251/252', () => {
  const closeMs = Date.parse(CLOSE);
  const releases = [];
  for (let i = 0; i < 12; i += 1) {
    releases.push(release({
      release_at: new Date(closeMs - (100 + i) * DAY).toISOString(),
    }));
  }
  releases.push(release({ release_at: CLOSE }));
  const sessionsBefore = (count) => {
    let cursor = closeMs;
    const rows = [];
    for (let i = 0; i < count; i += 1) {
      cursor = previousClose(cursor);
      rows.push({
        close_at: new Date(cursor).toISOString(),
        ccy: 'USD',
        surp: 1,
        surp_reason: 'ok',
      });
    }
    return rows;
  };
  const at = (n) => usd(computeClose({
    releases,
    closeAt: CLOSE,
    priorRows: sessionsBefore(n - 1),
    ...fresh(CLOSE),
  }));
  const n59 = at(59);
  const n60 = at(60);
  const n251 = at(251);
  const n252 = at(252);
  assert.equal(typeof n59.surp, 'number');
  assert.equal(n59.surp_prov, false);
  assert.equal(n59.surp_state, 'UNAVAILABLE');
  assert.equal(n60.surp_prov, true);
  assert.equal(n251.surp_prov, true);
  assert.equal(n252.surp_prov, false);
  assert.notEqual(n252.surp_state, 'UNAVAILABLE');
});

test('T-S10 no consensus -> out, 30 days without data -> UNAVAILABLE', () => {
  const noForecast = computeClose({
    releases: [release({ forecast: null })],
    closeAt: CLOSE,
    ...fresh(CLOSE),
  });
  const noActual = computeClose({
    releases: [release({ actual: null })],
    closeAt: CLOSE,
    ...fresh(CLOSE),
  });
  const staleData = computeClose({
    releases: [release({ release_at: new Date(Date.parse(CLOSE) - 31 * DAY).toISOString() })],
    closeAt: CLOSE,
    ...fresh(CLOSE),
  });
  for (const block of [noForecast, noActual, staleData]) {
    assert.equal(usd(block).surp, 'UNAVAILABLE');
    assert.notEqual(usd(block).surp, 0);
    assert.equal(usd(block).n_rel_30d, 0);
  }
  const scored = scoreReleases([release({ forecast: null }), release({ actual: null })]);
  assert.equal(scored.every((row) => row.include === false), true);
});

test('T-S11 correction appends, past close intact', () => {
  const firstAt = CLOSE;
  const secondAt = '2026-11-19T22:00:00.000Z';
  const original = [release({ id: 'r1', release_at: firstAt })];
  const first = computeClose({ releases: original, closeAt: firstAt, ...fresh(firstAt) });
  let archive = appendCloses([], first.rows);
  const frozen = structuredClone(archive);
  const csv1 = renderCsv(archive);
  const corrected = original.concat([release({
    id: 'r2',
    corrects: 'r1',
    actual: '14',
    release_at: '2026-11-19T18:00:00.000Z',
  })]);
  const second = computeClose({
    releases: corrected,
    closeAt: secondAt,
    priorRows: archive,
    ...fresh(secondAt),
  });
  archive = appendCloses(archive, second.rows);
  const csv2 = renderCsv(archive);
  const again = appendCloses(archive, first.rows);
  assert.deepEqual(archive.filter((row) => row.close_at === firstAt), frozen);
  assert.equal(csv2.slice(0, csv1.length), csv1);
  assert.equal(appendCsvText(csv1, second.rows).slice(0, csv1.length), csv1);
  assert.equal(again.length, archive.length);
  assert.notEqual(second.rows.find((row) => row.ccy === 'USD').surp, frozen.find((row) => row.ccy === 'USD').surp);
});

test('T-S12 release at 23:01 WAT -> next close', () => {
  const late = '2026-11-18T22:01:00.000Z';
  const thursday = '2026-11-19T22:00:00.000Z';
  const fridayLate = '2026-11-20T22:01:00.000Z';
  const monday = '2026-11-23T22:00:00.000Z';
  assert.equal(sessionCloseForRelease(late), thursday);
  assert.equal(sessionCloseForRelease(CLOSE), CLOSE);
  assert.equal(sessionCloseForRelease(fridayLate), monday);
  const missed = computeClose({
    releases: [release({ release_at: late })],
    closeAt: CLOSE,
    ...fresh(CLOSE),
  });
  const next = computeClose({
    releases: [release({ release_at: late })],
    closeAt: thursday,
    ...fresh(thursday),
  });
  assert.equal(usd(missed).surp, 'UNAVAILABLE');
  const age = (Date.parse(thursday) - Date.parse(late)) / DAY;
  near(usd(next).surp, 2 ** (-age / SURP_SPEC.halfLifeDays));
});

test('T-S13 currency by country (Spanish CPI -> EUR)', () => {
  const scored = scoreReleases([
    release({
      country: 'Spain',
      title: 'CPI m/m',
      headline: 'USD dollar Fed payrolls',
    }),
    release({
      country: 'EUR',
      title: 'Spanish CPI m/m',
      headline: 'dollar index',
    }),
    release({ country: 'Germany', title: 'CPI m/m' }),
    release({ country: 'USD', title: 'Spanish CPI m/m' }),
  ]);
  const spain = scored.find((row) => row.place === 'es' && row.title === 'CPI m/m');
  const titled = scored.find((row) => row.title === 'Spanish CPI m/m' && row.place === 'es');
  const germany = scored.find((row) => row.place === 'de');
  const states = scored.find((row) => row.place === 'us');
  assert.equal(spain.ccy, 'EUR');
  assert.equal(spain.include, false);
  assert.equal(titled.ccy, 'EUR');
  assert.equal(titled.include, false);
  assert.equal(germany.ccy, 'EUR');
  assert.equal(germany.include, true);
  assert.equal(states.ccy, 'USD');
  const block = computeClose({
    releases: [
      release({ country: 'Spain', title: 'CPI m/m' }),
      release({ country: 'Germany', title: 'CPI m/m' }),
    ],
    closeAt: CLOSE,
    ...fresh(CLOSE),
  });
  near(block.rows.find((row) => row.ccy === 'EUR').surp, 1);
});

test('T-S14 variants grouped', () => {
  const variants = [
    release({ title: 'CPI m/m', actual: '10.4' }),
    release({ title: 'CPI y/y', actual: '10.8' }),
    release({ title: 'Core CPI m/m', actual: '11.2' }),
    release({ title: 'Core CPI y/y', forecast: null, actual: '11.2' }),
  ];
  const scored = scoreReleases(variants);
  const included = scored.filter((row) => row.include);
  assert.equal(included.length, 3);
  const mean = included.reduce((sum, row) => sum + row.z, 0) / included.length;
  const block = computeClose({ releases: variants, closeAt: CLOSE, ...fresh(CLOSE) });
  near(usd(block).surp, mean);
  const ungrouped = included.reduce((sum, row) => sum + row.z, 0);
  assert.ok(Math.abs(usd(block).surp - ungrouped) > 0.5);
});

test('T-S16 thresholds in code = signed table', () => {
  const signed = {
    module: 'FAMILIAS-01',
    phase: 2,
    part: 'M3',
    signedBy: 'Sander',
    signedOn: '2026-11-16',
    mode: 'SHADOW',
    publishFlag: 'SURP_PUBLISH',
    publishDefault: false,
    zClip: 3,
    halfLifeDays: 10,
    maxAgeDays: 90,
    sigmaMinReleases: 12,
    sigmaWindow: 24,
    provisionalSigmaFloor: 0.15,
    provisionalSigmaFraction: 0.04,
    provisionalSigmaWhenForecastZero: 0.2,
    weights: {
      LABOUR: 1,
      CLAIMS: 1,
      CPI: 1,
      PCE: 1,
      GDP: 0.7,
      RETAIL_SALES: 0.7,
      PMI: 0.7,
      ISM: 0.7,
      INDUSTRIAL_PRODUCTION: 0.7,
      PPI: 0.4,
      TRADE: 0.4,
      CONSUMER_CONFIDENCE: 0.4,
      REST: 0.4,
    },
    excludedCategories: ['MONETARY_POLICY', 'RATE'],
    beatEnterPct: 80,
    beatExitPct: 70,
    missEnterPct: 20,
    missExitPct: 30,
    confirmCloses: 2,
    pctWindow: 252,
    unavailableBelowCloses: 60,
    turnLagSessions: 5,
    turnAbsPercentile: 80,
    closeHourWat: 23,
    closeMinuteWat: 0,
    watZone: 'Africa/Malabo',
    watOffsetHours: 1,
    sessions: 'Mon-Fri',
    livenessDays: 30,
    staleHours: 6,
    invertedSource: 'INVERTED',
    destinationRepo: 'sanderdayan1982/g8-macro-data',
    destinationPath: 'surp_daily.csv',
    writerDisabledLog: 'SURP writer disabled',
    tokenEnv: 'G8_DATA_WRITE',
  };
  assert.deepEqual(SURP_SPEC, signed);
  assert.equal(Object.isFrozen(SURP_SPEC), true);
  assert.equal(Object.isFrozen(SURP_SPEC.weights), true);
});

test('T-S15 flag off: public/ and feed byte-identical, surpriseZ unchanged', async () => {
  const enrich = readFileSync(new URL('../src/enrich.js', import.meta.url), 'utf8');
  const start = enrich.indexOf('export function surpriseZ');
  const end = enrich.indexOf('export const HISTORICAL_COMMEMORATION');
  const body = enrich.slice(start, end);
  assert.match(body, /const sigma = Math\.max\(0\.15, Math\.abs\(f\) \* 0\.04 \|\| 0\.2\);/);
  assert.match(body, /if \(INVERTED\.test\(item\.title \|\| ''\)\) z = -z;/);
  const item = { title: 'Payrolls', actual: '2', forecast: '1' };
  const got = surpriseZ(item);
  const sigma = Math.max(0.15, Math.abs(1) * 0.04 || 0.2);
  const raw = (2 - 1) / sigma;
  assert.equal(got.z, Math.round(raw * 10) / 10);
  assert.equal(got.absZ, Math.abs(raw));
  const inverted = surpriseZ({ title: 'Unemployment rate', actual: '2', forecast: '1' });
  assert.equal(inverted.z, Math.round(-raw * 10) / 10);

  const before = hashPublic();
  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => { logs.push(args.join(' ')); };
  let calls = 0;
  try {
    assert.equal(surpPublishEnabled({}), false);
    assert.equal(surpPublishEnabled({ SURP_PUBLISH: 'false' }), false);
    const feed = projectIrisFeed({
      version: '3.1.0',
      engine_version: 'mmt-agent-op-v4.1-G8',
      generated_at: CLOSE,
      health: null,
      coverage: {},
      risk_map: [],
      pair_risk: [],
      agenda_window: [],
      polymarket_geo: { status: 'STALE', markets: [] },
      execution_windows: { tz: 'Africa/Malabo' },
      items: [],
      method: { surp: { currencies: {} } },
    });
    assert.deepEqual(Object.keys(feed), IRIS_KEYS);
    assert.equal(Object.hasOwn(feed, 'method'), false);
    const stored = JSON.parse(readFileSync(new URL('../public/data/iris_g8_feed.json', import.meta.url), 'utf8'));
    assert.deepEqual(Object.keys(stored), IRIS_KEYS);
    await runSurpCycle({
      events: [release()],
      now: CLOSE,
      ...fresh(CLOSE),
      env: { SURP_PUBLISH: 'false' },
      fetchImpl: async () => { calls += 1; return { ok: false, status: 404, json: async () => ({}) }; },
    });
    assert.equal(calls, 0);
    assert.deepEqual(logs, []);
    assert.equal(hashPublic(), before);
    assert.equal(findNamed(ROOT.pathname, 'surp_daily.csv').length, 0);

    const sync = readFileSync(new URL('../scripts/sync_feeds.mjs', import.meta.url), 'utf8');
    assert.match(sync, /surpPublishEnabled\(\)/);
    assert.match(sync, /runSurpCycle/);

    logs.length = 0;
    calls = 0;
    await runSurpCycle({
      events: [release()],
      now: CLOSE,
      ...fresh(CLOSE),
      env: { SURP_PUBLISH: 'true' },
      fetchImpl: async () => { calls += 1; return { ok: false, status: 404, json: async () => ({}) }; },
    });
    assert.deepEqual(logs, [SURP_SPEC.writerDisabledLog]);
    assert.equal(calls, 0);
    assert.equal(hashPublic(), before);
    assert.equal(findNamed(ROOT.pathname, 'surp_daily.csv').length, 0);

    logs.length = 0;
    calls = 0;
    await runSurpCycle({
      events: [release()],
      now: CLOSE,
      ...fresh(CLOSE),
      env: { SURP_PUBLISH: 'true', GITHUB_TOKEN: 'unused', GH_TOKEN: 'unused' },
      fetchImpl: async () => { calls += 1; return { ok: false, status: 404, json: async () => ({}) }; },
    });
    assert.deepEqual(logs, [SURP_SPEC.writerDisabledLog]);
    assert.equal(calls, 0);

    const urls = [];
    await runSurpCycle({
      events: [],
      now: CLOSE,
      ...fresh(CLOSE),
      env: { SURP_PUBLISH: 'true', G8_DATA_WRITE: 'present' },
      fetchImpl: async (url, init) => {
        urls.push(String(url));
        if (init?.method === 'PUT') return { ok: true, json: async () => ({}) };
        return { ok: false, status: 404, json: async () => ({ message: 'missing' }) };
      },
    });
    assert.ok(urls.length > 0);
    assert.equal(urls.every((url) => url.includes(SURP_SPEC.destinationRepo)), true);
    assert.equal(urls.some((url) => url.includes('g8-radar-news')), false);
    assert.equal(hashPublic(), before);
    assert.equal(findNamed(ROOT.pathname, 'surp_daily.csv').length, 0);
  } finally {
    console.log = originalLog;
    delete process.env.SURP_PUBLISH;
  }
});
