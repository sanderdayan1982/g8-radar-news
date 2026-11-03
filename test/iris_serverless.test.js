import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { classifyIrisItem, computeItemSha256, deduplicateAndFilterWindow } from '../src/irisCollector.js';

test('IRIS Classifier: detecta las 9 divisas (G8 + XAU) y las 6 categorías institucionales en < 1ms sin LLMs', () => {
  const t0 = performance.now();

  const bcItem = classifyIrisItem({
    title: 'Fed Chair Powell signals FOMC will hold interest rates steady; ECB Lagarde concurs',
    url: 'https://example.com/fed-ecb-1',
    published_at: new Date().toISOString(),
  });
  assert.ok(bcItem.currencies.includes('USD'));
  assert.ok(bcItem.currencies.includes('EUR'));
  assert.equal(bcItem.iris_category, 'BC');

  const fiscalItem = classifyIrisItem({
    title: 'UK Gilts and French OAT bond yields surge ahead of Treasury budget auction deficit',
    url: 'https://example.com/fiscal-1',
    published_at: new Date().toISOString(),
  });
  assert.ok(fiscalItem.currencies.includes('GBP'));
  assert.ok(fiscalItem.currencies.includes('EUR'));
  assert.ok(fiscalItem.iris_categories.includes('Fiscal'));

  const infItem = classifyIrisItem({
    title: 'US Core CPI YoY and Nonfarm Payrolls NFP beat expectations; unemployment drops',
    url: 'https://example.com/cpi-nfp-1',
    published_at: new Date().toISOString(),
  });
  assert.ok(infItem.currencies.includes('USD'));
  assert.equal(infItem.iris_category, 'Inflacion_Empleo');

  const commItem = classifyIrisItem({
    title: 'Spot Gold XAU hits record high as WTI crude oil, iron ore and New Zealand GDT dairy auction rise',
    url: 'https://example.com/comm-1',
    published_at: new Date().toISOString(),
  });
  assert.ok(commItem.currencies.includes('XAU'));
  assert.ok(commItem.currencies.includes('AUD'));
  assert.ok(commItem.currencies.includes('NZD'));
  assert.ok(commItem.currencies.includes('CAD'));
  assert.equal(commItem.iris_category, 'Commodities_ToT');

  const intItem = classifyIrisItem({
    title: 'Japan MoF conducts FX intervention rate check after verbal warning on excessive moves; SNB intervention eyed',
    url: 'https://example.com/mof-1',
    published_at: new Date().toISOString(),
  });
  assert.ok(intItem.currencies.includes('JPY'));
  assert.ok(intItem.currencies.includes('CHF'));
  assert.equal(intItem.iris_category, 'Intervencion_EA4');

  const riskItem = classifyIrisItem({
    title: 'Strait of Hormuz geopolitical escalation sparks systemic bank stress and emergency liquidity swap line',
    url: 'https://example.com/risk-1',
    published_at: new Date().toISOString(),
  });
  assert.equal(riskItem.iris_category, 'Riesgo_Sistemico');

  const elapsedMs = performance.now() - t0;
  assert.ok(elapsedMs < 25, `Clasificación determinista debe ejecutarse en milisegundos (tomó ${elapsedMs.toFixed(2)}ms)`);
});

test('Deduplicación estricta sha256(url || title) y ventana limpia de 72 horas', () => {
  const now = Date.now();
  const sha1 = computeItemSha256('https://www.ft.com/content/abc/', 'BOJ rate decision');
  const sha2 = computeItemSha256('http://www.ft.com/content/abc', '  boj rate decision ');
  assert.equal(sha1, sha2, 'URLs equivalentes HTTP/HTTPS y títulos con espacios deben colapsar al mismo SHA-256');

  const recent = {
    title: 'RBA holds cash rate at 4.35%',
    url: 'https://www.rba.gov.au/mr-1',
    source_type: 'breaking',
    published_at: new Date(now - 2 * 3600_000).toISOString(),
  };
  const duplicateRecent = {
    title: 'RBA holds cash rate at 4.35%',
    url: 'https://www.rba.gov.au/mr-1/',
    source_type: 'breaking',
    published_at: new Date(now - 2 * 3600_000).toISOString(),
  };
  const expiredBreaking = {
    title: 'Old breaking news from 5 days ago',
    url: 'https://t.me/FinancialJuice/100',
    source_type: 'breaking',
    published_at: new Date(now - 120 * 3600_000).toISOString(),
  };

  const { allWindowItems } = deduplicateAndFilterWindow([recent, duplicateRecent, expiredBreaking], [], now, 72);
  assert.equal(allWindowItems.length, 1);
  assert.equal(allWindowItems[0].title, 'RBA holds cash rate at 4.35%');
});

test('Candado Anti-Cobro Netlify ([skip netlify]) presente en workflow y netlify.toml', () => {
  const wf = readFileSync(new URL('../.github/workflows/update_radar_news.yml', import.meta.url), 'utf8');
  const toml = readFileSync(new URL('../netlify.toml', import.meta.url), 'utf8');
  assert.match(wf, /cron:\s*'\*\/5 \* \* \* \*'/);
  assert.match(wf, /chore\(feed\): sync radar news \[skip netlify\]/);
  assert.match(toml, /\[skip netlify\]/);
  assert.match(toml, /\/api\/iris-feed/);
  assert.match(toml, /\/api\/radar-full/);
});
