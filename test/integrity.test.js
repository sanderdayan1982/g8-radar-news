import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  cleanHeadline, headlineFromUrl, parseMacro, parseRss, parseTelegram, enrichRaw,
  fingerprint, canonicalPath, preferPublishedAt, normalizeStoredNews, dedupeNews,
  isRelevant, parseHtmlList,
} from '../src/enrich.js';
import { openDb, insertNews, upsertCalendar, listCalendar, listNews, recentNews, saveScores, latestEngine, persistCalendarLinks, repairPersistedNews } from '../src/db.js';
import { linkNewsToCalendar } from '../src/calendar.js';
import { classifyAgent, attachRanks } from '../src/classifyCurrencies.js';
import { SOURCES } from '../src/config.js';

const IL = SOURCES.find((s) => s.id === 'investinglive');
const FJ = SOURCES.find((s) => s.id === 'financialjuice');
const FED = SOURCES.find((s) => s.id === 'fed');

test('InvestingLive URL+anuncio se convierte en titular y cifras, no en URL', () => {
  const slug = 'https://investinglive.com/news/pmi-57-9-vs-58-0-expected';
  const title = cleanHeadline(`${slug} This is a delayed news feed. For the fastest FX headlines subscribe.`, slug, 'InvestingLive');
  assert.doesNotMatch(title, /^https?:/i);
  assert.doesNotMatch(title, /delayed news feed/i);
  assert.match(title, /pmi/i);
  const m = parseMacro(title);
  assert.equal(parseFloat(m.actual), 57.9);
  assert.equal(parseFloat(m.forecast), 58.0);
  const item = enrichRaw({
    title: slug,
    body: 'This is a delayed news feed. For the fastest FX headlines subscribe to InvestingLive.',
    url: slug,
    published_at: '2026-10-24T07:00:00Z',
  }, IL);
  assert.doesNotMatch(item.title, /^https?:/i);
  assert.ok(item.actual, `actual vacío en ${item.title}`);
});

test('slug de ventas canadienses no llega a la UI como catalizador URL', () => {
  const url = 'https://investinglive.com/news/canada-august-retail-sales-vs-expected';
  const item = enrichRaw({
    title: url,
    body: 'ACTUAL -0.4% FORECAST 0.1% PREVIOUS 0.2%',
    url,
    published_at: '2026-10-24T12:30:00Z',
  }, IL);
  assert.doesNotMatch(item.title, /^https?:/i);
  assert.match(item.title, /retail/i);
  assert.equal(item.actual, '-0.4%');
  assert.ok(item.currencies.includes('CAD'));
});

test('FinancialJuice limpia | FJ y guarda el enlace del mensaje, no el canal', () => {
  const html = `<div class="tgme_widget_message_wrap">
    <div class="tgme_widget_message_text">Saudi civil defense issues warning of potential hazard in Jeddah| FJ</div>
    <time datetime="2026-10-24T08:00:00+00:00"></time>
    <a href="https://t.me/FinancialJuice">channel</a>
    <a href="https://t.me/FinancialJuice/88771">permalink</a>
  </div>`;
  const items = parseTelegram(html);
  assert.equal(items.length, 1);
  assert.doesNotMatch(items[0].title, /\|\s*FJ/i);
  assert.match(items[0].url, /FinancialJuice\/88771/);
  const item = enrichRaw(items[0], FJ);
  assert.equal(item.category, 'geopolitica');
  assert.equal(item.currencies.includes('USD'), false, 'aviso civil no es refugio G8');
});

test('Fed CDATA y URL monetaryYYYYMMDD no se rejuvenecen al scrape', () => {
  const xml = `<?xml version="1.0"?><rss><channel>
    <item>
      <title><![CDATA[Federal Reserve issues FOMC statement]]></title>
      <link><![CDATA[https://www.federalreserve.gov/newsevents/pressreleases/monetary20260916a.htm]]></link>
      <pubDate><![CDATA[Fri, 24 Oct 2026 00:10:00 GMT]]></pubDate>
    </item>
    <item>
      <title><![CDATA[Untitled scrape]]></title>
      <link>https://www.federalreserve.gov/newsevents/pressreleases/monetary20260916a.htm</link>
    </item>
  </channel></rss>`;
  const items = parseRss(xml);
  assert.ok(items.length >= 1);
  const first = items[0];
  assert.match(first.published_at, /^2026-09-16/);
  const repaired = preferPublishedAt(
    'https://www.federalreserve.gov/newsevents/pressreleases/monetary20260916a.htm',
    '2026-10-24T00:10:00.000Z',
  );
  assert.match(repaired, /^2026-09-16/);
  const stored = normalizeStoredNews({
    title: 'Federal Reserve issues FOMC statement',
    url: 'https://www.federalreserve.gov/newsevents/pressreleases/monetary20260916a.htm',
    published_at: '2026-10-24T00:10:00.000Z',
    currencies: ['USD'],
  });
  assert.match(stored.published_at, /^2026-09-16/);
});

