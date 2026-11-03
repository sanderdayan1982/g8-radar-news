import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectEvidence, evidenceContract } from '../src/evidence.js';
import { classifyAgent, attachRanks } from '../src/classifyCurrencies.js';
import {
  classifyAgentShadow, evaluateExpandedCoverageExperiment,
  OP_VERSION, SHADOW_VERSION, EXPANDED_EXPERIMENT_VERSION, SHADOW_SPEC,
} from '../src/shadowCalibration.js';
import {
  currencyEvidenceHash, evaluateInterEngineDiscrepancy, evaluateDailyFxAlignment,
  entryFixingDateForSignal, addBusinessDays, classifyCurrencyTransition, computeCodeHash,
  DAILY_FIXING_ENTRY_POLICY,
} from '../src/calibrationEval.js';
import {
  isHistoricalCommemoration, enrichRaw, dedupeNews,
  extractReleaseIdentity, isSameReleaseDuplicate,
} from '../src/enrich.js';
import { SOURCES } from '../src/config.js';
import { hasComparableScore } from '../public/app.js';
import {
  openDb, insertNews, recentNews, listNews, repairPersistedNews,
  saveScores, latestEngine, markGeminiSnapshotReused,
  saveMarketSnapshot, saveCalibrationLog, markHistoricalEvaluationsIneligible,
  getMeta, setMeta,
} from '../src/db.js';

const now = Date.parse('2026-10-25T08:00:00Z');
const item = (fp, currency, age = 1) => ({
  fingerprint: fp,
  currencies: [currency],
  published_at: new Date(now - age * 3600000).toISOString(),
  title: 'Growth stronger than previously expected',
  source_type: 'breaking',
});

test('balanced shared evidence prevents one currency flood and rejects stale/future/invalid dates', () => {
  const rows = [
    ...Array.from({ length: 100 }, (_, i) => item(`usd${i}`, 'USD')),
    item('nzd', 'NZD'),
    item('future', 'CHF', -1),
    item('old', 'EUR', 73),
    { ...item('bad', 'JPY'), published_at: 'bad' },
  ];
  const selected = selectEvidence(rows, now, 8);
  assert.equal(selected.length, 8);
  assert.ok(selected.some((n) => n.fingerprint === 'nzd'));
  assert.ok(!selected.some((n) => ['old', 'bad', 'future'].includes(n.fingerprint)));
  assert.deepEqual(selectEvidence(rows.reverse(), now, 8), selected);
  assert.equal(evidenceContract(selected, now).empirical, false);
  assert.notEqual(evidenceContract(selected, now).evidenceSet, evidenceContract(selected.slice(1), now).evidenceSet);
});

test('missing evidence never produces comparable FX differentials', () => {
  const row = (engine, score) => ({ engine, score, drivers: ['Growth'] });
  assert.equal(hasComparableScore({ score: 0, noEvidence: true }), false);
  assert.equal(hasComparableScore({ score: NaN }), false);
  assert.equal(hasComparableScore(row('agente', 0)), true);
});

test('audit contract and contribution ledger survive SQLite round trip', () => {
  const db = openDb(':memory:');
  const news = [item('gb', 'GBP')];
  const contract = evidenceContract(news, now);
  const rows = attachRanks(classifyAgent(news, now)).map((r) => ({ ...r, calibration: contract }));
  saveScores(db, 'agente', rows, 'test', new Date(now).toISOString());
  const reloaded = latestEngine(db, 'agente').rows;
  const gbp = reloaded.find((r) => r.currency === 'GBP');
  assert.equal(gbp.calibration.evidenceSet, contract.evidenceSet);
  assert.equal(gbp.ledger[0].fingerprint, 'gb');
  assert.equal(gbp.score, Math.round(gbp.ledger.reduce((s, x) => s + x.contribution, 0)));
  assert.equal(reloaded.find((r) => r.currency === 'NZD').noEvidence, true);
  db.close();
});

