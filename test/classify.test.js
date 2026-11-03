import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyAgent, attachRanks, isNoEvidence, rankingAlerts, biasFor, MOSLER_RULES,
} from '../src/classifyCurrencies.js';

const now = Date.parse('2026-10-24T00:00:00Z');
const t = (minsAgo, extra) => ({
  title: extra.title,
  body: extra.body || '',
  currencies: extra.currencies,
  source_type: extra.source_type || 'breaking',
  category: extra.category || 'dato_macro',
  actual: extra.actual ?? null,
  forecast: extra.forecast ?? null,
  previous: extra.previous ?? null,
  impact: extra.impact ?? 4,
  fingerprint: extra.fingerprint || extra.title.slice(0, 12),
  published_at: new Date(now - minsAgo * 60_000).toISOString(),
  absZ: extra.absZ,
});

test('CPI alto con economía débil no suma soporte', () => {
  const rows = attachRanks(classifyAgent([
    t(30, { title: 'UK CPI ACTUAL 3.8% FORECAST 3.2% PREVIOUS 3.1%', currencies: ['GBP'], actual: '3.8', forecast: '3.2', previous: '3.1' }),
    t(40, { title: 'UK retail sales miss: contraction, weak economy', currencies: ['GBP'], actual: '-0.7', forecast: '0.2', category: 'dato_macro' }),
    t(50, { title: 'UK PMI services falls below 50, slowdown', currencies: ['GBP'], actual: '48.1', forecast: '51.0' }),
  ], now));
  const gbp = rows.find((r) => r.currency === 'GBP');
  assert.ok(gbp.drivers.some((d) => /escasez relativa|no NFA/i.test(d)));
  assert.ok(gbp.score <= 0, `CPI+debilidad no puede ser soporte, score=${gbp.score}`);
});

test('CPI alto con economía en capacidad queda acotado; el dato real manda', () => {
  const rows = classifyAgent([
    t(20, { title: 'US CPI ACTUAL 3.4% FORECAST 3.1%', currencies: ['USD'], actual: '3.4', forecast: '3.1' }),
    t(25, { title: 'US payrolls beat, hot labor market expansion', currencies: ['USD'], actual: '250', forecast: '160' }),
    t(35, { title: 'US PMI jumps above 52, strong growth', currencies: ['USD'], actual: '56.0', forecast: '52.0' }),
  ], now);
  const usd = rows.find((r) => r.currency === 'USD');
  assert.ok(usd.score > 20, `dato real debe mover el score, got ${usd.score}`);
  assert.ok(usd.score <= 80);
  assert.ok(!usd.drivers.some((d) => /escasez relativa/i.test(d)));
  assert.ok(usd.drivers.some((d) => /labor|PMI|dato real|expansión|payroll/i.test(d)));
});

test('titular de déficit/downgrade no es presión automática (Mosler)', () => {
  const rows = classifyAgent([
    t(15, { title: 'France deficit cannot afford spending, downgrade fears', currencies: ['EUR'], category: 'analisis', impact: 3 }),
  ], now);
  const eur = rows.find((r) => r.currency === 'EUR');
  assert.equal(eur.score, 0);
  assert.ok(eur.drivers.some((d) => /déficit no es restricción/i.test(d)));
});

test('hike en régimen débil/cost-push no es soporte', () => {
  const rows = classifyAgent([
    t(10, { title: 'BoE hike as stagflation unsustainable economy persists', currencies: ['GBP'], category: 'banco_central' }),
    t(20, { title: 'UK CPI ACTUAL 4.1% FORECAST 3.5% weak economy', currencies: ['GBP'], actual: '4.1', forecast: '3.5' }),
    t(30, { title: 'UK PMI contracts below 50, recession fears', currencies: ['GBP'], actual: '47.0', forecast: '50.2' }),
  ], now);
  const gbp = rows.find((r) => r.currency === 'GBP');
  assert.ok(gbp.score <= 0, `hike+cost-push score=${gbp.score}`);
});

