import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectPolymarketMarkets } from '../src/polymarketGeo.js';

const NOW = Date.parse('2026-11-11T06:00:00.000Z');
const FUTURE = '2027-01-01T04:59:00Z';

function tradeEvent(title, question) {
  return {
    id: title,
    title,
    slug: 'trade-check',
    closed: false,
    active: true,
    volume: 1_000_000,
    liquidity: 50_000,
    endDate: FUTURE,
    markets: [{
      id: `${title}-m`,
      question,
      closed: false,
      active: true,
      volumeNum: 1_000,
      endDate: FUTURE,
      outcomes: '["Yes","No"]',
      outcomePrices: '["0.4","0.6"]',
    }],
  };
}

function aranceles(title, question) {
  return selectPolymarketMarkets([tradeEvent(title, question)], NOW)
    .filter((row) => row.theme === 'ARANCELES_COMERCIO');
}

test('ARANCELES exige a EE. UU. y a una economía G8, China o México', () => {
  assert.equal(aranceles(
    'Which countries will Trump make new trade deals with before 2027?',
    'U.S. agrees to a new trade deal with "Pakistan" before 2027?',
  ).length, 0);

  assert.equal(aranceles(
    'US tariff schedule and trade war talks',
    'US tariff schedule and trade war talks?',
  ).length, 0);

  assert.equal(aranceles(
    'Trump administration tariff deal with Canada before 2027?',
    'Trump administration tariff deal with Canada before 2027?',
  ).length, 0);

  const china = aranceles(
    'US-China tariff agreement before 2027?',
    'US-China tariff agreement before 2027?',
  );
  assert.equal(china.length, 1);
  assert.equal(china[0].end_date, FUTURE);

  const canada = aranceles(
    'US-Canada diplomatic agreement to lower tariffs by December 31?',
    'US-Canada diplomatic agreement to lower tariffs by December 31?',
  );
  assert.equal(canada.length, 1);

  const mexico = aranceles(
    'US-Mexico tariff schedule before 2027?',
    'US-Mexico tariff schedule before 2027?',
  );
  assert.equal(mexico.length, 1);

  assert.equal(aranceles(
    'New tariff schedule before 2027?',
    'Will the United States and Mexico sign it?',
  ).length, 1);

  assert.equal(aranceles(
    'American tariffs on China before 2027?',
    'American tariffs on China before 2027?',
  ).length, 1);

  assert.equal(aranceles(
    'United States trade deal with the European Union before 2027?',
    'United States trade deal with the European Union before 2027?',
  ).length, 1);
});
