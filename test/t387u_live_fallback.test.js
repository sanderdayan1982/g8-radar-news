import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { formatFuenteNoResponde } from '../public/app.js';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

function fetchDashboardStateSource() {
  const start = app.indexOf('async function fetchDashboardState');
  assert.ok(start >= 0, 'falta fetchDashboardState');
  const end = app.indexOf('let pendingLoad', start);
  assert.ok(end > start, 'no se pudo recortar fetchDashboardState');
  return app.slice(start, end);
}

test('t387u: al abrir, la mesa lee /api/radar-full y, si falla, GitHub raw de main', () => {
  const body = fetchDashboardStateSource();
  assert.match(body, /\/api\/radar-full/);
  assert.match(body, /GITHUB_RAW_FALLBACK/);
  assert.match(app, /raw\.githubusercontent\.com\/sanderdayan1982\/g8-radar-news\/main\/public\/data\/radar_news_full\.json/);
});

test('t387u: fetchDashboardState no usa la copia estática empaquetada', () => {
  const body = fetchDashboardStateSource();
  assert.doesNotMatch(body, /\/data\/radar_news_full\.json/);
  assert.doesNotMatch(body, /fallback to local static/);
});

test('t387u: si la fuente no responde, el aviso lleva la hora del último dato en WAT', () => {
  const msg = formatFuenteNoResponde('2026-11-25T21:28:00.971Z');
  assert.match(msg, /Fuente no responde/);
  assert.match(msg, /Último dato/);
  assert.match(msg, /WAT/);
  assert.match(msg, /22:28/);
  const empty = formatFuenteNoResponde(null);
  assert.match(empty, /Fuente no responde/);
  assert.match(empty, /No hay un dato previo en esta sesión/);
  const bad = formatFuenteNoResponde('no-es-una-fecha');
  assert.match(bad, /No hay un dato previo en esta sesión/);
});

test('t387u: la banda de error usa formatFuenteNoResponde y no presenta el estático como actual', () => {
  assert.match(app, /textContent=formatFuenteNoResponde\(lastDataIso/);
  assert.doesNotMatch(app, /Mostrando la última lectura; reintentamos automáticamente/);
});
