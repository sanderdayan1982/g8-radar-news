import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyCurrencyTransition, currencyEvidenceHash, evaluateInterEngineDiscrepancy, computeCodeHash } from '../src/calibrationEval.js';
import { isBusinessDayIso, addBusinessDays, businessDaysBetween, entryFixingDateForSignal, signalLocalDate } from '../src/fixingCalendar.js';
import { openDb, saveMarketSnapshot, saveCalibrationLog, markHistoricalEvaluationsIneligible, computeDailyBasketReturn } from '../src/db.js';

const item = (fp, extra = {}) => ({ fingerprint: fp, title: `US GDP growth ${fp}`, currencies: ['USD'], published_at: '2026-10-25T10:00:00Z', actual: '2', forecast: '1', previous: '1', ...extra });
const t0 = '2026-10-25T11:00:00Z', t1 = '2026-10-25T12:00:00Z';

for (const field of ['actual', 'forecast', 'previous']) {
  test(`revision of ${field} on the same fingerprint is not decay or a new event`, () => {
    const a = item('a');
    const state = classifyCurrencyTransition(null, [a], [a], t0).nextState;
    const revised = { ...a, [field]: '3' };
    const change = classifyCurrencyTransition(state, [revised], [revised], t1);
    assert.equal(change.transitionType, 'revision');
    assert.equal(change.transitionCounts.revision, 1);
    assert.equal(change.isNewEvent, false);
    assert.notEqual(currencyEvidenceHash([a], 'USD'), currencyEvidenceHash([revised], 'USD'));
  });
}

test('first entry of previously unselected eligible news is a selection change', () => {
  const a = item('a'), b = item('b');
  const state = classifyCurrencyTransition(null, [a], [a,b], t0).nextState;
  const change = classifyCurrencyTransition(JSON.parse(JSON.stringify(state)), [a,b], [a,b], t1);
  assert.equal(change.transitionType, 'selection_change');
  assert.equal(change.isNewEvent, false);
});

test('state survives restart; late arrivals, expiration and new publications remain distinct', () => {
  const a = item('a');
  let state = classifyCurrencyTransition(null, [a], [a], t0).nextState;
  const late = item('late', { title: 'US PMI flash', published_at: '2026-10-25T09:00:00Z' });
  const delayed = classifyCurrencyTransition(state, [a,late], [a,late], t1);
  assert.equal(delayed.transitionType, 'late_arrival');
  assert.equal(delayed.isNewEvent, false);
  state = JSON.parse(JSON.stringify(delayed.nextState));
  const fresh = item('fresh', { title: 'US employment report', published_at: '2026-10-25T12:05:00Z' });
  const change = classifyCurrencyTransition(state, [a,fresh], [a,fresh], '2026-10-25T12:10:00Z');
  assert.equal(change.transitionType, 'new_event');
  assert.equal(change.transitionCounts.new_event, 1);
  assert.equal(change.transitionCounts.expiration, 1);
  assert.deepEqual(change.newEventFingerprints, ['fresh']);
});

test('initial baseline and a corpus of repeated old news do not create new economic events', () => {
  const a = item('a');
  const initial = classifyCurrencyTransition(null, [a], [a], t0);
  assert.equal(initial.isNewEvent, false);
  const again = classifyCurrencyTransition(initial.nextState, [a], [a], t1);
  assert.equal(again.transitionType, 'unchanged_decay_only');
  const result = evaluateInterEngineDiscrepancy([{ snapshotAt:t0, currency:'USD', evidenceSet:'x', transitionType:'initial_baseline', agentScore:20, geminiScore:30 }]);
  assert.equal(result.byUniqueCurrencyEvent.comparableWithEvidenceCount, 0);
});

test('TARGET fixed holidays and Easter closures are excluded, but other ECB staff holidays are not', () => {
  for (const day of ['2026-01-01','2026-04-03','2026-04-06','2026-05-01','2026-12-25','2026-12-26','2027-03-26','2027-03-29','2028-04-14','2028-04-17']) assert.equal(isBusinessDayIso(day),false,day);
  assert.equal(isBusinessDayIso('2026-12-24'),true);
  assert.equal(addBusinessDays('2026-12-24',1),'2026-12-28');
  assert.equal(addBusinessDays('2026-12-24',3),'2026-12-30');
  assert.equal(addBusinessDays('2026-04-02',1),'2026-04-07');
  assert.deepEqual(businessDaysBetween('2026-04-02','2026-04-07'),['2026-04-02','2026-04-07']);
});

test('signals before, between and after price formation/publication use the next reference day', () => {
  for (const time of ['00:01','10:00','12:30','13:45','14:30','16:30','20:00']) {
    assert.equal(entryFixingDateForSignal(`2026-10-26T${time}:00Z`).entry_fixing_date,'2026-10-27');
  }
  assert.deepEqual(entryFixingDateForSignal('2026-10-25T12:00:00Z'),{entry_fixing_date:'2026-10-26',expected_t1_date:'2026-10-27',expected_t3_date:'2026-10-29'});
  assert.equal(entryFixingDateForSignal('2026-12-25T10:00:00Z').entry_fixing_date,'2026-12-28');
});

