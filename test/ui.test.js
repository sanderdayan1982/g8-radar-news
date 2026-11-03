import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { BIAS_LABEL, BIAS_THRESHOLD, ENGINE_NAME } from '../src/config.js';
import { hasComparableScore, lookupMarketPair } from '../public/app.js';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

test('UI muestra Soporte/Presión/N/D y Agente MMT como motor único, sin sesgo de ejecución', () => {
  assert.equal(BIAS_LABEL.alcista, 'Soporte');
  assert.equal(BIAS_LABEL.bajista, 'Presión');
  assert.equal(BIAS_THRESHOLD, 12);
  assert.equal(ENGINE_NAME, 'Agente MMT');
  assert.match(app, /BIAS_LABEL|Soporte/);
  assert.match(app, /Agente MMT/);
  assert.doesNotMatch(app, /Sesgo Largo/);
  assert.doesNotMatch(app, /vía libre operativa/);
  assert.match(app, /Soporte relativo|Ficha comparativa/i);
});

test('Gemini y Consenso han sido completamente retirados de la interfaz y archivos activos', () => {
  assert.equal(existsSync(new URL('../src/llm.js', import.meta.url)), false);
  assert.equal(existsSync(new URL('../public/consensus.js', import.meta.url)), false);
  assert.doesNotMatch(html, /gemini-form/i);
  assert.doesNotMatch(html, /gemini-hint/i);
  assert.doesNotMatch(html, /Modo degradado: solo Agente/i);
  assert.doesNotMatch(app, /Modo degradado: solo Agente/i);
  assert.doesNotMatch(app, /classifyWithGemini/i);
  assert.match(html, /Ranking de divisas · Agente MMT/);
});

test('ranking no aprieta meta y driver en una sola línea nowrap', () => {
  assert.match(app, /class="ccy-meta"/);
  assert.match(app, /class="driver"/);
  assert.match(app, /function cleanRationale/);
  assert.doesNotMatch(app, /ccy-sub/);
  const css = readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');
  assert.match(css, /ccy-meta/);
  assert.match(css, /-webkit-line-clamp:\s*2/);
  assert.doesNotMatch(css, /\.ccy-sub \.driver \{[^}]*white-space:\s*nowrap/);
});

test('cruces no venden Flujo confirmado ni dejan el spot en blanco', () => {
  assert.doesNotMatch(app, /Flujo confirmado/);
  assert.match(app, /Alineado con spot/);
  assert.match(app, /sin precio/);
  assert.match(app, /datos degradados/i);
  assert.match(app, /fmtImpulse/);
  assert.match(app, /BIAS_THRESHOLD = 12/);
  assert.equal(hasComparableScore({ score: 25, noEvidence: false }), true);
  assert.equal(hasComparableScore({ score: 0, noEvidence: true }), false);
  const inv = lookupMarketPair({ 'USD/CHF': { rate: 0.85, changePct: 0.4 } }, 'CHF', 'USD');
  assert.equal(inv.changePct, -0.4);
});

test('interfaz de notificaciones verifica suscripción real y distingue aceptada por push vs mostrada en dispositivo', () => {
  assert.match(app, /verifyBrowserSubscriptionState/);
  assert.match(app, /accepted_by_push_service/);
  assert.match(app, /displayed_on_device/);
  assert.match(html, /Programar prueba en 30 s/);
});
