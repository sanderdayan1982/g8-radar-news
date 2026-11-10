import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  COVERAGE_CURRENCIES,
  SILENCE_BUSINESS_HOURS,
  SILENCE_CURRENCIES,
  buildCoverage,
  businessHoursBetween,
  naturalHoursBetween,
} from '../src/irisCollector.js';

const G8 = ['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD', 'NZD'];

function item(currency, publishedAt, sourceType = 'breaking') {
  return {
    title: `${currency} headline for the silence flag`,
    url: `https://example.com/silence/${currency}/${publishedAt}`,
    source_type: sourceType,
    published_at: publishedAt,
    currencies: [currency],
  };
}

test('el umbral de silencio está congelado en 12 h hábiles y XAU no entra en la lista', () => {
  assert.equal(SILENCE_BUSINESS_HOURS, 12);
  assert.deepEqual([...SILENCE_CURRENCIES], G8);
  assert.equal(SILENCE_CURRENCIES.includes('XAU'), false);
  assert.equal(COVERAGE_CURRENCIES.includes('XAU'), true);
});

test('silence es true en el borde exacto de 12 h hábiles y false por debajo', () => {
  const start = Date.parse('2026-11-09T06:00:00.000Z');
  const exactly = start + 12 * 3600_000;
  const under = start + 11 * 3600_000 + 54 * 60_000;
  assert.equal(businessHoursBetween(start, exactly), 12);
  assert.equal(naturalHoursBetween(start, exactly), 12);
  assert.equal(businessHoursBetween(start, under), 11.9);

  const atEdge = buildCoverage([item('EUR', new Date(start).toISOString())], exactly);
  assert.equal(atEdge.EUR.hours_since_last_business, 12);
  assert.equal(atEdge.EUR.hours_since_last, 12);
  assert.equal(atEdge.EUR.silence, true);

  const below = buildCoverage([item('GBP', new Date(start).toISOString())], under);
  assert.equal(below.GBP.hours_since_last_business, 11.9);
  assert.equal(below.GBP.silence, false);
});

test('el fin de semana UTC no cuenta para el silencio', () => {
  const friday2200 = Date.parse('2026-11-06T22:00:00.000Z');
  const monday0200 = Date.parse('2026-11-09T02:00:00.000Z');
  const monday1000 = Date.parse('2026-11-09T10:00:00.000Z');
  assert.equal(naturalHoursBetween(friday2200, monday0200), 52);
  assert.equal(businessHoursBetween(friday2200, monday0200), 4);
  assert.equal(naturalHoursBetween(friday2200, monday1000), 60);
  assert.equal(businessHoursBetween(friday2200, monday1000), 12);

  const quietWeekend = buildCoverage([
    item('CHF', '2026-11-06T22:00:00.000Z'),
  ], monday0200);
  assert.equal(quietWeekend.CHF.hours_since_last, 52);
  assert.equal(quietWeekend.CHF.hours_since_last_business, 4);
  assert.equal(quietWeekend.CHF.silence, false);

  const weekendEdge = buildCoverage([
    item('JPY', '2026-11-06T22:00:00.000Z'),
  ], monday1000);
  assert.equal(weekendEdge.JPY.hours_since_last, 60);
  assert.equal(weekendEdge.JPY.hours_since_last_business, 12);
  assert.equal(weekendEdge.JPY.silence, true);

  const saturday = Date.parse('2026-11-07T10:00:00.000Z');
  const sunday = Date.parse('2026-11-08T22:00:00.000Z');
  assert.equal(businessHoursBetween(saturday, sunday), 0);
  const weekendOnly = buildCoverage([item('CAD', new Date(saturday).toISOString())], sunday);
  assert.equal(weekendOnly.CAD.hours_since_last_business, 0);
  assert.equal(weekendOnly.CAD.silence, false);
});

test('sin titular, hours_since_last_business es null y silence es true; XAU sigue sin el campo', () => {
  const now = Date.parse('2026-11-10T18:00:00.000Z');
  const coverage = buildCoverage([
    item('USD', '2026-11-10T16:00:00.000Z'),
  ], now);
  for (const currency of G8) {
    if (currency === 'USD') {
      assert.equal(coverage.USD.hours_since_last_business, 2);
      assert.equal(coverage.USD.silence, false);
      continue;
    }
    assert.equal(coverage[currency].hours_since_last_business, null);
    assert.equal(coverage[currency].last_item_at, null);
    assert.equal(coverage[currency].silence, true);
  }
  assert.equal(coverage.XAU.hours_since_last_business, null);
  assert.equal(coverage.XAU.last_item_at, null);
  assert.equal(Object.hasOwn(coverage.XAU, 'silence'), false);
});

test('las ocho divisas llevan la bandera, XAU no, y el silencio no añade candado ni nivel', () => {
  const now = Date.parse('2026-11-10T18:00:00.000Z');
  const old = '2026-11-09T00:00:00.000Z';
  const fresh = '2026-11-10T12:00:00.000Z';
  const coverage = buildCoverage([
    item('USD', old),
    item('AUD', fresh),
    item('NZD', old),
    item('XAU', old, 'agencia'),
  ], now);

  assert.equal(coverage.USD.silence, true);
  assert.ok(coverage.USD.hours_since_last_business >= 12);
  assert.equal(coverage.AUD.silence, false);
  assert.ok(coverage.AUD.hours_since_last_business < 12);
  assert.equal(coverage.NZD.silence, true);
  for (const currency of G8) {
    assert.equal(typeof coverage[currency].silence, 'boolean');
    assert.equal(Object.hasOwn(coverage[currency], 'lock_level'), false);
    assert.equal(Object.hasOwn(coverage[currency], 'risk_level'), false);
  }
  assert.ok(coverage.XAU.hours_since_last_business >= 12);
  assert.equal(Object.hasOwn(coverage.XAU, 'silence'), false);
  assert.equal(Object.hasOwn(coverage.XAU, 'lock_level'), false);

  const empty = buildCoverage([], now);
  for (const currency of G8) {
    assert.equal(empty[currency].hours_since_last_business, null);
    assert.equal(empty[currency].silence, true);
  }
  assert.equal(empty.XAU.hours_since_last_business, null);
  assert.equal(Object.hasOwn(empty.XAU, 'silence'), false);

  const locks = readFileSync(new URL('../src/lockSeverity.js', import.meta.url), 'utf8');
  assert.doesNotMatch(locks, /silence/);
  const workflow = readFileSync(new URL('../.github/workflows/update_radar_news.yml', import.meta.url), 'utf8');
  assert.match(workflow, /test\/silence\.test\.js/);
});