test('Frankfurt local day handles DST and UTC date boundaries without fixed UTC hours', () => {
  assert.equal(signalLocalDate('2026-07-06T22:30:00Z'),'2026-07-07');
  assert.equal(entryFixingDateForSignal('2026-07-06T22:30:00Z').entry_fixing_date,'2026-07-08');
  assert.equal(signalLocalDate('2026-10-26T23:30:00Z'),'2026-10-27');
  assert.equal(entryFixingDateForSignal('2026-10-26T23:30:00Z').entry_fixing_date,'2026-10-28');
  assert.equal(signalLocalDate('2026-10-25T00:30:00Z'),'2026-10-25');
  assert.equal(signalLocalDate('2026-10-25T01:30:00Z'),'2026-10-25');
});

test('invalid dates and ambiguous local timestamps are rejected', () => {
  assert.equal(isBusinessDayIso('2026-02-30'),false);
  assert.equal(entryFixingDateForSignal('2026-10-26T13:00:00'),null);
  assert.equal(entryFixingDateForSignal('bad'),null);
  assert.equal(addBusinessDays('bad',1),null);
  assert.equal(addBusinessDays('2026-10-26',NaN),null);
});

const market = (date, rate) => ({reference_date:date, pairs:{'GBP/USD':{rate}}, source:'ecb_frankfurter_daily'});
test('Christmas, missing fixings and late backfill preserve exact T+1/T+3 dates', () => {
  const db = openDb(':memory:');
  saveMarketSnapshot(db,market('2026-12-24',1.3));
  saveCalibrationLog(db,[{snapshot_at:'2026-12-24T10:00:00Z',currency:'GBP',op_agent_score:20,is_new_currency_event:true,transition_type:'new_event'}]);
  saveMarketSnapshot(db,market('2026-12-28',1.31));
  saveMarketSnapshot(db,market('2026-12-30',1.33)); // Missing Tuesday 29th.
  let row = db.prepare('SELECT * FROM calibration_log').get();
  assert.equal(row.entry_fixing_date,'2026-12-28');
  assert.equal(row.expected_t1_date,'2026-12-29');
  assert.equal(row.expected_t3_date,'2026-12-31');
  assert.equal(row.outcome_t1_date,null);
  assert.ok(JSON.parse(row.gap_dates_json).includes('2026-12-29'));
  saveMarketSnapshot(db,market('2026-12-29',1.32));
  row = db.prepare('SELECT * FROM calibration_log').get();
  assert.equal(row.outcome_t1_date,'2026-12-29');
  assert.equal(row.outcome_t1_basket_pct,0.76); // Entry 1.31, never pre-signal 1.30.
  db.close();
});

test('historical invalidation preserves existing dates and returns, including completed outcomes', () => {
  const db = openDb(':memory:');
  db.prepare(`INSERT INTO calibration_log(snapshot_at,currency,op_version,shadow_version,code_hash,eligible_for_calibration,entry_fixing_date,outcome_t1_date,outcome_t1_basket_pct)
    VALUES('2026-10-25T10:00:00Z','GBP','old','old','old',1,'2026-10-23','2026-10-26',9.99)`).run();
  assert.equal(markHistoricalEvaluationsIneligible(db),1);
  saveMarketSnapshot(db,market('2026-10-26',1.31));
  const row=db.prepare('SELECT * FROM calibration_log').get();
  assert.equal(row.outcome_t1_basket_pct,9.99);
  assert.equal(row.entry_fixing_date,'2026-10-23');
  assert.equal(row.eligible_for_calibration,0);
  assert.equal(markHistoricalEvaluationsIneligible(db),0);
  db.close();
});

test('a caller cannot override the entry policy with a pre-signal reference date', () => {
  const db = openDb(':memory:');
  assert.throws(() => saveCalibrationLog(db,[{snapshot_at:'2026-10-26T18:00:00Z', currency:'GBP',entry_fixing_date:'2026-10-23'}]),/Invalid entry_fixing_date/);
  assert.equal(db.prepare('SELECT count(*) AS n FROM calibration_log').get().n,0);
  db.close();
});

test('reciprocal FX return uses the inverse ratio rather than negating the percentage', () => {
  const base={'GBP/USD':{rate:1}},target={'GBP/USD':{rate:1.1}};
  assert.equal(computeDailyBasketReturn(base,target,'GBP'),10);
  assert.equal(computeDailyBasketReturn(base,target,'USD'),-9.09);
  assert.match(computeCodeHash(),/^[0-9a-f]{64}$/);
});
