import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SOURCES, PRESERVED_SOURCE_IDS, CURRENCIES } from '../src/config.js';
import { isOfficialNoise, isRelevant, fingerprint, parseRss, parseTelegram, parseMacro, detectCurrencies, enrichRaw, headlineFromUrl } from '../src/enrich.js';

test('universo G8 intacto', () => {
  assert.deepEqual(CURRENCIES, ['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD', 'NZD']);
});

test('no se quitan las fuentes que ya estaban en producción', () => {
  const ids = new Set(SOURCES.map((s) => s.id));
  for (const id of PRESERVED_SOURCE_IDS) assert.ok(ids.has(id), `falta ${id}`);
});

test('fuentes NZD y CHF oficiales pedidas están cableadas', () => {
  const ids = SOURCES.map((s) => s.id);
  for (const id of ['rbnz', 'nz-treasury', 'stats-nz', 'snb-press', 'snb-mopo', 'snb-speeches', 'snb-adhoc', 'seco']) {
    assert.ok(ids.includes(id), `falta ${id}`);
  }
  assert.equal(SOURCES.find((s) => s.id === 'rbnz').url, 'https://www.rbnz.govt.nz/feeds/news');
  assert.ok(SOURCES.find((s) => s.id === 'snb-press').url.includes('/public/rss/en/pressrel'));
});

test('Telegram Negocios TV y Brújula de Mercados se añaden sin quitar FJ', () => {
  assert.ok(SOURCES.some((s) => s.id === 'negociostv' && s.url.includes('negociostv')));
  const brujula = SOURCES.find((s) => s.id === 'burbuja-mercados');
  assert.equal(brujula.url, 'https://t.me/s/BrujulaDeMercados');
  assert.equal(brujula.name, 'Brújula de Mercados');
  assert.ok(SOURCES.some((s) => s.id === 'financialjuice'));
});

test('ruido oficial se descarta; política monetaria entra', () => {
  assert.equal(isOfficialNoise('2026 Carl Menger Award'), true);
  assert.equal(isOfficialNoise('Recruitment for two new Assistant Governors'), true);
  assert.equal(isOfficialNoise('Monetary policy assessment of 24 September 2026'), false);
  assert.equal(isOfficialNoise('OCR decision and Monetary Policy Statement'), false);
  assert.equal(isRelevant({ title: 'New framework supports access to basic transaction services', source_type: 'oficial', currencies: ['NZD'] }), false);
  assert.equal(isRelevant({ title: 'Monetary policy assessment of 24 September 2026', source_type: 'oficial', currencies: ['CHF'] }), true);
});

test('Negocios TV filtra política doméstica sin G8', () => {
  const skip = {
    title: 'El PSOE se hunde en Aragón: Vox amenaza con el sorpaso',
    source: 'Negocios TV',
    currencies: [],
    source_type: 'agencia',
  };
  const keep = {
    title: 'ÚLTIMA HORA | El BCE mantiene tipos y Lagarde habla de inflación',
    source: 'Negocios TV',
    currencies: ['EUR'],
    source_type: 'agencia',
  };
  assert.equal(isRelevant(skip), false);
  assert.equal(isRelevant(keep), true);
});

test('fingerprint estable, HTTP=HTTPS y parseo FJ ACTUAL/FORECAST', () => {
  assert.equal(fingerprint('Hello', 'http://x.com/a'), fingerprint('Hello', 'https://www.x.com/a/'));
  const m = parseMacro('US CPI ACTUAL 3.2% FORECAST 3.1% PREVIOUS 3.0%');
  assert.equal(m.actual, '3.2%');
  assert.equal(m.forecast, '3.1%');
  assert.equal(m.previous, '3.0%');
});

test('detecta CHF/NZD por banco y parsea RSS/Telegram', () => {
  assert.deepEqual(detectCurrencies('SNB monetary policy assessment'), ['CHF']);
  assert.deepEqual(detectCurrencies('RBNZ holds OCR'), ['NZD']);
  const rss = parseRss(`<rss><channel><item><title>OCR held</title><link>https://rbnz.govt.nz/x</link><pubDate>Thu, 23 Oct 2026 10:00:00 GMT</pubDate></item></channel></rss>`);
  assert.equal(rss[0].title, 'OCR held');
  const tg = parseTelegram(`<div class="tgme_widget_message_wrap"><div class="tgme_widget_message_text">BREAKING USD CPI</div><time datetime="2026-10-23T12:00:00+00:00"></time><a href="https://t.me/FinancialJuice/1">x</a></div>`);
  assert.match(tg[0].title, /USD CPI/);
});

