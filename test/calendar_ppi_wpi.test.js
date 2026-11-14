import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eventFamily, linkNewsToCalendar } from '../src/calendar.js';

function agenda() {
  const events = [
    { id: 'de-wpi', title: 'German WPI m/m', currency: 'EUR', event_at: '2026-11-13T07:00:00.000Z', impact: 'Low', forecast: '0.4%', previous: '1.9%', actual: null, news_item_id: null },
    { id: 'chf-ppi', title: 'PPI m/m', currency: 'CHF', event_at: '2026-11-13T07:30:00.000Z', impact: 'Low', forecast: '0.2%', previous: '0.3%', actual: null, news_item_id: null },
    { id: 'cad-ws', title: 'Wholesale Sales m/m', currency: 'CAD', event_at: '2026-11-13T13:30:00.000Z', impact: 'Low', forecast: '0.5%', previous: '-1.6%', actual: null, news_item_id: null },
    { id: 'usd-core', title: 'Core PPI m/m', currency: 'USD', event_at: '2026-11-13T13:30:00.000Z', impact: 'High', forecast: '0.3%', previous: '0.7%', actual: null, news_item_id: null },
    { id: 'usd-ppi', title: 'PPI m/m', currency: 'USD', event_at: '2026-11-13T13:30:00.000Z', impact: 'High', forecast: '0.4%', previous: '1.3%', actual: null, news_item_id: null },
  ];
  const news = [
    { id: 'us-core', title: '❗ US CORE PPI MOM ACTUAL 0.3% (FORECAST 0.3%, PREVIOUS 0.7%) $MACRO', actual: '0.3%', forecast: '0.3%', currencies: ['USD'], published_at: '2026-11-13T13:30:48.000Z' },
    { id: 'us-ppi', title: '❗ US PPI MOM ACTUAL 0.3% (FORECAST 0.4%, PREVIOUS 1.3%) $MACRO', actual: '0.3%', forecast: '0.4%', currencies: ['USD'], published_at: '2026-11-13T13:30:40.000Z' },
    { id: 'chf-ppi', title: 'SWISS PPI MOM ACTUAL 0.9% (FORECAST -, PREVIOUS 0.3%) $MACRO', actual: '0.9%', currencies: ['CHF'], published_at: '2026-11-13T07:30:30.000Z' },
    { id: 'de-wpi', title: 'GERMAN WHOLESALE PRICE INDEX MOM ACTUAL 0.4% (FORECAST -, PREVIOUS 1.9%) $MACRO', actual: '0.4%', currencies: ['EUR'], published_at: '2026-11-13T07:00:34.000Z' },
    { id: 'cad-ws', title: 'CANADIAN WHOLESALE SALES MOM ACTUAL 0.7% (FORECAST 0.5%, PREVIOUS -1.6%) $MACRO', actual: '0.7%', forecast: '0.5%', currencies: ['CAD'], published_at: '2026-11-13T13:30:32.000Z' },
  ];
  linkNewsToCalendar(news, events);
  const event = (id) => events.find((e) => e.id === id);
  const item = (id) => news.find((n) => n.id === id);
  return { event, item };
}

test('US PPI m/m toma el titular PPI y no el Core PPI', () => {
  const { event, item } = agenda();
  assert.equal(event('usd-ppi').actual, '0.3%');
  assert.equal(event('usd-ppi').news_item_id, 'us-ppi');
  assert.equal(item('us-ppi').calendar_title, 'PPI m/m');
  assert.notEqual(event('usd-core').news_item_id, 'us-ppi');
});

test('US Core PPI m/m toma el titular Core PPI y no el PPI general', () => {
  const { event, item } = agenda();
  assert.equal(event('usd-core').actual, '0.3%');
  assert.equal(event('usd-core').news_item_id, 'us-core');
  assert.equal(item('us-core').calendar_title, 'Core PPI m/m');
  assert.notEqual(event('usd-ppi').news_item_id, 'us-core');
});

test('CHF PPI m/m toma el titular Swiss PPI con actual 0.9%', () => {
  const { event, item } = agenda();
  assert.equal(event('chf-ppi').actual, '0.9%');
  assert.equal(event('chf-ppi').news_item_id, 'chf-ppi');
  assert.equal(item('chf-ppi').calendar_title, 'PPI m/m');
});

test('German WPI m/m toma el titular de wholesale price index con actual 0.4%', () => {
  const { event, item } = agenda();
  assert.equal(event('de-wpi').actual, '0.4%');
  assert.equal(event('de-wpi').news_item_id, 'de-wpi');
  assert.equal(item('de-wpi').calendar_title, 'German WPI m/m');
});

test('CAD Wholesale Sales no es wpi y conserva el actual 0.7%', () => {
  assert.equal(eventFamily('CAD Wholesale Sales'), null);
  assert.equal(eventFamily('Wholesale Sales m/m'), null);
  assert.equal(eventFamily('CANADIAN WHOLESALE SALES MOM ACTUAL 0.7% (FORECAST 0.5%, PREVIOUS -1.6%) $MACRO'), null);
  const { event, item } = agenda();
  assert.equal(event('cad-ws').actual, '0.7%');
  assert.equal(event('cad-ws').news_item_id, 'cad-ws');
  assert.equal(item('cad-ws').calendar_title, 'Wholesale Sales m/m');
  assert.equal(event('de-wpi').actual, '0.4%');
  assert.notEqual(event('de-wpi').news_item_id, 'cad-ws');
});