test('does not hike se trata como negación, no hawkish', () => {
  const rows = classifyAgent([
    t(12, { title: "Fed doesn't hike, holds rates", currencies: ['USD'], category: 'banco_central' }),
  ], now);
  const usd = rows.find((r) => r.currency === 'USD');
  assert.ok(usd.score <= 0);
});

test('desempleo invertido: alta vs forecast es presión', () => {
  const rows = classifyAgent([
    t(8, { title: 'US unemployment ACTUAL 4.5% FORECAST 4.1%', currencies: ['USD'], actual: '4.5', forecast: '4.1' }),
  ], now);
  const usd = rows.find((r) => r.currency === 'USD');
  assert.ok(usd.score < 0);
});

test('oficial de hace 20 días sigue en ventana (30 d), breaking de 20 días no', () => {
  const oldOff = t(20 * 24 * 60, { title: 'Updates to the October Monetary Policy Review', currencies: ['NZD'], source_type: 'oficial', category: 'banco_central', impact: 2 });
  const oldBrk = t(20 * 24 * 60, { title: 'Kiwi CPI miss ACTUAL 1.0 FORECAST 2.0', currencies: ['NZD'], actual: '1.0', forecast: '2.0' });
  const rows = attachRanks(classifyAgent([oldOff, oldBrk], now));
  const nzd = rows.find((r) => r.currency === 'NZD');
  assert.equal(nzd.noEvidence, false);
});

test('titular oficial de política cuenta como evidencia aunque el score sea 0', () => {
  const rows = attachRanks(classifyAgent([
    t(20, { title: 'Updates to the October Monetary Policy Review', currencies: ['NZD'], source_type: 'oficial', category: 'banco_central', impact: 2 }),
  ], now));
  const nzd = rows.find((r) => r.currency === 'NZD');
  assert.equal(nzd.noEvidence, false);
  assert.equal(typeof nzd.rank, 'number');
  assert.ok(nzd.drivers[0]);
  assert.ok(!/^sin catalizadores/i.test(nzd.drivers[0]));
});

test('sin titulares: N/D, score 0, rank null, no alerta de régimen', () => {
  const rows = attachRanks(classifyAgent([
    t(5, { title: 'US payrolls beat ACTUAL 250 FORECAST 160', currencies: ['USD'], actual: '250', forecast: '160' }),
  ], now));
  const chf = rows.find((r) => r.currency === 'CHF');
  const nzd = rows.find((r) => r.currency === 'NZD');
  assert.equal(chf.rank, null);
  assert.equal(nzd.rank, null);
  assert.equal(chf.score, 0);
  assert.ok(isNoEvidence(chf));
  const prev = rows.map((r) => ({ ...r }));
  const next = rows.map((r) => ({ ...r, bias: r.currency === 'CHF' ? 'alcista' : r.bias, score: r.currency === 'CHF' ? 0 : r.score }));
  const alerts = rankingAlerts(prev, next, 'Agente');
  assert.ok(!alerts.some((a) => a.currency === 'CHF' && a.alert_type === 'cambio_regimen'));
});

test('refugio geopolítico: USD/JPY/CHF soporte, NZD presión', () => {
  const rows = classifyAgent([
    t(6, { title: 'Missile attack closes Hormuz, war risk', currencies: ['USD', 'JPY', 'CHF', 'NZD'], category: 'geopolitica', impact: 5 }),
  ], now);
  assert.ok(rows.find((r) => r.currency === 'CHF').score > 0);
  assert.ok(rows.find((r) => r.currency === 'NZD').score < 0);
});