test('production data hygiene: original dates resolved before temporal filter, real duplicates merged, and war memorials excluded', () => {
  const db = openDb(':memory:');
  const horizon30d = new Date(now - 30 * 24 * 3600_000).toISOString();

  // 1. SECO duplicate: row A has scrape date (Oct 24) and base URL; row B has true date (Sep 17, >30d old) and specific URL
  insertNews(db, {
    title: 'Economic forecast: 2026 growth stronger than previously expected',
    source: 'SECO',
    source_id: '',
    source_type: 'oficial',
    url: 'https://www.seco.admin.ch/en',
    published_at: '2026-10-24T00:10:06.102Z',
    currencies: ['CHF'],
    impact: 2,
    category: 'dato_macro',
    fingerprint: 'seco-scrape-51',
  });
  insertNews(db, {
    title: 'Economic forecast: 2026 growth stronger than previously expected',
    source: 'SECO',
    source_id: 'seco',
    source_type: 'oficial',
    url: 'https://www.seco.admin.ch/en/newnsb/JUhtHgdQzukb',
    published_at: '2026-09-17T12:00:00.000Z',
    currencies: ['CHF'],
    impact: 2,
    category: 'dato_macro',
    fingerprint: 'seco-true-117',
  });

  // Even before repairPersistedNews, recentNews resolves original date (2026-09-17) BEFORE temporal cutoff
  const recBeforeRepair = recentNews(db, horizon30d);
  assert.equal(recBeforeRepair.length, 0, 'stale 2026-09-17 SECO release must not pass 30d cutoff via scrape-dated duplicate');

  // After repairPersistedNews, SQLite consolidates both rows into one with 2026-09-17 and specific URL
  repairPersistedNews(db);
  const allSeco = listNews(db, 10);
  assert.equal(allSeco.length, 1);
  assert.match(allSeco[0].published_at, /^2026-09-17/);
  assert.match(allSeco[0].url, /JUhtHgdQzukb/);

  // 2. Real cross-source verbatim macro duplicate (FinancialJuice + InvestingLive)
  const dePmiRows = dedupeNews([
    {
      title: 'German manufacturing PMI flash actual 49.0 (forecast 49.5, previous 49.1)',
      source: 'InvestingLive',
      source_id: 'investinglive',
      url: 'https://investinglive.com/news/de-pmi',
      published_at: '2026-10-24T07:38:38.000Z',
      actual: '49.0',
      forecast: '49.5',
      previous: '49.1',
      currencies: ['EUR'],
    },
    {
      title: 'GERMAN MANUFACTURING PMI FLASH ACTUAL 49.0 (FORECAST 49.5, PREVIOUS 49.1)',
      source: 'FinancialJuice',
      source_id: 'financialjuice',
      url: 'https://t.me/FinancialJuice/999',
      published_at: '2026-10-24T07:30:11.000Z',
      actual: '49.0',
      forecast: '49.5',
      previous: '49.1',
      currencies: ['EUR'],
    },
  ]);
  assert.equal(dePmiRows.length, 1);
  assert.equal(dePmiRows[0].published_at, '2026-10-24T07:30:11.000Z');

  // 3. Historical commemoration false positive excluded in production enrich + classifyAgent
  const fjSource = SOURCES.find((s) => s.id === 'financialjuice');
  const memorialTitle = 'Chinese media says North Korean leader Kim Jong Un visited Korean War memorial in Dandong';
  assert.equal(isHistoricalCommemoration(memorialTitle), true);
  const enrichedMemorial = enrichRaw({
    title: memorialTitle,
    url: 'https://t.me/FinancialJuice/888',
    body: '',
    published_at: new Date(now - 3600_000).toISOString(),
  }, fjSource);
  assert.notEqual(enrichedMemorial.category, 'geopolitica');
  assert.equal(enrichedMemorial.currencies.length, 0);

  // Even if passed with USD/JPY/CHF to production classifyAgent, historical commemoration scores 0
  const prodRows = classifyAgent([{
    fingerprint: 'mem',
    title: memorialTitle,
    currencies: ['USD', 'JPY', 'CHF'],
    published_at: new Date(now - 3600_000).toISOString(),
    source_type: 'breaking',
    category: 'geopolitica',
  }], now);
  assert.equal(prodRows.find((r) => r.currency === 'USD').score, 0);
  assert.equal(prodRows.find((r) => r.currency === 'JPY').score, 0);
  db.close();
});

