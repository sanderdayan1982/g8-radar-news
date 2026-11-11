import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectPolymarketMarkets } from '../src/polymarketGeo.js';

const NOW = Date.parse('2026-11-11T06:00:00.000Z');

function israelEvent({ question, marketEnd, eventEnd, markets }) {
  return {
    id: question || 'israel-pm',
    title: 'Prime Minister of Israel after the next election?',
    slug: 'israel-pm',
    closed: false,
    active: true,
    volume: 1_000_000,
    liquidity: 50_000,
    endDate: eventEnd,
    markets: markets || [{
      id: 'pm',
      question,
      closed: false,
      active: true,
      volumeNum: 1_000,
      endDate: marketEnd,
      outcomes: '["Yes","No"]',
      outcomePrices: '["0.4","0.6"]',
    }],
  };
}

function picked(event) {
  return selectPolymarketMarkets([event], NOW);
}

test('un end_date ya pasado sale y uno futuro se queda', () => {
  const expired = picked(israelEvent({
    question: 'Will Benjamin Netanyahu be the next Prime Minister of Israel?',
    marketEnd: '2026-10-28T03:59:00Z',
  }));
  assert.equal(expired.length, 0);

  const future = picked(israelEvent({
    question: 'Will Benjamin Netanyahu be the next Prime Minister of Israel?',
    marketEnd: '2027-01-01T04:59:00Z',
  }));
  assert.equal(future.length, 1);
  assert.equal(future[0].theme, 'IRAN_ORIENTE_MEDIO');
  assert.equal(future[0].end_date, '2027-01-01T04:59:00Z');

  const tariffs = picked({
    id: 'us-canada',
    title: 'US-Canada diplomatic agreement to lower tariffs by...?',
    slug: 'us-canada-tariffs',
    closed: false,
    active: true,
    volume: 400_000,
    liquidity: 40_000,
    markets: [{
      id: 'us-canada-m',
      question: 'US-Canada diplomatic agreement to lower tariffs by October 31?',
      closed: false,
      active: true,
      volumeNum: 1_000,
      endDate: '2026-11-01T03:59:00Z',
      outcomes: '["Yes","No"]',
      outcomePrices: '["0.2","0.8"]',
    }],
  });
  assert.equal(tariffs.length, 0);

  const sameInstant = picked(israelEvent({
    question: 'Will Benjamin Netanyahu be the next Prime Minister of Israel?',
    marketEnd: new Date(NOW).toISOString(),
  }));
  assert.equal(sameInstant.length, 1);

  const oneMsBefore = picked(israelEvent({
    question: 'Will Benjamin Netanyahu be the next Prime Minister of Israel?',
    marketEnd: new Date(NOW - 1).toISOString(),
  }));
  assert.equal(oneMsBefore.length, 0);

  // Falta o no se lee: el selector ya publicaba el mercado. Se conserva.
  const missing = picked(israelEvent({
    question: 'Will Benjamin Netanyahu be the next Prime Minister of Israel?',
  }));
  assert.equal(missing.length, 1);
  assert.equal(missing[0].end_date, null);

  const unreadable = picked(israelEvent({
    question: 'Will Benjamin Netanyahu be the next Prime Minister of Israel?',
    marketEnd: 'not-a-date',
  }));
  assert.equal(unreadable.length, 1);
  assert.equal(unreadable[0].end_date, 'not-a-date');

  const eventLevel = picked(israelEvent({
    question: 'Will Benjamin Netanyahu be the next Prime Minister of Israel?',
    eventEnd: '2026-10-28T03:59:00Z',
  }));
  assert.equal(eventLevel.length, 0);

  const nextOpen = picked(israelEvent({
    markets: [
      {
        id: 'old',
        question: 'Expired Israel contract?',
        closed: false,
        active: true,
        volumeNum: 9_000,
        endDate: '2026-10-28T03:59:00Z',
        outcomes: '["Yes","No"]',
        outcomePrices: '["0.2","0.8"]',
      },
      {
        id: 'live',
        question: 'Israel contract still open?',
        closed: false,
        active: true,
        volumeNum: 1_000,
        endDate: '2027-06-01T00:00:00Z',
        outcomes: '["Yes","No"]',
        outcomePrices: '["0.7","0.3"]',
      },
    ],
  }));
  assert.equal(nextOpen.length, 1);
  assert.equal(nextOpen[0].question, 'Israel contract still open?');
  assert.equal(nextOpen[0].end_date, '2027-06-01T00:00:00Z');
});