test('máximo 3 drivers y sesgo por umbral ±12', () => {
  const items = Array.from({ length: 8 }, (_, i) => t(10 + i, {
    title: `US payrolls beat ACTUAL ${200 + i} FORECAST 100`,
    currencies: ['USD'],
    actual: String(200 + i),
    forecast: '100',
  }));
  const usd = classifyAgent(items, now).find((r) => r.currency === 'USD');
  assert.ok(usd.drivers.length <= 3);
  assert.equal(biasFor(13), 'alcista');
  assert.equal(biasFor(-13), 'bajista');
  assert.equal(biasFor(12), 'neutral');
  assert.equal(biasFor(0), 'neutral');
});

test('prompt Mosler veta CPI+debilidad y lenguaje de ejecución', () => {
  assert.match(MOSLER_RULES, /CPI\/inflación ALTO con economía DÉBIL/);
  assert.match(MOSLER_RULES, /Prohibido "long"/);
  assert.match(MOSLER_RULES, /fingerprint/);
  assert.match(MOSLER_RULES, /CPI NO es el motor único/);
});

test('inflación + tightening no se traga como CPI 0: BoJ puntúa política', () => {
  const rows = classifyAgent([
    t(25, {
      title: 'September inflation keeps BoJ on tightening course',
      currencies: ['JPY'],
      category: 'banco_central',
      source_type: 'oficial',
    }),
  ], now);
  const jpy = rows.find((r) => r.currency === 'JPY');
  assert.ok(jpy.score > 0, `tightening no puede quedar en 0, score=${jpy.score}`);
  assert.ok(jpy.drivers.some((d) => /precio del dinero|tightening|alza/i.test(d)));
});

test('oficial hawkish de hace 20 días todavía puntúa, no solo evidencia', () => {
  const rows = attachRanks(classifyAgent([
    t(20 * 24 * 60, {
      title: 'RBNZ MPS: OCR remains restrictive, inflation persistent',
      currencies: ['NZD'],
      source_type: 'oficial',
      category: 'banco_central',
      impact: 3,
    }),
  ], now));
  const nzd = rows.find((r) => r.currency === 'NZD');
  assert.equal(nzd.noEvidence, false);
  assert.ok(nzd.score > 0, `oficial 20d debe puntuar, score=${nzd.score}`);
});

test('FOMC restrictive/assessment hawkish no es Neutral 0', () => {
  const rows = classifyAgent([
    t(40, {
      title: 'FOMC statement: Committee remains vigilant, policy restrictive',
      currencies: ['USD'],
      source_type: 'oficial',
      category: 'banco_central',
    }),
  ], now);
  const usd = rows.find((r) => r.currency === 'USD');
  assert.ok(usd.score > 0, `FOMC restrictive score=${usd.score}`);
});

test('colapso de confianza es presión, distribución de beneficios es NFA', () => {
  const rows = classifyAgent([
    t(15, { title: "Relentless cost of living pressures behind collapse of consumer confidence", currencies: ['GBP'], category: 'analisis' }),
    t(20, { title: 'SNB profit distribution to Confederation and cantons', currencies: ['CHF'], source_type: 'oficial', category: 'banco_central' }),
  ], now);
  const gbp = rows.find((r) => r.currency === 'GBP');
  const chf = rows.find((r) => r.currency === 'CHF');
  assert.ok(gbp.score < 0, `confianza score=${gbp.score}`);
  assert.equal(gbp.bias, 'bajista');
  assert.ok(chf.score > 0, `NFA distribución score=${chf.score}`);
});

