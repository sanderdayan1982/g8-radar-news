import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CURRENCIES, BIAS_THRESHOLD } from './config.js';
import { biasFor } from './classifyCurrencies.js';
import { extractReleaseIdentity } from './enrich.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export { DAILY_FIXING_ENTRY_POLICY, isBusinessDayIso, addBusinessDays, businessDaysBetween, entryFixingDateForSignal } from './fixingCalendar.js';
import { DAILY_FIXING_ENTRY_POLICY } from './fixingCalendar.js';

/**
 * Computes a deterministic hash of the news subset assigned to a single currency.
 */
export function currencyEvidenceHash(news, currency) {
  const mine = (news || [])
    .filter((n) => (n.currencies || []).includes(currency))
    .map((n) => ({
      fp: n.fingerprint || '',
      pub: n.published_at || '',
      title: (n.title || '').trim().toLowerCase(),
      actual: n.actual ?? null,
      forecast: n.forecast ?? null,
      previous: n.previous ?? null,
    }))
    .sort((a, b) => a.fp.localeCompare(b.fp) || a.pub.localeCompare(b.pub));
  if (!mine.length) return 'no_evidence';
  return createHash('sha256').update(JSON.stringify(mine)).digest('hex');
}

function itemReleaseSignature(item) {
  const meta = item.release_meta || extractReleaseIdentity(item);
  return {
    fp: item.fingerprint || '',
    title: (item.title || '').trim(),
    published_at: item.published_at || '',
    actual: item.actual ?? null,
    forecast: item.forecast ?? null,
    previous: item.previous ?? null,
    releaseKey: `${meta.country}|${meta.indicator}|${meta.component}|${meta.period}`,
    indicator: meta.indicator,
  };
}

/**
 * Separates currency evidence transitions into:
 * - 'initial_baseline': first observed state; not counted as a new event
 * - 'new_event': at least one genuinely new economic event not previously seen and not a revision
 * - 'revision': an update/revision including a retained fingerprint (country/indicator/component/period)
 * - 'expiration': items aged out of the window without any new items added
 * - 'selection_change': items rotated in/out due to the 80-item selection cap while already in window
 * - 'unchanged_decay_only': exact same currency evidence hash (only time decay changed)
 * - 'no_evidence': no active items and none previously active
 */
export function classifyCurrencyTransition(prevState, currItems = [], allEligibleCurrencyItems = currItems, asOf = null) {
  const current = currItems.map(itemReleaseSignature);
  const eligible = allEligibleCurrencyItems.map(itemReleaseSignature);
  const previousActive = prevState?.activeItems || [];
  const previousEligible = prevState?.eligibleItems || previousActive;
  const byFp = rows => new Map(rows.map(r => [r.fp, r]));
  const oldByFp = byFp(previousEligible);
  for (const r of previousActive) if (!oldByFp.has(r.fp)) oldByFp.set(r.fp, r);
  const activeByFp = byFp(previousActive);
  const eligibleByFp = byFp(eligible);
  const seen = new Set(prevState?.seenFingerprints || previousEligible.map(r => r.fp));
  const releases = { ...(prevState?.seenReleases || {}) };
  const values = r => JSON.stringify([r.actual ?? null, r.forecast ?? null, r.previous ?? null]);
  const counts = { new_event: 0, revision: 0, expiration: 0, selection_change: 0, late_arrival: 0 };
  const newEventFingerprints = [];
  const revisionFingerprints = [];
  const previousCutoff = Date.parse(prevState?.asOf);
  const initialized = !!prevState?.initialized;
  // The caller scopes items by currency; compute directly so multi-currency items cannot change the key.
  const stableHash = rows => rows.length ? createHash('sha256').update(JSON.stringify(rows.map(r => ({
    fp: r.fp, pub: r.published_at, title: r.title.toLowerCase(), actual: r.actual, forecast: r.forecast, previous: r.previous,
  })).sort((a,b) => a.fp.localeCompare(b.fp) || a.pub.localeCompare(b.pub)))).digest('hex') : 'no_evidence';

  for (const s of previousEligible) {
    if (s.indicator !== 'GENERAL' && !releases[s.releaseKey]) releases[s.releaseKey] = s;
  }
  if (initialized) {
    for (const s of current) {
      const previous = oldByFp.get(s.fp);
      const previousRelease = s.indicator !== 'GENERAL' ? releases[s.releaseKey] : null;
      if (previous && values(previous) !== values(s)) {
        counts.revision++; revisionFingerprints.push(s.fp);
      } else if (activeByFp.has(s.fp)) {
        // No observation change for a retained item.
      } else if (previous || seen.has(s.fp)) {
        counts.selection_change++;
      } else if (previousRelease) {
        if (values(previousRelease) !== values(s) || /\b(revis(?:ed|ion)|final|second estimate|third estimate)\b/i.test(s.title)) {
          counts.revision++; revisionFingerprints.push(s.fp);
        } else counts.selection_change++;
      } else if (Number.isFinite(previousCutoff) && Date.parse(s.published_at) <= previousCutoff) {
        counts.late_arrival++;
      } else {
        counts.new_event++; newEventFingerprints.push(s.fp);
      }
    }
    const currentByFp = byFp(current);
    for (const s of previousActive) {
      if (!currentByFp.has(s.fp)) {
        if (eligibleByFp.has(s.fp)) counts.selection_change++;
        else counts.expiration++;
      }
    }
  }

  let transitionType;
  if (!initialized) transitionType = current.length ? 'initial_baseline' : 'no_evidence';
  else transitionType = ['new_event', 'revision', 'late_arrival', 'selection_change', 'expiration'].find(k => counts[k])
    || (current.length ? 'unchanged_decay_only' : 'no_evidence');

  // Observe the ENTIRE eligible window, including items outside the selection cap.
  // Keep observations of old releases for identifying later revisions/duplicates.
  for (const s of [...eligible, ...current]) {
    seen.add(s.fp);
    if (s.indicator !== 'GENERAL') releases[s.releaseKey] = s;
  }
  return {
    transitionType,
    isNewEvent: counts.new_event > 0,
    currencyEvidenceHash: stableHash(current),
    addedCount: current.filter(s => !activeByFp.has(s.fp)).length,
    removedCount: previousActive.filter(s => !current.some(c => c.fp === s.fp)).length,
    transitionCounts: counts,
    newEventFingerprints,
    revisionFingerprints,
    nextState: {
      schemaVersion: 4, initialized: true, lastHash: stableHash(current),
      asOf: asOf || prevState?.asOf || null,
      activeItems: current, eligibleItems: eligible,
      seenFingerprints: [...seen], seenReleases: releases,
    },
  };
}