test('Case 1: Operational and Shadow Agent evaluate the exact same evidence, and expanded coverage is recorded under a separate contract', () => {
  assert.equal(OP_VERSION, 'mmt-agent-op-v3.1');
  assert.equal(SHADOW_VERSION, 'mmt-rubric-shadow-v2.1-frozen');
  assert.equal(SHADOW_SPEC.empirical, false);
  assert.equal(SHADOW_SPEC.sameEvidenceInvariant, true);
  assert.ok(Object.isFrozen(SHADOW_SPEC));

  const iso1h = new Date(now - 3600_000).toISOString();
  const contractedEvidence = [
    { fingerprint: 'oil1', currencies: ['CAD', 'JPY', 'EUR'], published_at: iso1h, title: 'Oil hits $117 as missile attack in Hormuz sparks war risk', source: 'FJ', source_type: 'breaking', impact: 5, category: 'geopolitica' },
    { fingerprint: 'uk1', currencies: ['GBP'], published_at: iso1h, title: 'UK RETAIL SALES MOM (SEP) ACTUAL -0.4% (FORECAST -0.1%)', actual: '-0.4%', forecast: '-0.1%', source: 'FJ', source_type: 'breaking' },
    { fingerprint: 'uk2', currencies: ['GBP'], published_at: iso1h, title: 'UK CORE RETAIL SALES MOM (SEP) ACTUAL -0.7% (FORECAST -0.1%)', actual: '-0.7%', forecast: '-0.1%', source: 'FJ', source_type: 'breaking' },
    { fingerprint: 'au_pmi', currencies: ['AUD'], published_at: iso1h, title: 'AUSTRALIAN MANUFACTURING PMI FLASH ACTUAL 49.7 (PREVIOUS 49.6)', actual: '49.7', previous: '49.6', source: 'FJ', source_type: 'breaking' },
  ];
  const uncontractedExtra = [
    ...contractedEvidence,
    { fingerprint: 'extra_gbp_uncontracted', currencies: ['GBP'], published_at: iso1h, title: 'UK GDP QOQ ACTUAL 0.6% (FORECAST 0.2%)', actual: '0.6%', forecast: '0.2%', source: 'FJ', source_type: 'breaking' },
  ];

  // Even if extra args are passed or stored items exist, classifyAgentShadow only uses contractedEvidence
  const opRows = attachRanks(classifyAgent(contractedEvidence, now));
  const shRows = classifyAgentShadow(contractedEvidence, now);
  const opMap = new Map(opRows.map((r) => [r.currency, r]));
  const shMap = new Map(shRows.map((s) => [s.currency, s]));

  // Verify exact same evidence fingerprints per currency between Operational and Shadow
  for (const ccy of ['CAD', 'JPY', 'EUR', 'GBP', 'AUD', 'NZD']) {
    const opFps = [...new Set((opMap.get(ccy).ledger || []).map((l) => l.fingerprint))].sort();
    const shFps = [...(shMap.get(ccy).evidenceFingerprints || [])].sort();
    assert.deepEqual(shFps, opFps, `Shadow and Operational must evaluate identical evidence for ${ccy}`);
    assert.ok(!shFps.includes('extra_gbp_uncontracted'));
  }

  // H1-H4 economic rules remain active in shadow mode
  assert.ok(opMap.get('CAD').score < 0);
  assert.ok(shMap.get('CAD').score > 0);
  assert.ok(shMap.get('JPY').score < opMap.get('JPY').score);
  assert.ok(opMap.get('AUD').score > 0);
  assert.equal(shMap.get('AUD').score, 0);
  assert.ok(Math.abs(shMap.get('GBP').score) < Math.abs(opMap.get('GBP').score));

  // Verify H4 preserves country, indicator, period, and components in the cluster
  const gbpCluster = shMap.get('GBP').clusters[0];
  assert.equal(gbpCluster.country, 'UK');
  assert.equal(gbpCluster.indicator, 'RETAIL_SALES');
  assert.equal(gbpCluster.period, 'SEP');
  assert.deepEqual(gbpCluster.components.map((c) => c.component).sort(), ['CORE_MOM', 'MOM']);

  // Expanded coverage is evaluated as a separate experiment with its own contract
  const baseContract = evidenceContract(contractedEvidence, now);
  const expanded = evaluateExpandedCoverageExperiment(uncontractedExtra, now);
  assert.equal(expanded.experimentVersion, EXPANDED_EXPERIMENT_VERSION);
  assert.equal(expanded.contract.version, 'mmt-expanded-coverage-exp-v1');
  assert.notEqual(expanded.contract.evidenceSet, baseContract.evidenceSet);
  assert.equal(expanded.contract.perCurrency.GBP, 3);
  assert.equal(baseContract.perCurrency.GBP, 2);
});

