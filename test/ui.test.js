import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { ENGINE_NAME } from '../src/config.js';
import { lookupMarketPair, pairRiskHtml, riskMapBoardHtml } from '../public/app.js';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

test('el mapa de riesgo no muestra Soporte/Presión ni lenguaje de ejecución', () => {
  assert.equal(ENGINE_NAME, 'Agente MMT');
  assert.match(app, /Agente MMT/);
  assert.doesNotMatch(app, /Sesgo Largo/);
  assert.doesNotMatch(app, /vía libre operativa/);
  const html = riskMapBoardHtml([
    { currency: 'USD', risk_level: 'ALTO', lock_level: 'TOTAL', reasons: ['decisión de tipos'], silence: false },
    { currency: 'EUR', risk_level: 'MEDIO', lock_level: 'NO_AMPLIAR', reasons: ['discurso'] },
    { currency: 'XAU', risk_level: 'BAJO', lock_level: 'NINGUNO', reasons: [] },
  ]);
  assert.match(html, /USD/);
  assert.match(html, /ALTO/);
  assert.match(html, /MEDIO/);
  assert.match(html, /BAJO/);
  assert.match(html, /<button/);
  assert.doesNotMatch(html, /Soporte|Presión|class="score"|class="rank"|sesgo|vía libre|\bcompra\b|\bvende\b|subirá|bajará|\blong\b|\bshort\b/i);
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

test('el mapa de riesgo no aprieta el nivel y la razón en una línea nowrap', () => {
  assert.match(app, /riskMapBoardHtml/);
  assert.match(app, /class="ccy-meta"/);
  assert.match(app, /class="driver"/);
  assert.doesNotMatch(app, /ccy-sub/);
  const html = riskMapBoardHtml([
    { currency: 'JPY', risk_level: 'ALTO', lock_level: 'TIER1', reasons: ['intervención en 24 h'] },
  ]);
  assert.match(html, /class="ccy-meta"/);
  assert.match(html, /class="driver"/);
  assert.match(html, /title="intervención en 24 h"/);
  assert.doesNotMatch(html, /class="rank"|class="score"/);
  const css = readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');
  assert.match(css, /ccy-meta/);
  assert.match(css, /-webkit-line-clamp:\s*[12]\b/);
  assert.doesNotMatch(css, /\.ccy-sub \.driver \{[^}]*white-space:\s*nowrap/);
});

test('los pares del mapa no venden flujo ni dejan el spot en blanco', () => {
  assert.doesNotMatch(app, /Flujo confirmado/);
  assert.match(app, /sin precio/);
  assert.match(app, /datos degradados/i);
  const html = pairRiskHtml([
    { pair: 'EURUSD', risk_level: 'ALTO', lock_level: 'TOTAL' },
    { pair: 'USDJPY', risk_level: 'BAJO', lock_level: 'NINGUNO' },
  ]);
  assert.match(html, /EURUSD/);
  assert.match(html, /ALTO · TOTAL/);
  assert.match(html, /BAJO/);
  assert.doesNotMatch(html, /Soporte|Presión|más fuerte|▲|▼|Flujo confirmado|class="score"/i);
  const inv = lookupMarketPair({ 'USD/CHF': { rate: 0.85, changePct: 0.4 } }, 'CHF', 'USD');
  assert.equal(inv.changePct, -0.4);
});

test('interfaz de notificaciones verifica suscripción real y distingue aceptada por push vs mostrada en dispositivo', () => {
  assert.match(app, /verifyBrowserSubscriptionState/);
  assert.match(app, /accepted_by_push_service/);
  assert.match(app, /displayed_on_device/);
  assert.match(html, /Programar prueba en 30 s/);
});
