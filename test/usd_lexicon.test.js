import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectCurrencies } from '../src/enrich.js';
import { classifyIrisItem } from '../src/irisCollector.js';

function byConfig(title) {
  return detectCurrencies(title).filter((ccy) => ccy !== 'XAU').sort();
}

function byIris(title) {
  const item = classifyIrisItem({ title, url: 'https://example.com/usd-lexicon' });
  return item.currencies.filter((ccy) => ccy !== 'XAU').sort();
}

const CASES = [
  ['UK CPI y/y 3.8%', ['GBP']],
  ['Kiwi CPI q/q', ['NZD']],
  ['US CPI m/m 0.3%', ['USD']],
  ['CPI m/m 0.3% vs 0.2% expected', ['USD']],
  ['Canada hit by new US tariff', ['CAD', 'USD']],
  ["Fed's Powell: CPI still too high", ['USD']],
];

for (const [title, expected] of CASES) {
  test(`config: ${title}`, () => {
    assert.deepEqual(byConfig(title), expected);
  });
  test(`iris: ${title}`, () => {
    assert.deepEqual(byIris(title), expected);
  });
}

test('«us» en minúsculas no asigna USD', () => {
  assert.deepEqual(byConfig('Canada hit by new us tariff'), ['CAD']);
  assert.deepEqual(byIris('Canada hit by new us tariff'), ['CAD']);
  assert.deepEqual(byConfig('Join us for a briefing'), []);
  assert.deepEqual(byIris('Join us for a briefing'), []);
});

test('U.S. con puntos encaja ante espacio, puntuación o fin', () => {
  for (const title of ['the U.S. economy', 'the U.S. economy,', 'Rates in the U.S.']) {
    assert.deepEqual(byConfig(title), ['USD'], title);
    assert.deepEqual(byIris(title), ['USD'], title);
  }
});

test('american asigna USD y Americans no', () => {
  assert.deepEqual(byConfig('American factories expand'), ['USD']);
  assert.deepEqual(byIris('American factories expand'), ['USD']);
  assert.deepEqual(byConfig('Americans spend more'), []);
  assert.deepEqual(byIris('Americans spend more'), []);
});

test('Shane Jones no es AUD', () => {
  assert.equal(byConfig('Shane Jones').includes('AUD'), false);
  assert.equal(byIris('Shane Jones').includes('AUD'), false);
});

test('Hunter McMaster no es AUD', () => {
  assert.equal(byConfig('Hunter McMaster').includes('AUD'), false);
  assert.equal(byIris('Hunter McMaster').includes('AUD'), false);
});

test('el nombre completo sigue asignando su divisa', () => {
  const rows = [
    ['Brad Jones', 'AUD'],
    ['Sarah Hunter', 'AUD'],
    ['Christopher Kent', 'AUD'],
    ['Antoine Martin', 'CHF'],
    ['Alan Taylor', 'GBP'],
    ['Philip Lane', 'EUR'],
    ['Nicolas Vincent', 'CAD'],
    ['Carolyn Rogers', 'CAD'],
    ['John Williams', 'USD'],
    ['Karen Silk', 'NZD'],
    ['Paul Conway', 'NZD'],
  ];
  for (const [title, ccy] of rows) {
    assert.equal(byIris(title).includes(ccy), true, title);
  }
});