test('Historical Gemini evaluations are preserved in SQLite archive but excluded from active latestEngine', () => {
  const db = openDb(':memory:');
  const t0 = '2026-10-25T04:29:04.262Z';
  const t1 = '2026-10-25T05:00:00.000Z';
  const news = [item('gb', 'GBP')];
  const c0 = {
    ...evidenceContract(news, Date.parse(t0)),
    model: 'gemini-3.8-flash',
    generatedAt: t0,
    evaluatedAt: t0,
    reused: false,
    interpretationMode: 'fresh_llm',
    decayRecalculated: false,
  };
  const gRows = attachRanks(classifyAgent(news, Date.parse(t0))).map((r) => ({ ...r, calibration: c0 }));
  saveScores(db, 'gemini', gRows, 'batch-0', t0, 'Initial regime');
  markGeminiSnapshotReused(db, t0, {
    reused: true,
    reusedFrom: t0,
    reusedAt: t1,
    matchedCycleAsOf: t1,
    interpretationMode: 'reused_llm_interpretation',
    decayRecalculated: false,
  });

  // Active latestEngine only returns 'agente' (Agente MMT), never mixing historical Gemini
  assert.equal(latestEngine(db, 'gemini'), null);
  const archivedRows = db.prepare('SELECT * FROM scores WHERE engine=?').all('gemini');
  assert.equal(archivedRows.length, 8);
  db.close();
});

