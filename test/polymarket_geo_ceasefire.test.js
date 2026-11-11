import { test } from 'node:test';
import assert from 'node:assert/strict';
import { POLYMARKET_GEO_THEMES } from '../src/config.js';
import { selectPolymarketMarkets, themesForTitle } from '../src/polymarketGeo.js';

const NOW = Date.parse('2026-11-11T06:00:00.000Z');

function openEvent(title, question, endDate) {
  return {
    id: title,
    title,
    slug: 'ceasefire-check',
    closed: false,
    active: true,
    volume: 1_000_000,
    liquidity: 50_000,
    endDate,
    markets: [{
      id: `${title}-m`,
      question,
      closed: false,
      active: true,
      volumeNum: 1_000,
      endDate,
      outcomes: '["Yes","No"]',
      outcomePrices: '["0.5","0.5"]',
    }],
  };
}

function themes(title, question, endDate) {
  return selectPolymarketMarkets([openEvent(title, question, endDate)], NOW).map((row) => row.theme);
}

test('el alto el fuego de Israel e Irán no entra en RUSIA_UCRANIA y el de Rusia y Ucrania sí', () => {
  assert.equal(
    POLYMARKET_GEO_THEMES.find((theme) => theme.theme === 'RUSIA_UCRANIA').keywords.includes('ceasefire'),
    false,
  );

  const iran = themes(
    'Israel x Iran ceasefire continues through November 15?',
    'Israel x Iran ceasefire continues through November 15?',
    '2026-11-16T04:59:00Z',
  );
  assert.equal(iran.includes('RUSIA_UCRANIA'), false);
  assert.equal(iran.includes('IRAN_ORIENTE_MEDIO'), true);
  assert.equal(themesForTitle('Israel x Iran ceasefire continues through November 15?').some((hit) => hit.theme === 'RUSIA_UCRANIA'), false);
  assert.equal(themesForTitle('Ceasefire talks continue').some((hit) => hit.theme === 'RUSIA_UCRANIA'), false);

  const russia = themes(
    'Russia x Ukraine ceasefire agreement',
    'Russia x Ukraine ceasefire agreement by December 31, 2026?',
    '2027-01-01T04:59:00Z',
  );
  assert.equal(russia.includes('RUSIA_UCRANIA'), true);
  assert.equal(themesForTitle('Russia x Ukraine ceasefire agreement').some((hit) => hit.theme === 'RUSIA_UCRANIA'), true);
});