test('HTTP y HTTPS del mismo documento BoJ colapsan a un fingerprint', () => {
  const a = fingerprint('Statement on Monetary Policy', 'http://www.boj.or.jp/en/announcements/release_2026/k261024a.pdf');
  const b = fingerprint('Statement on Monetary Policy', 'https://www.boj.or.jp/en/announcements/release_2026/k261024a.pdf/');
  assert.equal(a, b);
  assert.equal(
    canonicalPath('http://www.boj.or.jp/en/announcements/release_2026/k261024a.pdf'),
    canonicalPath('https://boj.or.jp/en/announcements/release_2026/k261024a.pdf/'),
  );
  const rows = dedupeNews([
    { title: 'Statement on Monetary Policy', url: 'http://www.boj.or.jp/en/announcements/release_2026/k261024a.pdf' },
    { title: 'Statement on Monetary Policy', url: 'https://www.boj.or.jp/en/announcements/release_2026/k261024a.pdf' },
  ]);
  assert.equal(rows.length, 1);
});

test('upsertCalendar conserva actual ya recibido aunque ForexFactory venga vacío', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rn-cal-'));
  const db = openDb(join(dir, 't.db'));
  const ev = {
    id: 'evt1', title: 'Retail Sales m/m', currency: 'GBP', event_at: '2026-10-24T06:00:00.000Z',
    impact: 'High', forecast: '0.1%', previous: '0.4%', actual: '-0.4%', news_item_id: 7, prealerted: 0,
  };
  upsertCalendar(db, [ev], '2026-10-20');
  upsertCalendar(db, [{ ...ev, actual: null, news_item_id: null, forecast: '0.1%' }], '2026-10-20');
  const row = listCalendar(db)[0];
  assert.equal(row.actual, '-0.4%');
  assert.equal(row.news_item_id, 7);
});

test('el matcher hidrata actuals por familia de evento fuera de ±30 min', () => {
  const events = [{
    id: 'pmi-gb', title: 'S&P Global Manufacturing PMI', currency: 'GBP',
    event_at: '2026-10-24T08:30:00.000Z', impact: 'High', forecast: '51.0', previous: '50.2', actual: null, news_item_id: null,
  }];
  const news = [{
    id: 11,
    title: 'Pmi 47.3 vs 51.0 expected',
    actual: '47.3',
    forecast: '51.0',
    currencies: ['GBP'],
    published_at: '2026-10-24T12:00:00.000Z',
  }];
  linkNewsToCalendar(news, events);
  assert.equal(events[0].actual, '47.3');
  assert.equal(news[0].calendar_title, 'S&P Global Manufacturing PMI');
});

test('repairPersistedNews rehidrata actuals y fusiona duplicados http/https', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rn-news-'));
  const db = openDb(join(dir, 't.db'));
  insertNews(db, {
    title: 'http://investinglive.com/news/uk-retail-sales-vs-expected',
    body: 'ACTUAL -0.4% FORECAST 0.1%',
    source: 'InvestingLive', source_id: 'investinglive', source_type: 'agencia',
    url: 'http://investinglive.com/news/uk-retail-sales-vs-expected',
    published_at: '2026-10-24T07:00:00.000Z',
    currencies: ['GBP'], impact: 4, category: 'dato_macro',
    actual: null, forecast: null, previous: null, calendar_title: null,
    fingerprint: 'old-a', z: null, absZ: null,
  });
  insertNews(db, {
    title: 'http://investinglive.com/news/uk-retail-sales-vs-expected',
    body: 'ACTUAL -0.4% FORECAST 0.1%',
    source: 'InvestingLive', source_id: 'investinglive', source_type: 'agencia',
    url: 'https://investinglive.com/news/uk-retail-sales-vs-expected',
    published_at: '2026-10-24T07:00:00.000Z',
    currencies: ['GBP'], impact: 4, category: 'dato_macro',
    actual: null, forecast: null, previous: null, calendar_title: null,
    fingerprint: 'old-b', z: null, absZ: null,
  });
  repairPersistedNews(db);
  const rows = listNews(db, 50);
  assert.equal(rows.length, 1);
  assert.doesNotMatch(rows[0].title, /^https?:/i);
  assert.ok(rows[0].actual);
  const events = [{
    id: 'ret-gb', title: 'Retail Sales m/m', currency: 'GBP',
    event_at: '2026-10-24T06:00:00.000Z', impact: 'High',
    forecast: '0.1%', previous: '0.5%', actual: null, news_item_id: null,
  }];
  upsertCalendar(db, events, '2026-10-20');
  linkNewsToCalendar(listNews(db, 50), events);
  persistCalendarLinks(db, events);
  assert.equal(listCalendar(db)[0].actual, rows[0].actual);
  upsertCalendar(db, [{ ...events[0], actual: null }], '2026-10-20');
  assert.equal(listCalendar(db)[0].actual, rows[0].actual);
});