test('Cases 2 & 3: Outcome temporal anchoring excludes pre-signal movement and T+1/T+3 detects missing business day gaps without substitution', () => {
  assert.equal(DAILY_FIXING_ENTRY_POLICY.sameDayEntryAllowed, false);

  // Conservative policy: Friday and weekend signals anchor to Monday, never the same-day fixing.
  const friMorning = entryFixingDateForSignal('2026-10-23T10:30:00Z');
  assert.equal(friMorning.entry_fixing_date, '2026-10-26');
  assert.equal(friMorning.expected_t1_date, '2026-10-27');
  assert.equal(friMorning.expected_t3_date, '2026-10-29');

  const friEvening = entryFixingDateForSignal('2026-10-23T18:00:00Z');
  assert.equal(friEvening.entry_fixing_date, '2026-10-26');
  assert.equal(friEvening.expected_t1_date, '2026-10-27');
  assert.equal(friEvening.expected_t3_date, '2026-10-29');

  const sunSignal = entryFixingDateForSignal('2026-10-25T08:05:00Z');
  assert.equal(sunSignal.entry_fixing_date, '2026-10-26');
  assert.equal(sunSignal.expected_t1_date, '2026-10-27');
  assert.equal(sunSignal.expected_t3_date, '2026-10-29');

  const db = openDb(':memory:');
  // Friday 2026-10-23 fixing (pre-signal for a Sunday signal)
  saveMarketSnapshot(db, {
    updated_at: '2026-10-25T08:00:00Z',
    reference_date: '2026-10-23',
    prev_reference_date: '2026-10-22',
    source: 'ecb_frankfurter_daily',
    basketPct: { GBP: -0.2 },
    pairs: { 'GBP/USD': { rate: 1.3000, changePct: -0.2 } },
  }, '2026-10-25T08:00:00Z');

  // Log a Sunday 2026-10-25 signal
  saveCalibrationLog(db, [{
    snapshot_at: '2026-10-25T08:05:00Z',
    evidence_set: 'ev1',
    as_of: '2026-10-25T08:05:00Z',
    currency: 'GBP',
    is_new_contract: true,
    currency_evidence_hash: currencyEvidenceHash([item('gb', 'GBP')], 'GBP'),
    is_new_currency_event: true,
    transition_type: 'new_event',
    op_agent_score: -20,
    op_agent_bias: 'bajista',
    shadow_agent_score: -18,
    shadow_agent_bias: 'bajista',
    gemini_score: -30,
    gemini_bias: 'bajista',
    discrepancy_op_vs_gemini: 10,
    discrepancy_shadow_vs_gemini: 12,
    ecb_base_date: '2026-10-23',
  }]);

  let logRow = db.prepare('SELECT * FROM calibration_log WHERE currency=?').get('GBP');
  assert.equal(logRow.prior_fixing_date, '2026-10-23', 'Friday fixing is recorded strictly as prior_fixing_date');
  assert.equal(logRow.entry_fixing_date, '2026-10-26', 'Entry fixing T0 for Sunday signal must be Monday 2026-10-26');
  assert.equal(logRow.expected_t1_date, '2026-10-27');
  assert.equal(logRow.expected_t3_date, '2026-10-29');
  assert.equal(logRow.outcome_t1_date, null);
  assert.equal(logRow.horizon_status, 'pending_entry_fixing');

  // Monday 2026-10-26 fixing arrives (rate moved from 1.3000 on Friday to 1.2870 on Monday)
  // This Friday->Monday move MUST NOT be counted as T+1 predictive return for the Sunday signal!
  saveMarketSnapshot(db, {
    updated_at: '2026-10-26T16:05:00Z',
    reference_date: '2026-10-26',
    prev_reference_date: '2026-10-23',
    source: 'ecb_frankfurter_daily',
    basketPct: { GBP: -1.0 },
    pairs: { 'GBP/USD': { rate: 1.2870, changePct: -1.0 } },
  }, '2026-10-26T16:05:00Z');

  logRow = db.prepare('SELECT * FROM calibration_log WHERE currency=?').get('GBP');
  assert.equal(logRow.outcome_t1_date, null, 'Monday 2026-10-26 is T0 entry_fixing_date, NOT T+1 outcome');
  assert.equal(logRow.outcome_t1_basket_pct, null);
  assert.equal(logRow.horizon_status, 'anchored_entry_pending_t1');

  // Case 3: Simulate a missing business day gap! Suppose Tuesday 2026-10-27 is missing and Wednesday 2026-10-28 arrives.
  // System MUST NOT silently substitute 2026-10-28 as T+1; it must flag gap_t1_missing and record ['2026-10-27'].
  saveMarketSnapshot(db, {
    updated_at: '2026-10-28T16:05:00Z',
    reference_date: '2026-10-28',
    prev_reference_date: '2026-10-26',
    source: 'ecb_frankfurter_daily',
    basketPct: { GBP: -0.5 },
    pairs: { 'GBP/USD': { rate: 1.27413, changePct: -1.0 } },
  }, '2026-10-28T16:05:00Z');

  logRow = db.prepare('SELECT * FROM calibration_log WHERE currency=?').get('GBP');
  assert.equal(logRow.outcome_t1_date, null, 'must never substitute 2026-10-28 when expected T+1 (2026-10-27) is missing');
  assert.equal(logRow.outcome_t1_basket_pct, null);
  assert.equal(logRow.horizon_status, 'gap_t1_missing');
  assert.deepEqual(JSON.parse(logRow.gap_dates_json), ['2026-10-27']);

  // Now suppose Tuesday 2026-10-27 and Thursday 2026-10-29 fixings are backfilled
  saveMarketSnapshot(db, {
    updated_at: '2026-10-28T16:10:00Z',
    reference_date: '2026-10-27',
    prev_reference_date: '2026-10-26',
    source: 'ecb_frankfurter_daily',
    basketPct: { GBP: -0.5 },
    pairs: { 'GBP/USD': { rate: 1.27413, changePct: -1.0 } },
  }, '2026-10-28T16:10:00Z');
  saveMarketSnapshot(db, {
    updated_at: '2026-10-29T16:05:00Z',
    reference_date: '2026-10-29',
    prev_reference_date: '2026-10-28',
    source: 'ecb_frankfurter_daily',
    basketPct: { GBP: -0.5 },
    pairs: { 'GBP/USD': { rate: 1.26126, changePct: -1.0 } },
  }, '2026-10-29T16:05:00Z');

  logRow = db.prepare('SELECT * FROM calibration_log WHERE currency=?').get('GBP');
  assert.equal(logRow.outcome_t1_date, '2026-10-27');
  assert.equal(logRow.outcome_t1_basket_pct, -1.0); // 1.27413 / 1.2870 - 1 = -1.0% (strictly post-T0!)
  assert.equal(logRow.outcome_t3_date, '2026-10-29');
  assert.equal(logRow.outcome_t3_basket_pct, -2.0); // 1.26126 / 1.2870 - 1 = -2.0%
  assert.equal(logRow.horizon_status, 'complete_t1_t3');
  assert.deepEqual(JSON.parse(logRow.gap_dates_json), []);
  db.close();
});