function directionSign(score, threshold = BIAS_THRESHOLD) {
  if (score > threshold) return 1;
  if (score < -threshold) return -1;
  return 0;
}

/**
 * Evaluates Inter-Engine Discrepancy (Discrepancia entre motores) between an Agent series
 * (operational or shadow) and Gemini.
 *
 * Excludes historical rows marked `eligible_for_calibration === 0` or `eligible === false`,
 * and counts only genuine new events (`transition_type === 'new_event'`)
 * in `byUniqueCurrencyEvent`; initial baselines are excluded.
 */
export function evaluateInterEngineDiscrepancy(observations, threshold = BIAS_THRESHOLD) {
  const seenContracts = new Set();
  const seenCurrencyEvents = new Set();

  let totalRawObservations = 0;
  let ineligibleHistoricalObservations = 0;
  let repeatedCycleObservations = 0;
  let nonEventTransitionObservations = 0;
  let excludedNoEvidenceCount = 0;
  let soloAgentCount = 0;
  let soloGeminiCount = 0;

  const uniqueContractPairs = [];
  const uniqueCurrencyEventPairs = [];

  for (const obs of observations || []) {
    totalRawObservations += 1;
    if (obs.eligible === false || obs.eligible_for_calibration === 0) {
      ineligibleHistoricalObservations += 1;
      continue;
    }
    const isReused = !!obs.geminiReused;
    const contractKey = `${obs.evidenceSet || obs.snapshotAt}|${obs.currency}`;
    const isRepeatContract = isReused || seenContracts.has(contractKey);
    if (isRepeatContract) {
      repeatedCycleObservations += 1;
      continue;
    }
    seenContracts.add(contractKey);

    const agNoEv = obs.agentNoEvidence ?? (obs.agentScore == null);
    const gmNoEv = obs.geminiNoEvidence ?? (obs.geminiScore == null);

    if (agNoEv && gmNoEv) {
      excludedNoEvidenceCount += 1;
      continue;
    }
    if (!agNoEv && gmNoEv) {
      excludedNoEvidenceCount += 1;
      soloAgentCount += 1;
      continue;
    }
    if (agNoEv && !gmNoEv) {
      excludedNoEvidenceCount += 1;
      soloGeminiCount += 1;
      continue;
    }

    const diff = obs.agentScore - obs.geminiScore;
    const absDiff = Math.abs(diff);
    const agDir = directionSign(obs.agentScore, threshold);
    const gmDir = directionSign(obs.geminiScore, threshold);
    const conflict = agDir !== 0 && gmDir !== 0 && agDir !== gmDir;
    const sameBias = biasFor(obs.agentScore, threshold) === biasFor(obs.geminiScore, threshold);
    const transitionType = obs.transitionType || obs.transition_type || null;

    const pair = {
      currency: obs.currency,
      evidenceSet: obs.evidenceSet,
      currencyEvidenceHash: obs.currencyEvidenceHash,
      transitionType,
      agentScore: obs.agentScore,
      geminiScore: obs.geminiScore,
      discrepancy: diff,
      absDiscrepancy: absDiff,
      conflict,
      sameBias,
    };
    uniqueContractPairs.push(pair);

    const isGenuineNewEvent = transitionType
      ? transitionType === 'new_event'
      : (obs.isNewCurrencyEvent !== false);

    if (!isGenuineNewEvent) {
      nonEventTransitionObservations += 1;
      continue;
    }

    const ccyEventKey = `${obs.currency}|${obs.currencyEvidenceHash || obs.evidenceSet || obs.snapshotAt}`;
    if (!seenCurrencyEvents.has(ccyEventKey)) {
      seenCurrencyEvents.add(ccyEventKey);
      uniqueCurrencyEventPairs.push(pair);
    }
  }

  const summarize = (pairs) => {
    if (!pairs.length) {
      return {
        comparableWithEvidenceCount: 0,
        meanAbsDiscrepancy: null,
        medianAbsDiscrepancy: null,
        biasAgreementRate: null,
        conflictCount: 0,
        conflictRate: null,
      };
    }
    const sortedAbs = pairs.map((p) => p.absDiscrepancy).sort((a, b) => a - b);
    const meanAbs = Math.round((sortedAbs.reduce((s, v) => s + v, 0) / pairs.length) * 100) / 100;
    const mid = Math.floor(sortedAbs.length / 2);
    const medianAbs = sortedAbs.length % 2 === 1
      ? sortedAbs[mid]
      : Math.round(((sortedAbs[mid - 1] + sortedAbs[mid]) / 2) * 100) / 100;
    const agree = pairs.filter((p) => p.sameBias).length;
    const conflicts = pairs.filter((p) => p.conflict).length;
    return {
      comparableWithEvidenceCount: pairs.length,
      meanAbsDiscrepancy: meanAbs,
      medianAbsDiscrepancy: medianAbs,
      biasAgreementRate: Math.round((agree / pairs.length) * 1000) / 1000,
      conflictCount: conflicts,
      conflictRate: Math.round((conflicts / pairs.length) * 1000) / 1000,
    };
  };

  return {
    metricType: 'discrepancia_entre_motores',
    geminiIsGroundTruth: false,
    totalRawObservations,
    ineligibleHistoricalObservations,
    repeatedCycleObservations,
    nonEventTransitionObservations,
    excludedNoEvidenceCount,
    soloAgentCount,
    soloGeminiCount,
    byUniqueContract: summarize(uniqueContractPairs),
    byUniqueCurrencyEvent: summarize(uniqueCurrencyEventPairs),
  };
}