test('Impulso 3h es nulo si no hay prints en la ventana, no un cero fingido', () => {
  const now = Date.parse('2026-10-24T12:00:00Z');
  const rows = attachRanks(classifyAgent([{
    title: 'US payrolls beat ACTUAL 250 FORECAST 160',
    currencies: ['USD'], actual: '250', forecast: '160',
    source_type: 'breaking', category: 'dato_macro', impact: 4,
    fingerprint: 'pay', published_at: new Date(now - 10 * 3600_000).toISOString(),
  }], now));
  const usd = rows.find((r) => r.currency === 'USD');
  assert.equal(usd.impulse, null);
  const dir = mkdtempSync(join(tmpdir(), 'rn-sc-'));
  const db = openDb(join(dir, 't.db'));
  saveScores(db, 'agente', [usd], 'b1', new Date(now).toISOString(), '');
  const snap = latestEngine(db, 'agente');
  assert.equal(snap.rows[0].impulse, null);
});

test('un titular oficial usa gramática singular y no URL de driver', () => {
  const now = Date.parse('2026-10-24T12:00:00Z');
  const rows = classifyAgent([{
    title: 'https://investinglive.com/news/canada-august-retail-sales-v',
    currencies: ['CAD'], source_type: 'oficial', category: 'dato_macro',
    impact: 2, fingerprint: 'u', published_at: new Date(now - 20 * 60_000).toISOString(),
  }], now);
  const cad = rows.find((r) => r.currency === 'CAD');
  assert.match(cad.rationale, /1 titular\b/);
  assert.doesNotMatch(cad.rationale, /1 titulares/);
  assert.ok(cad.drivers.every((d) => !/^https?:/i.test(d)));
});

test('listNews no duplica documentos equivalentes ni rejuvenece Fed guardada mal', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rn-list-'));
  const db = openDb(join(dir, 't.db'));
  insertNews(db, {
    title: 'Federal Reserve issues FOMC statement',
    body: '', source: 'Fed', source_id: 'fed', source_type: 'oficial',
    url: 'https://www.federalreserve.gov/newsevents/pressreleases/monetary20260916a.htm',
    published_at: '2026-10-24T00:10:00.000Z',
    currencies: ['USD'], impact: 3, category: 'banco_central',
    actual: null, forecast: null, previous: null, calendar_title: null,
    fingerprint: 'fed-wrong-date', z: null, absZ: null,
  });
  const n = listNews(db, 10)[0];
  assert.match(n.published_at, /^2026-09-16/);
  const horizon = recentNews(db, '2026-09-01T00:00:00.000Z');
  assert.equal(horizon.length, 1);
});

test('el mismo post FJ canal vs mensaje colapsa al permalink', () => {
  const title = 'Iran President Pezeshkian blames US for interim deal failure';
  const channel = 'https://t.me/FinancialJuice';
  const msg = 'https://t.me/FinancialJuice/142490';
  assert.equal(fingerprint(title, channel), fingerprint(title, msg));
  const rows = dedupeNews([
    { title, url: channel, source: 'FinancialJuice' },
    { title, url: msg, source: 'FinancialJuice' },
  ]);
  assert.equal(rows.length, 1);
  assert.match(rows[0].url, /142490/);
  const html = `<div class="tgme_widget_message_wrap">
    <div class="tgme_widget_message_text">${title}</div>
    <time datetime="2026-10-24T12:00:00+00:00"></time>
    <a href="https://t.me/FinancialJuice">channel</a>
  </div>
  <div class="tgme_widget_message_wrap">
    <div class="tgme_widget_message_text">${title}</div>
    <time datetime="2026-10-24T12:00:00+00:00"></time>
    <a href="https://t.me/FinancialJuice/142490">permalink</a>
  </div>`;
  const parsed = parseTelegram(html);
  assert.equal(parsed.length, 1);
  assert.match(parsed[0].url, /142490/);
});

