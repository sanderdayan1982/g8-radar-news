import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectCurrencies } from '../src/enrich.js';
import { classifyIrisItem, IRIS_CURRENCY_RULES } from '../src/irisCollector.js';
import { assignsUsd, CCY_KEYWORDS } from '../src/config.js';

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

test('ECB\'s Philip R. Lane says… asigna EUR', () => {
  assert.equal(byIris("ECB's Philip R. Lane says…").includes('EUR'), true);
});

test('NY Fed\'s John C. Williams… asigna USD', () => {
  assert.equal(byIris("NY Fed's John C. Williams…").includes('USD'), true);
});

test('Philip Lane sigue asignando EUR', () => {
  assert.deepEqual(byIris('Philip Lane'), ['EUR']);
});

test('la inicial intermedia opcional asigna la misma divisa', () => {
  const rows = [
    ['Brad R. Jones', 'AUD'],
    ['Brad R Jones', 'AUD'],
    ['Sarah R. Hunter', 'AUD'],
    ['Sarah R Hunter', 'AUD'],
    ['Christopher R. Kent', 'AUD'],
    ['Christopher R Kent', 'AUD'],
    ['Antoine R. Martin', 'CHF'],
    ['Antoine R Martin', 'CHF'],
    ['Alan R. Taylor', 'GBP'],
    ['Alan R Taylor', 'GBP'],
    ['Philip R. Lane', 'EUR'],
    ['Philip R Lane', 'EUR'],
    ['Nicolas R. Vincent', 'CAD'],
    ['Nicolas R Vincent', 'CAD'],
    ['Carolyn R. Rogers', 'CAD'],
    ['Carolyn R Rogers', 'CAD'],
    ['John C. Williams', 'USD'],
    ['John C Williams', 'USD'],
    ['Karen R. Silk', 'NZD'],
    ['Karen R Silk', 'NZD'],
    ['Paul R. Conway', 'NZD'],
    ['Paul R Conway', 'NZD'],
  ];
  for (const [title, ccy] of rows) {
    assert.deepEqual(byIris(title), [ccy], title);
  }
});

test('un segundo nombre no cuenta como inicial', () => {
  assert.equal(byIris('Philip Road Lane').includes('EUR'), false);
  assert.equal(byIris('John Middle Williams').includes('USD'), false);
});

test('Portugal CPI asigna EUR y no USD', () => {
  assert.equal(assignsUsd('Portugal CPI', CCY_KEYWORDS.USD.strong, CCY_KEYWORDS.USD.generic, CCY_KEYWORDS), false);
  assert.equal(assignsUsd('Portugal CPI', IRIS_CURRENCY_RULES.USD.strong, IRIS_CURRENCY_RULES.USD.generic, IRIS_CURRENCY_RULES), false);
  assert.deepEqual(byConfig('Portugal CPI'), ['EUR']);
  assert.deepEqual(byIris('Portugal CPI'), ['EUR']);
});

test('cada país de la zona euro que faltaba asigna EUR', () => {
  const rows = [
    ['Portugal', 'Portuguese'],
    ['Netherlands', 'Dutch'],
    ['Belgium', 'Belgian'],
    ['Austria', 'Austrian'],
    ['Ireland', 'Irish'],
    ['Greece', 'Greek'],
    ['Finland', 'Finnish'],
    ['Slovakia', 'Slovak'],
    ['Slovenia', 'Slovenian'],
    ['Lithuania', 'Lithuanian'],
    ['Latvia', 'Latvian'],
    ['Estonia', 'Estonian'],
    ['Luxembourg', 'Luxembourgish'],
    ['Malta', 'Maltese'],
    ['Cyprus', 'Cypriot'],
    ['Croatia', 'Croatian'],
  ];
  for (const [name, demonym] of rows) {
    assert.equal(byConfig(name).includes('EUR'), true, name);
    assert.equal(byIris(name).includes('EUR'), true, name);
    assert.equal(byConfig(demonym).includes('EUR'), true, demonym);
    assert.equal(byIris(demonym).includes('EUR'), true, demonym);
  }
});

test('Australia y Australian no asignan EUR', () => {
  for (const title of ['Australia', 'Australian']) {
    assert.equal(byConfig(title).includes('EUR'), false, title);
    assert.equal(byIris(title).includes('EUR'), false, title);
  }
});

test('Northern Ireland inflation asigna GBP y no EUR', () => {
  assert.deepEqual(byConfig('Northern Ireland inflation'), ['GBP']);
  assert.deepEqual(byIris('Northern Ireland inflation'), ['GBP']);
});

test('Ireland GDP asigna EUR', () => {
  assert.equal(byConfig('Ireland GDP').includes('EUR'), true);
  assert.equal(byIris('Ireland GDP').includes('EUR'), true);
  assert.equal(byConfig('Ireland GDP').includes('GBP'), false);
  assert.equal(byIris('Ireland GDP').includes('GBP'), false);
});