test('Agente diferencia divisas con evidencia: no todas Neutral 0', () => {
  const rows = attachRanks(classifyAgent([
    t(10, { title: 'BoJ on tightening course as inflation persists', currencies: ['JPY'], category: 'banco_central', source_type: 'oficial' }),
    t(12, { title: 'UK consumer confidence collapses under cost of living pressures', currencies: ['GBP'] }),
    t(14, { title: 'France deficit cannot afford spending, downgrade fears', currencies: ['EUR'], category: 'analisis' }),
    t(16, { title: 'SECO raises growth forecast, revisión al alza del crecimiento', currencies: ['CHF'], source_type: 'oficial' }),
  ], now));
  const jpy = rows.find((r) => r.currency === 'JPY');
  const gbp = rows.find((r) => r.currency === 'GBP');
  const eur = rows.find((r) => r.currency === 'EUR');
  const chf = rows.find((r) => r.currency === 'CHF');
  assert.ok(jpy.score > 0);
  assert.ok(gbp.score < 0);
  assert.equal(eur.score, 0);
  assert.ok(chf.score > 0);
  assert.ok(new Set([jpy.score, gbp.score, eur.score, chf.score]).size >= 3);
});

test('empleo y PMI sin CPI mueven el Agente (dato real es motor)', () => {
  const rows = classifyAgent([
    t(8, { title: 'US payrolls beat ACTUAL 250 FORECAST 160', currencies: ['USD'], actual: '250', forecast: '160' }),
    t(10, { title: 'US ISM services PMI jumps above 52, expansion', currencies: ['USD'], actual: '56.0', forecast: '52.0' }),
  ], now);
  const usd = rows.find((r) => r.currency === 'USD');
  assert.ok(usd.score > 20, `empleo+PMI score=${usd.score}`);
  assert.ok(!usd.drivers.some((d) => /CPI|inflación|escasez/i.test(d)));
  assert.ok(usd.drivers.some((d) => /labor|PMI|dato real|expansión/i.test(d)));
});

test('NFA y comercio puntúan sin ningún titular de inflación', () => {
  const rows = classifyAgent([
    t(12, { title: 'SNB profit distribution to Confederation and cantons', currencies: ['CHF'], source_type: 'oficial', category: 'banco_central' }),
    t(18, { title: 'Switzerland and Vietnam strengthen ties in trade, new agreement on digital trade', currencies: ['CHF'], category: 'analisis' }),
  ], now);
  const chf = rows.find((r) => r.currency === 'CHF');
  assert.ok(chf.score > 15, `NFA+comercio score=${chf.score}`);
  assert.ok(chf.drivers.some((d) => /NFA|distribución/i.test(d)));
  assert.ok(chf.drivers.some((d) => /comercial|exterior/i.test(d)));
  assert.ok(!chf.drivers.some((d) => /CPI|inflación/i.test(d)));
});

test('desempleo y ventas mueven el score sin CPI', () => {
  const rows = classifyAgent([
    t(9, { title: 'Canada retail sales miss ACTUAL -0.4 FORECAST 0.3', currencies: ['CAD'], actual: '-0.4', forecast: '0.3' }),
    t(11, { title: 'Canada unemployment ACTUAL 7.1% FORECAST 6.6%', currencies: ['CAD'], actual: '7.1', forecast: '6.6' }),
  ], now);
  const cad = rows.find((r) => r.currency === 'CAD');
  assert.ok(cad.score < -10, `dato real CAD score=${cad.score}`);
  assert.ok(!cad.drivers.some((d) => /CPI|inflación/i.test(d)));
});

test('Baker Hughes y TIPS son operacionales: no son dato real ni Imp 3h', () => {
  const rows = classifyAgent([
    t(20, {
      title: 'US BAKER HUGHES OIL RIG COUNT ACTUAL 460 (FORECAST -, PREVIOUS 459)',
      currencies: ['USD'], actual: '460', previous: '459', category: 'dato_macro',
    }),
    t(25, {
      title: 'US 5-YEAR TIPS HIGH YIELD ACTUAL 2.367% (FORECAST -, PREVIOUS 1.955%)',
      currencies: ['USD'], actual: '2.367%', previous: '1.955%', category: 'dato_macro',
    }),
  ], now);
  const usd = rows.find((r) => r.currency === 'USD');
  assert.ok(!usd.drivers.some((d) => /dato real/i.test(d)), usd.drivers.join(' | '));
  assert.equal(usd.impulse, null);
});