/**
 * Evaluates alignment against daily ECB/Frankfurter reference rates.
 * Enforces `entry_fixing_date >= signal` (no pre-signal price changes) and detects missing business day gaps.
 */
export function evaluateDailyFxAlignment(marketSnapshots, calibrationEntries) {
  const uniqueDates = [...new Set((marketSnapshots || []).map((m) => m.reference_date).filter(Boolean))].sort();
  const intradayValidationAvailable = false;

  const eligibleEntries = (calibrationEntries || []).filter(
    (e) => (e.eligible_for_calibration == null || e.eligible_for_calibration === 1),
  );

  const evaluatedT1 = eligibleEntries.filter(
    (e) => e.is_new_currency_event &&
      e.entry_fixing_date &&
      e.outcome_t1_date &&
      e.outcome_t1_date === e.expected_t1_date &&
      e.outcome_t1_date > e.entry_fixing_date &&
      e.op_agent_score != null &&
      e.outcome_t1_basket_pct != null,
  );
  const evaluatedT3 = eligibleEntries.filter(
    (e) => e.is_new_currency_event &&
      e.entry_fixing_date &&
      e.outcome_t3_date &&
      e.outcome_t3_date === e.expected_t3_date &&
      e.outcome_t3_date > e.entry_fixing_date &&
      e.op_agent_score != null &&
      e.outcome_t3_basket_pct != null,
  );
  const gapDetectedCount = eligibleEntries.filter(
    (e) => typeof e.horizon_status === 'string' && e.horizon_status.startsWith('gap_'),
  ).length;

  return {
    priceSource: 'ecb_frankfurter_daily',
    intradayValidationAvailable,
    entryPolicy: DAILY_FIXING_ENTRY_POLICY,
    distinctEcbFixingDates: uniqueDates,
    distinctEcbFixingCount: uniqueDates.length,
    gapDetectedCount,
    maturedDailyHorizons: {
      tPlus1BusinessDayCount: evaluatedT1.length,
      tPlus3BusinessDaysCount: evaluatedT3.length,
    },
  };
}

const ACTIVE_CODE_FILES = [
  'fixingCalendar.js',
  'server.js',
  'config.js',
  'enrich.js',
  'evidence.js',
  'classifyCurrencies.js',
  '../public/app.js',
  '../package-lock.json',
  'shadowCalibration.js',
  'calibrationEval.js',
  'db.js',
  'refreshFeed.js',
  'market.js',
];

let cachedCodeHash = null;

export function computeCodeHash() {
  if (cachedCodeHash) return cachedCodeHash;
  const h = createHash('sha256');
  for (const f of ACTIVE_CODE_FILES) {
    try {
      const content = readFileSync(join(__dirname, f), 'utf8').replace(/\r\n/g, '\n');
      h.update(`=== ${f} ===\n${content}\n`);
    } catch {
      h.update(`=== ${f}:missing ===\n`);
    }
  }
  cachedCodeHash = h.digest('hex');
  return cachedCodeHash;
}