test('InvestingLive misma URL con titular distinto no se cuenta dos veces', () => {
  const url = 'https://investinglive.com/news/us-s-p-global-flash-october-services-pmi-57-9-vs-58-0-expected';
  assert.equal(
    fingerprint('US S&P Global flash October services PMI 57.9 vs 58.0 expected', url),
    fingerprint('Us s p global flash october services pmi 57.9 vs 58.0 expected', url),
  );
});

test('PMI alemán no hidrata el evento francés; services no hidrata manufacturing', () => {
  const events = [
    { id: 'fr-mfg', title: 'French Flash Manufacturing PMI', currency: 'EUR', event_at: '2026-10-23T07:15:00.000Z', impact: 'High', forecast: '50.5', previous: '50.0', actual: null, news_item_id: null },
    { id: 'fr-svc', title: 'French Flash Services PMI', currency: 'EUR', event_at: '2026-10-23T07:15:00.000Z', impact: 'High', forecast: '50.7', previous: '51.0', actual: null, news_item_id: null },
    { id: 'de-mfg', title: 'German Flash Manufacturing PMI', currency: 'EUR', event_at: '2026-10-23T07:30:00.000Z', impact: 'High', forecast: '53.5', previous: '53.0', actual: null, news_item_id: null },
    { id: 'us-mfg', title: 'Flash Manufacturing PMI', currency: 'USD', event_at: '2026-10-23T13:45:00.000Z', impact: 'High', forecast: '55.4', previous: '55.0', actual: null, news_item_id: null },
    { id: 'us-svc', title: 'Flash Services PMI', currency: 'USD', event_at: '2026-10-23T13:45:00.000Z', impact: 'High', forecast: '58.0', previous: '58.8', actual: null, news_item_id: null },
  ];
  const news = [
    { id: 1, title: 'Germany October flash manufacturing PMI 54.2 vs 53.5 expected', actual: '54.2', forecast: '53.5', currencies: ['EUR'], published_at: '2026-10-23T12:00:00.000Z' },
    { id: 2, title: 'US S&P Global flash October services PMI 57.9 vs 58.0 expected', actual: '57.9', forecast: '58.0', currencies: ['USD'], published_at: '2026-10-23T14:00:00.000Z' },
  ];
  linkNewsToCalendar(news, events);
  assert.equal(events.find((e) => e.id === 'de-mfg').actual, '54.2');
  assert.equal(news[0].calendar_title, 'German Flash Manufacturing PMI');
  assert.notEqual(events.find((e) => e.id === 'fr-mfg').actual, '54.2');
  assert.equal(events.find((e) => e.id === 'us-svc').actual, '57.9');
  assert.equal(news[1].calendar_title, 'Flash Services PMI');
  assert.equal(events.find((e) => e.id === 'us-mfg').actual, null);
});

test('IDs de YouTube de Negocios TV no entran como geopolítica', () => {
  const skip = {
    title: 'SXFbIJ 06Qw',
    source: 'Negocios TV',
    currencies: [],
    source_type: 'agencia',
    category: 'geopolitica',
  };
  assert.equal(isRelevant(skip), false);
});

test('Hormuz sí es refugio; aviso civil saudí no mueve CHF', () => {
  const now = Date.parse('2026-10-24T12:00:00Z');
  const civil = enrichRaw({
    title: 'Saudi civil defense issues warning of potential hazard in Jeddah',
    url: 'https://t.me/FinancialJuice/1',
    body: '',
    published_at: '2026-10-24T11:00:00Z',
  }, FJ);
  assert.equal(civil.currencies.length, 0);
  const hormuz = enrichRaw({
    title: 'Missile attack closes Hormuz, war risk',
    url: 'https://t.me/FinancialJuice/2',
    body: '',
    published_at: '2026-10-24T11:05:00Z',
  }, FJ);
  assert.ok(hormuz.currencies.includes('CHF'));
  const rows = classifyAgent([
    { ...civil, currencies: civil.currencies, source_type: 'breaking', impact: 3, fingerprint: 'c', published_at: new Date(now - 20 * 60_000).toISOString() },
    { ...hormuz, currencies: hormuz.currencies, source_type: 'breaking', category: 'geopolitica', impact: 5, fingerprint: 'h', published_at: new Date(now - 10 * 60_000).toISOString() },
  ], now);
  const chf = rows.find((r) => r.currency === 'CHF');
  assert.ok(chf.score > 0);
  assert.ok(chf.score < 100);
});