test('enrich asigna fuente oficial NZD', () => {
  const item = enrichRaw({ title: 'OCR decision', url: 'https://www.rbnz.govt.nz/x', body: '', published_at: new Date().toISOString() }, {
    id: 'rbnz', name: 'RBNZ', type: 'oficial', currency: 'NZD',
  });
  assert.ok(item.currencies.includes('NZD'));
  assert.equal(item.source_type, 'oficial');
});

test('Parte C: prensa NZD/CHF/AUD por Google News y RNZ negocios; swissinfo queda fuera', () => {
  assert.equal(SOURCES.length, 35);
  assert.equal(new Set(SOURCES.map((s) => s.id)).size, 35);

  const expected = {
    'nz-press': {
      currency: 'NZD',
      q: 'RBNZ OR "Reserve Bank of New Zealand" OR "Anna Breman" OR "official cash rate" New Zealand when:3d',
      hl: 'en-NZ',
      gl: 'NZ',
      ceid: 'NZ:en',
    },
    'ch-press': {
      currency: 'CHF',
      q: 'SNB OR "Swiss National Bank" OR Schlegel OR Tschudin OR "Swiss franc" when:3d',
      hl: 'en-US',
      gl: 'CH',
      ceid: 'CH:en',
    },
    'au-press': {
      currency: 'AUD',
      q: 'RBA OR "Reserve Bank of Australia" OR Bullock OR Hauser OR "cash rate" Australia when:3d',
      hl: 'en-AU',
      gl: 'AU',
      ceid: 'AU:en',
    },
  };
  for (const [id, spec] of Object.entries(expected)) {
    const source = SOURCES.find((s) => s.id === id);
    assert.ok(source, `falta ${id}`);
    assert.equal(source.type, 'agencia');
    assert.equal(source.kind, 'rss');
    assert.equal(source.currency, spec.currency);
    const url = new URL(source.url);
    assert.equal(url.origin + url.pathname, 'https://news.google.com/rss/search');
    assert.equal(url.searchParams.get('q'), spec.q);
    assert.match(source.url, /when:3d/);
    assert.equal(url.searchParams.get('hl'), spec.hl);
    assert.equal(url.searchParams.get('gl'), spec.gl);
    assert.equal(url.searchParams.get('ceid'), spec.ceid);
  }

  const rnz = SOURCES.find((s) => s.id === 'rnz-business');
  assert.equal(rnz.type, 'agencia');
  assert.equal(rnz.kind, 'rss');
  assert.equal(rnz.currency, 'NZD');
  assert.equal(rnz.url, 'https://www.rnz.co.nz/rss/business.xml');

  assert.equal(SOURCES.some((s) => /swissinfo/i.test(`${s.id} ${s.url} ${s.name}`)), false);
  const discarded = /zerohedge|fxstreet|marketwatch|investing\.com|cincodias|bloomberg\.com|wsj\.com|truthsocial|reuters|deitaone|firstsquawk/i;
  for (const id of ['nz-press', 'ch-press', 'au-press', 'rnz-business']) {
    const source = SOURCES.find((s) => s.id === id);
    assert.doesNotMatch(`${source.id} ${source.url} ${source.name}`, discarded);
  }

  const spec = readFileSync(new URL('../SPEC.md', import.meta.url), 'utf8');
  assert.match(spec, /35 fuentes/);
  assert.match(spec, /nz-press/);
  assert.match(spec, /ch-press/);
  assert.match(spec, /au-press/);
  assert.match(spec, /rnz-business/);
  assert.match(spec, /swissinfo/);
  assert.match(spec, /HTTP 410/);
  assert.match(spec, /### 3\.7 Descartadas/);
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(html, /35 fuentes/);
  assert.doesNotMatch(html, /31 fuentes/);
  const live = readFileSync(new URL('../netlify/functions/radar_live.mjs', import.meta.url), 'utf8');
  assert.match(live, /SOURCES\.length/);
  assert.doesNotMatch(live, /31sources/);
  assert.doesNotMatch(live, />=\s*31\b/);
});

test('headlineFromUrl recupera PMI 57.9 vs 58.0 de un slug InvestingLive', () => {
  const h = headlineFromUrl('https://investinglive.com/news/pmi-57-9-vs-58-0-expected');
  assert.match(h, /57\.9/);
  assert.match(h, /58\.0/);
});