test('Case 4: Active attacks at memorials, museums, or anniversaries are protected and never discarded as historical commemorations', () => {
  const fjSource = SOURCES.find((s) => s.id === 'financialjuice');
  const activeIncidentTitles = [
    'Breaking: Terror attack and explosion reported at war memorial in Jerusalem',
    'Missile strike hits near national museum on war anniversary, casualties reported',
    'Armed gunmen open fire at remembrance monument, police order lockdown',
    'Drone bomb blast targets military cemetery ceremony in Riyadh',
  ];

  for (const title of activeIncidentTitles) {
    assert.equal(isHistoricalCommemoration(title), false, `Active attack must not be flagged as historical commemoration: ${title}`);
    const enriched = enrichRaw({
      title,
      url: 'https://t.me/FinancialJuice/1001',
      body: '',
      published_at: new Date(now - 1800_000).toISOString(),
    }, fjSource);
    assert.equal(enriched.category, 'geopolitica', `Active attack must be categorized as geopolitica: ${title}`);
    assert.ok(enriched.currencies.includes('USD') && enriched.currencies.includes('JPY') && enriched.currencies.includes('CHF'));
  }

  // Verify classifyAgent scores the active memorial attack in RISK_GEO
  const rows = classifyAgent([{
    fingerprint: 'mem-attack',
    title: activeIncidentTitles[0],
    currencies: ['USD', 'JPY', 'CHF'],
    published_at: new Date(now - 1800_000).toISOString(),
    source_type: 'breaking',
    category: 'geopolitica',
    impact: 5,
  }], now);
  assert.ok(rows.find((r) => r.currency === 'USD').score > 0);
  assert.ok(rows.find((r) => r.currency === 'JPY').score > 0);
});

test('Case 5: Deduplication merges same-release duplicates while preserving publications from different periods, components, or countries', () => {
  // Different explicit periods (Sep vs Oct, Q2 vs Q3) with identical source/numbers must NEVER be collapsed
  const sepCpi = {
    title: 'US CPI YoY (Sep) actual 2.4% vs 2.4% expected',
    source: 'FinancialJuice',
    source_id: 'financialjuice',
    url: 'https://t.me/FinancialJuice/2001',
    published_at: '2026-10-10T12:30:00Z',
    actual: '2.4%',
    forecast: '2.4%',
    currencies: ['USD'],
  };
  const octCpi = {
    title: 'US CPI YoY (Oct) actual 2.4% vs 2.4% expected',
    source: 'FinancialJuice',
    source_id: 'financialjuice',
    url: 'https://t.me/FinancialJuice/2050',
    published_at: '2026-10-24T12:30:00Z',
    actual: '2.4%',
    forecast: '2.4%',
    currencies: ['USD'],
  };
  assert.equal(isSameReleaseDuplicate(sepCpi, octCpi), false);

  // Weekly releases 7 days apart without explicit month in title must NEVER be collapsed
  const claimsWeek1 = {
    title: 'US Initial Jobless Claims actual 215K vs 215K expected',
    source: 'FinancialJuice',
    source_id: 'financialjuice',
    url: 'https://t.me/FinancialJuice/3001',
    published_at: '2026-10-15T12:30:00Z',
    actual: '215K',
    forecast: '215K',
    currencies: ['USD'],
  };
  const claimsWeek2 = {
    title: 'US Initial Jobless Claims actual 215K vs 215K expected',
    source: 'FinancialJuice',
    source_id: 'financialjuice',
    url: 'https://t.me/FinancialJuice/3099',
    published_at: '2026-10-22T12:30:00Z',
    actual: '215K',
    forecast: '215K',
    currencies: ['USD'],
  };
  assert.equal(isSameReleaseDuplicate(claimsWeek1, claimsWeek2), false);

  // Different components (MoM vs Core MoM vs YoY) published at the exact same minute must NEVER be collapsed
  const ukMom = {
    title: 'UK Retail Sales MoM (Sep) actual 0.3% vs 0.3% expected',
    source: 'FinancialJuice',
    url: 'https://t.me/FinancialJuice/4001',
    published_at: '2026-10-24T06:00:00Z',
    actual: '0.3%',
    forecast: '0.3%',
    currencies: ['GBP'],
  };
  const ukCoreMom = {
    title: 'UK Core Retail Sales MoM (Sep) actual 0.3% vs 0.3% expected',
    source: 'FinancialJuice',
    url: 'https://t.me/FinancialJuice/4002',
    published_at: '2026-10-24T06:00:00Z',
    actual: '0.3%',
    forecast: '0.3%',
    currencies: ['GBP'],
  };
  assert.equal(isSameReleaseDuplicate(ukMom, ukCoreMom), false);

  // Same-release duplicate (same day, same indicator/component/period) IS merged
  const sepCpiDup = {
    title: 'US CPI YoY (Sep) actual 2.4% vs 2.4% expected',
    source: 'InvestingLive',
    source_id: 'investinglive',
    url: 'https://investinglive.com/news/us-cpi-sep-20261010',
    published_at: '2026-10-10T12:32:00Z',
    actual: '2.4%',
    forecast: '2.4%',
    currencies: ['USD'],
  };
  assert.equal(isSameReleaseDuplicate(sepCpi, sepCpiDup), true);

  const deduped = dedupeNews([sepCpi, sepCpiDup, octCpi, claimsWeek1, claimsWeek2, ukMom, ukCoreMom]);
  assert.equal(deduped.length, 6);
  const metaOct = extractReleaseIdentity(octCpi);
  assert.deepEqual(metaOct, {
    country: 'US',
    indicator: 'CPI',
    component: 'YOY',
    period: 'OCT',
    explicitPeriod: 'OCT',
  });
});