test('SECO HTML enlaza el comunicado, no el listing', () => {
  const html = `<h3>Switzerland and Vietnam strengthen ties in trade, investment and innovation</h3>
    <a class="btn" href="/en/newnsb/nFr5JFmp-iss" aria-label="More about «Switzerland and Vietnam strengthen ties in trade, investment and innovation»"></a>`;
  const items = parseHtmlList(html, 'https://www.seco.admin.ch/en/press-releases');
  assert.ok(items.length >= 1);
  assert.match(items[0].url, /newnsb\/nFr5JFmp-iss/);
  assert.doesNotMatch(items[0].url, /press-releases$/);
});

test('SECO toma la fecha del comunicado, no la del scrape', () => {
  const html = `
    <div class="card">
      <p class="meta-info"><span class="meta-info__item">17 September 2026</span></p>
      <div class="card__title"><h3>Economic forecast: 2026 growth stronger than previously expected</h3></div>
      <a href="/en/newnsb/JUhtHgdQzukb" aria-label="More about «Economic forecast: 2026 growth stronger than previously expected»"></a>
    </div>
    <div class="card">
      <p class="meta-info"><span class="meta-info__item">14 October 2026</span></p>
      <div class="card__title"><h3>New agreement on digital trade</h3></div>
      <a href="/en/newnsb/cX62ZqR2mreH" aria-label="More about «New agreement on digital trade»"></a>
    </div>`;
  const items = parseHtmlList(html, 'https://www.seco.admin.ch/en/press-releases');
  const growth = items.find((x) => /economic forecast/i.test(x.title));
  const trade = items.find((x) => /digital trade/i.test(x.title));
  assert.ok(growth && trade, items.map((x) => x.title).join(' | '));
  assert.match(growth.published_at, /^2026-09-17/);
  assert.match(trade.published_at, /^2026-10-14/);
  assert.doesNotMatch(growth.published_at, /^2026-10-24/);
});

test('insertNews corrige una fecha de scrape si llega la fecha real más antigua', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rn-seco-'));
  const db = openDb(join(dir, 't.db'));
  const base = {
    title: 'Economic forecast: 2026 growth stronger than previously expected',
    body: '', source: 'SECO', source_id: 'seco', source_type: 'oficial',
    url: 'https://www.seco.admin.ch/en/newnsb/JUhtHgdQzukb',
    currencies: ['CHF'], impact: 2, category: 'dato_macro',
    actual: null, forecast: null, previous: null, calendar_title: null,
    fingerprint: 'seco-growth', z: null, absZ: null,
  };
  insertNews(db, { ...base, published_at: '2026-10-24T15:16:39.150Z' });
  insertNews(db, { ...base, published_at: '2026-09-17T12:00:00.000Z' });
  const row = listNews(db, 10)[0];
  assert.match(row.published_at, /^2026-09-17/);
});

test('dedupeNews colapsa listing SECO y comunicado con el mismo título', () => {
  const rows = dedupeNews([
    { title: 'Economic forecast: 2026 growth stronger than previously expected', url: 'https://www.seco.admin.ch/en/press-releases', source: 'SECO', source_id: 'seco', published_at: '2026-10-24T15:00:00.000Z' },
    { title: 'Economic forecast: 2026 growth stronger than previously expected', url: 'https://www.seco.admin.ch/en/newnsb/JUhtHgdQzukb', source: 'SECO', source_id: 'seco', published_at: '2026-09-17T12:00:00.000Z' },
  ]);
  assert.equal(rows.length, 1);
  assert.match(rows[0].url, /newnsb/);
  assert.match(rows[0].published_at, /^2026-09-17/);
});

test('refreshFeed ejecuta únicamente Agente MMT y retira el ciclo Gemini', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../src/refreshFeed.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /publicGemini/);
  assert.doesNotMatch(src, /classifyWithGemini/);
  assert.match(src, /ENGINE_NAME/);
});