test('Case 6: Currency transitions separate new_event, revision, expiration, and selection_change, and historical rows are marked ineligible', () => {
  const itemA = {
    fingerprint: 'us_cpi_sep_prelim',
    title: 'US CPI YoY (Sep) actual 2.4% vs 2.3% expected',
    published_at: '2026-10-24T12:30:00Z',
    actual: '2.4%',
    forecast: '2.3%',
    currencies: ['USD'],
  };
  const itemB = {
    fingerprint: 'us_claims_w1',
    title: 'US Initial Jobless Claims actual 210K vs 220K expected',
    published_at: '2026-10-24T12:30:00Z',
    actual: '210K',
    forecast: '220K',
    currencies: ['USD'],
  };

  // 1. Initial baseline
  const t0 = classifyCurrencyTransition(null, [itemA, itemB], [itemA, itemB]);
  assert.equal(t0.transitionType, 'initial_baseline');
  assert.equal(t0.isNewEvent, false);

  // 2. Unchanged evidence (only time decay recalculated)
  const t1 = classifyCurrencyTransition(t0.nextState, [itemA, itemB], [itemA, itemB]);
  assert.equal(t1.transitionType, 'unchanged_decay_only');
  assert.equal(t1.isNewEvent, false);

  // 3. Selection change: itemB rotated out of the 80-item cap, but is still in allEligibleCurrencyItems
  const t2 = classifyCurrencyTransition(t1.nextState, [itemA], [itemA, itemB]);
  assert.equal(t2.transitionType, 'selection_change');
  assert.equal(t2.isNewEvent, false);

  // 4. Selection change: itemB rotated back into the 80-item cap
  const t3 = classifyCurrencyTransition(t2.nextState, [itemA, itemB], [itemA, itemB]);
  assert.equal(t3.transitionType, 'selection_change');
  assert.equal(t3.isNewEvent, false);

  // 5. Expiration: itemB aged out of the temporal window (not in allEligibleCurrencyItems)
  const t4 = classifyCurrencyTransition(t3.nextState, [itemA], [itemA]);
  assert.equal(t4.transitionType, 'expiration');
  assert.equal(t4.isNewEvent, false);

  // 6. Revision: revised figure for the same releaseKey (US|CPI|YOY|SEP)
  const itemARevised = {
    fingerprint: 'us_cpi_sep_revised',
    title: 'US CPI YoY (Sep) revised actual 2.5% vs 2.3% expected',
    published_at: '2026-10-25T12:30:00Z',
    actual: '2.5%',
    forecast: '2.3%',
    currencies: ['USD'],
  };
  const t5 = classifyCurrencyTransition(t4.nextState, [itemARevised], [itemARevised]);
  assert.equal(t5.transitionType, 'revision');
  assert.equal(t5.isNewEvent, false);

  // 7. Genuine new event: October CPI arrives
  const itemOct = {
    fingerprint: 'us_cpi_oct_1',
    title: 'US CPI YoY (Oct) actual 2.6% vs 2.4% expected',
    published_at: '2026-10-25T13:30:00Z',
    actual: '2.6%',
    forecast: '2.4%',
    currencies: ['USD'],
  };
  const t6 = classifyCurrencyTransition(t5.nextState, [itemARevised, itemOct], [itemARevised, itemOct]);
  assert.equal(t6.transitionType, 'new_event');
  assert.equal(t6.isNewEvent, true);

  // Verify evaluateInterEngineDiscrepancy excludes ineligible historical rows and non-event transitions
  const disc = evaluateInterEngineDiscrepancy([
    { snapshotAt: 's0', evidenceSet: 'ev0', currency: 'USD', currencyEvidenceHash: 'h0', transitionType: 'new_event', eligible_for_calibration: 0, agentScore: 20, geminiScore: 40 },
    { snapshotAt: 's1', evidenceSet: 'ev1', currency: 'USD', currencyEvidenceHash: 'h1', transitionType: 'initial_baseline', eligible_for_calibration: 1, agentScore: 25, geminiScore: 35 },
    { snapshotAt: 's2', evidenceSet: 'ev2', currency: 'USD', currencyEvidenceHash: 'h2', transitionType: 'selection_change', eligible_for_calibration: 1, agentScore: 15, geminiScore: 35 },
    { snapshotAt: 's3', evidenceSet: 'ev3', currency: 'USD', currencyEvidenceHash: 'h3', transitionType: 'expiration', eligible_for_calibration: 1, agentScore: 10, geminiScore: 30 },
    { snapshotAt: 's4', evidenceSet: 'ev4', currency: 'USD', currencyEvidenceHash: 'h4', transitionType: 'revision', eligible_for_calibration: 1, agentScore: 28, geminiScore: 34 },
  ]);
  assert.equal(disc.ineligibleHistoricalObservations, 1);
  assert.equal(disc.nonEventTransitionObservations, 4);
  assert.equal(disc.byUniqueContract.comparableWithEvidenceCount, 4);
  assert.equal(disc.byUniqueCurrencyEvent.comparableWithEvidenceCount, 0); // A baseline is not a newly observed economic event

  // Verify markHistoricalEvaluationsIneligible marks pre-v3 SQLite records as ineligible while preserving them
  const db = openDb(':memory:');
  db.prepare(`INSERT INTO calibration_log (snapshot_at, evidence_set, currency, op_version, shadow_version, eligible_for_calibration)
    VALUES ('2026-10-25T10:00:00Z', 'old_ev', 'GBP', 'mmt-agent-op-v2', 'mmt-rubric-shadow-v1-frozen', 1)`).run();
  saveCalibrationLog(db, [{
    snapshot_at: '2026-10-25T11:30:00Z',
    evidence_set: 'new_ev',
    currency: 'GBP',
    op_version: OP_VERSION,
    shadow_version: SHADOW_VERSION,
    is_new_contract: true,
    is_new_currency_event: true,
    transition_type: 'new_event',
  }]);
  const marked = markHistoricalEvaluationsIneligible(db);
  assert.equal(marked, 1);
  const allRows = db.prepare('SELECT * FROM calibration_log ORDER BY id ASC').all();
  assert.equal(allRows.length, 2, 'historical records must be preserved');
  assert.equal(allRows[0].eligible_for_calibration, 0);
  assert.match(allRows[0].ineligible_reason, /pre_v4_methodology/);
  assert.equal(allRows[1].eligible_for_calibration, 1);
  assert.equal(allRows[1].code_hash, computeCodeHash());
  assert.match(computeCodeHash(), /^[0-9a-f]{64}$/);
  db.close();
});

