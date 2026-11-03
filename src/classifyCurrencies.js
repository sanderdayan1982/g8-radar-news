import { rankRows, hasNoEvidence } from '../public/domain.js';
import { CURRENCIES, WINDOWS, BIAS_THRESHOLD } from './config.js';
import { isHistoricalCommemoration } from './enrich.js';

const INVERTED = /unemployment|jobless|claims|paro|desempleo/i;
const CPI = /\b(cpi|inflation|ipc|pce|ppi|lkh|teuerung|preisstabilität)\b/i;
const WEAK = /\b(stagflation|unsustainable|recession|contraction|slowdown|deteriorat|weak economy|economía débil|poco sostenible|pmi (?:falls|drops|contracts)|below 50|retail (?:sales )?(?:miss|fall|drop)|jobless (?:rise|jump)|unemployment (?:rise|up)|confidence (?:collapses?|plunges?|slumps?))\b/i;
const STRONG = /\b(expansion|beat|hot (?:economy|labor)|tight labour|capacity|overheating|pmi (?:jumps|rises)|above 52|payrolls beat|strong growth)\b/i;
const HIKE = /\b(hike|tighten(?:ing)?|hawkish|raises rates|rate rise|higher for longer|restrictive|on tightening)\b/i;
const CUT = /\b(cut rates|dovish|easing|lowers rates|rate cut|accommodative)\b/i;
const NO_HIKE = /\b(doesn['’]?t hike|won't hike|no hike|holds rates|on hold|pausa(?:rá)?)\b/i;
const FISCAL_SCARE = /\b(deficit|debt ceiling|downgrade|cannot afford|austerity|unfunded)\b/i;
const FISCAL_DRAIN = /\b(tax (?:hike|increase)|austerity|spending cut|surplus)\b/i;
const NFA_ADD = /\b(deficit spending|fiscal impulse|profit distribution|bond programme increased|untaxed|distribución de (?:beneficios|utilidades))\b/i;
const GEO_SEVERE = /\b(war|missile|invasion|strike|airstrike|shelling|nuclear|hormuz closed|attack|bomb(?:ing|s|ed)?|explosi(?:on|ve)|blast|shoot(?:ing|s)?|open fire|gunm[ae]n|terror(?:ist)?)\b/i;
const TRADE = /\b(trade balance|current account|exports?|imports?|terms of trade|dairy)\b/i;
const TRADE_DEAL = /\b(trade (?:deal|agreement|ties)|strengthen(?:s|ed)? .{0,28}(?:ties|trade)|digital trade|new agreement on)\b/i;
const GROWTH_UP = /\b(revis(?:ión|ion) al alza|raises? (?:its )?(?:growth|gdp|forecast)|upgrades? (?:growth|gdp)|eleva(?:n)? .{0,28}previsión|growth (?:beats?|accelerat|stronger)|stronger than previously)\b/i;
const GROWTH_DOWN = /\b(revis(?:ión|ion) a la baja|cuts? (?:its )?(?:growth|gdp|forecast)|downgrades? (?:growth|gdp)|growth (?:slows?|miss(?:es)?|contracts?))\b/i;
const CONF_DOWN = /\b(confidence (?:collapses?|plunges?|falls?|slumps?|cracks?)|colapso de (?:la )?confianza|cost of living pressures)\b/i;
const CONF_UP = /\b(confidence (?:jumps?|surges?|rises?|rebounds?))\b/i;
const PMI_UP = /\b(pmi (?:jumps?|rises?|expansion)|services (?:pmi )?(?:in )?expans(?:ion|ión)|expansión sólida|above 5[02])\b/i;
const PMI_DOWN = /\b(pmi (?:falls?|drops?|contracts?)|below 50|contraction)\b/i;
const RETAIL_UP = /\b(retail (?:sales )?(?:beat|jump|rise|surge|hot))\b/i;
const RETAIL_DOWN = /\b(retail (?:sales )?(?:miss|fall|drop|slump|weak))\b/i;
const LABOUR_UP = /\b(payrolls? beat|hot (?:labor|labour)|tight labour|employment (?:beats?|jumps?|rises?))\b/i;
const LABOUR_DOWN = /\b(payrolls? miss|jobless (?:rise|jump)|unemployment (?:rise|up)|claims (?:jump|rise|beat))\b/i;
const REAL = /\b(gdp|pib|pmi|ism|ifo|zew|seco|payroll|nfp|employment|unemployment|jobless|claims|retail|housing|industrial|factory|durable|capacity|confidence|labour|labor|production)\b/i;
const HAWK_TONE = /\b(restrictive|vigilant|inflation persistent|tightening|higher for longer|hawkish|discount rate|assessment .{0,24}(?:tight|restrict))\b/i;
const DOVE_TONE = /\b(patient|easing cycle|dovish|cut rates|accommodative)\b/i;
const POLICY_EVENT = /\b(fomc|minutes|statement|ocr|mps|monetary policy (?:review|report)|assessment|outlook|remarks|press conference|projections)\b/i;
const OPERATIONAL = /\bincreased to|programme decreased|tender|\bbills?\b|auction|repo\b|rig count|baker hughes|bid-to-cover|tips (?:high )?yield/i;
const SAFE = new Set(['USD', 'JPY', 'CHF']);
const BETA = new Set(['AUD', 'NZD', 'CAD']);

export function biasFor(score, threshold = BIAS_THRESHOLD) {
  if (score > threshold) return 'alcista';
  if (score < -threshold) return 'bajista';
  return 'neutral';
}

export const isNoEvidence = hasNoEvidence;

export function clamp(n, lo = -100, hi = 100) {
  return Math.max(lo, Math.min(hi, n));
}

export function parseNum(v) {
  const m = /-?\d+(?:\.\d+)?/.exec(String(v ?? '').replace(/,/g, ''));
  return m ? Number(m[0]) : null;
}

export function surpriseSigned(item) {
  const a = parseNum(item.actual);
  const f = parseNum(item.forecast) ?? parseNum(item.previous);
  if (a == null || f == null || a === f) return 0;
  let dir = a > f ? 1 : -1;
  if (INVERTED.test(item.title || '')) dir = -dir;
  const mag = Math.min(22, 8 + (item.absZ ? item.absZ * 5 : 6));
  return dir * mag;
}

export function detectRealRegime(items, ccy) {
  const mine = items.filter((n) => (n.currencies || []).includes(ccy));
  const blob = mine.map((n) => n.title).join(' · ');
  const weakHits = mine.filter((n) => WEAK.test(n.title) || (parseNum(n.actual) != null && surpriseSigned(n) < 0 && /\b(pmi|gdp|retail|payroll|employment)\b/i.test(n.title))).length;
  const strongHits = mine.filter((n) => STRONG.test(n.title) || (surpriseSigned(n) > 0 && /\b(pmi|gdp|payroll|employment)\b/i.test(n.title) && !INVERTED.test(n.title))).length;
  if (WEAK.test(blob) || weakHits >= 2 && weakHits > strongHits) return 'weak';
  if (strongHits >= 2 && strongHits > weakHits) return 'strong';
  return 'mixed';
}

export const MOSLER_RULES = `Clasificación FX según Soft Currency Economics (Warren Mosler / MMT), no textbook hawkish=long.

INVARIANTES
1. Solo titulares aportados. Prohibido inventar hechos, precios o arrastre regional (un dato de Francia no puntúa NZD).
2. Cada catalizador debe citar el fingerprint o el titular literal.
3. CPI/inflación ALTO con economía DÉBIL, en contracción o poco sostenible NO es soporte de la moneda (canal precio relativo / cost-push). Techo 0 en ese catalizador.
4. El tipo overnight es el PRECIO del dinero (añadir/drenar reservas), no la cantidad. Un hike NO convierte automáticamente la divisa en soporte. En cost-push el hike no suma.
5. El déficit no "financia" gasto; la emisión drena reservas (IRMA). Un titular de déficit/deuda/downgrade NO es presión automática.
6. Interés pagado sobre pasivos públicos es ingreso del no-gobierno (canal NFA). Tratarlo como operacional, no como tightness real.
7. Divisa sin titulares propios: score 0, drivers ["Sin catalizadores en el ciclo"], rationale de evidencia nula. Prohibido rellenar con narrativa de otra región.
8. Lenguaje de mesa, no de ejecución: Soporte / Presión / Neutral / N/D. Prohibido "long", "short", "vía libre operativa", "sesgo largo/corto".
9. Máximo 3 drivers, < 60 caracteres, en español. Score −100..+100. bias interno: alcista>umbral, bajista<-umbral, si no neutral. El umbral es de etiqueta, no de Mosler.
10. Evidencia débil ⇒ rango −40…+40. No fuerces diferencias entre divisas: puntuaciones iguales son válidas si la evidencia lo justifica.
11. El CPI NO es el motor único. Canales en paralelo, mismo peso: NFA/fiscal, dato real (empleo, PIB, PMI, ventas, confianza), sector exterior, precio del dinero, riesgo. El CPI solo pone TECHO de precio relativo (cost-push). Un print de empleo/PMI/PIB sin inflación debe mover el score.`;

function relativePrice(surprise, w, regime, text) {
  if (regime === 'weak' || WEAK.test(text)) {
    return { raw: Math.min(0, surprise) * w, channel: 'RELATIVE_PRICE', driver: 'CPI escasez relativa, no NFA' };
  }
  if (regime === 'strong') {
    return { raw: clamp(surprise * 0.45, -10, 10) * w, channel: 'RELATIVE_PRICE', driver: 'CPI con economía en capacidad' };
  }
  return { raw: clamp(surprise * 0.55, -12, 12) * w, channel: 'RELATIVE_PRICE', driver: surprise ? 'CPI vs consenso' : 'CPI sin sorpresa' };
}

function realEconomy(text, surprise, w, title) {
  const q = (n) => (surprise ? surprise * w : n * w);
  if (GROWTH_UP.test(text)) return { raw: q(16), channel: 'DATA_REAL', driver: 'Revisión al alza del crecimiento' };
  if (GROWTH_DOWN.test(text)) return { raw: q(-16), channel: 'DATA_REAL', driver: 'Revisión a la baja del crecimiento' };
  if (CONF_DOWN.test(text)) return { raw: q(-18), channel: 'DATA_REAL', driver: 'Colapso de confianza / demanda' };
  if (CONF_UP.test(text)) return { raw: q(12), channel: 'DATA_REAL', driver: 'Confianza al alza' };
  if (PMI_DOWN.test(text)) return { raw: q(-16), channel: 'DATA_REAL', driver: 'PMI en contracción' };
  if (PMI_UP.test(text)) return { raw: q(16), channel: 'DATA_REAL', driver: 'PMI en expansión' };
  if (RETAIL_DOWN.test(text)) return { raw: q(-12), channel: 'DATA_REAL', driver: 'Ventas al por menor débiles' };
  if (RETAIL_UP.test(text)) return { raw: q(12), channel: 'DATA_REAL', driver: 'Ventas al por menor fuertes' };
  if (LABOUR_DOWN.test(text) || (INVERTED.test(text) && surprise < 0)) {
    return { raw: q(-14), channel: 'DATA_REAL', driver: 'Mercado laboral suave' };
  }
  if (LABOUR_UP.test(text) || (INVERTED.test(text) && surprise > 0)) {
    return { raw: q(14), channel: 'DATA_REAL', driver: 'Mercado laboral firme' };
  }
  if (surprise) {
    return {
      raw: surprise * w,
      channel: 'DATA_REAL',
      driver: surprise > 0 ? `Dato real fuerte: ${title.slice(0, 120)}` : `Dato real suave: ${title.slice(0, 120)}`,
    };
  }
  return null;
}

function channelAndRaw(item, ccy, regime) {
  const text = `${item.title} ${item.body || ''}`;
  const surprise = surpriseSigned(item);
  const w = item.source_type === 'oficial' ? 1.25 : item.impact >= 4 ? 1.15 : 1;
  const title = item.title || '';
  const policyTone = (HIKE.test(text) || CUT.test(text) || NO_HIKE.test(text) || HAWK_TONE.test(text) || DOVE_TONE.test(text)) && !/tax hike/i.test(text);
  const cpiPrint = CPI.test(text);
  const realHit = REAL.test(text) || GROWTH_UP.test(text) || GROWTH_DOWN.test(text) || CONF_UP.test(text) || CONF_DOWN.test(text);

  // Mosler order: NFA → scare → real economy → trade → geo → policy → CPI veto.
  // CPI never owns a headline that also carries NFA, dato real, or política.

  if (NFA_ADD.test(text)) {
    return { raw: 12 * w, channel: 'FISCAL_NFA', driver: 'Inyección NFA / distribución' };
  }
  if (FISCAL_DRAIN.test(text) && !/cannot afford/i.test(text)) {
    return { raw: -10 * w, channel: 'FISCAL_NFA', driver: 'Drenaje fiscal / superávit' };
  }
  if (FISCAL_SCARE.test(text)) {
    return { raw: 0, channel: 'FISCAL_NFA', driver: 'Déficit no es restricción fiat' };
  }

  if ((item.category === 'mercado' || OPERATIONAL.test(text)) && OPERATIONAL.test(text) && !HIKE.test(text) && !CUT.test(text)) {
    return { raw: 0, channel: 'OPERATIONAL', driver: 'Operaciones / IRMA' };
  }

  if (realHit && !cpiPrint) {
    const hit = realEconomy(text, surprise, w, title);
    if (hit) return hit;
  }
  if (!cpiPrint && (item.actual != null || item.category === 'dato_macro') && surprise) {
    return {
      raw: surprise * w,
      channel: 'DATA_REAL',
      driver: surprise > 0 ? `Dato real fuerte: ${title.slice(0, 120)}` : `Dato real suave: ${title.slice(0, 120)}`,
    };
  }

  if (TRADE.test(text) || TRADE_DEAL.test(text)) {
    if (surprise) return { raw: clamp(surprise, -18, 18) * w, channel: 'TRADE_EXTERNAL', driver: 'Sector exterior' };
    if (TRADE_DEAL.test(text)) return { raw: 8 * w, channel: 'TRADE_EXTERNAL', driver: 'Acuerdo comercial / sector exterior' };
    return { raw: 0, channel: 'TRADE_EXTERNAL', driver: 'Sector exterior' };
  }
  if (GEO_SEVERE.test(text) && !isHistoricalCommemoration(text)) {
    if (SAFE.has(ccy)) return { raw: 16 * w, channel: 'RISK_GEO', driver: 'Demanda de refugio' };
    if (BETA.has(ccy)) return { raw: -16 * w, channel: 'RISK_GEO', driver: 'Beta: riesgo off' };
    return { raw: -6 * w, channel: 'RISK_GEO', driver: 'Riesgo geopolítico' };
  }

  if (NO_HIKE.test(text)) {
    return { raw: regime === 'weak' ? 0 : -8 * w, channel: 'POLICY_PRICE', driver: 'Pausa: precio del dinero, no NFA' };
  }
  if (policyTone && (HIKE.test(text) || HAWK_TONE.test(text))) {
    return {
      raw: regime === 'weak' ? 0 : clamp(12 * w, 0, 16),
      channel: 'POLICY_PRICE',
      driver: regime === 'weak' ? 'Hike en cost-push: no soporte' : 'Precio del dinero al alza',
    };
  }
  if (policyTone && (CUT.test(text) || DOVE_TONE.test(text))) {
    return { raw: regime === 'weak' ? -12 * w : -8 * w, channel: 'POLICY_PRICE', driver: 'Recorte: menos ingreso por reservas' };
  }

  if (cpiPrint) return relativePrice(surprise, w, regime, text);

  if (item.category === 'banco_central' || (item.source_type === 'oficial' && POLICY_EVENT.test(text))) {
    return { raw: 0, channel: 'POLICY_PRICE', driver: title.slice(0, 52) };
  }

  if (item.actual != null || item.category === 'dato_macro') {
    return { raw: surprise * w, channel: 'DATA_REAL', driver: title.slice(0, 52) };
  }

  return { raw: 0, channel: 'DATA_REAL', driver: title.slice(0, 52) };
}

function decay(item, now, halfLifeH) {
  const ageH = Math.max(0, (now - Date.parse(item.published_at)) / 3600_000);
  return 2 ** (-ageH / halfLifeH);
}

function windowWeight(item, now, maxMs) {
  const age = now - Date.parse(item.published_at);
  if (!Number.isFinite(age) || age < 0) return 1;
  if (age > maxMs) return 0;
  return 1;
}

function signalWindowMs(item) {
  return item.source_type === 'oficial' ? WINDOWS.oficialMs : WINDOWS.structuralMs;
}

export function scoreSignals(items, now = Date.now()) {
  const regimes = Object.fromEntries(CURRENCIES.map((c) => [c, detectRealRegime(items, c)]));
  const by = Object.fromEntries(CURRENCIES.map((c) => [c, []]));
  for (const item of items) {
    for (const ccy of item.currencies || []) {
      if (!by[ccy]) continue;
      const { raw, channel, driver } = channelAndRaw(item, ccy, regimes[ccy]);
      const hl = item.source_type === 'oficial' ? WINDOWS.halfLifeOficialH : WINDOWS.halfLifeBreakingH;
      const d = decay(item, now, hl);
      by[ccy].push({
        raw,
        contrib: raw * d,
        channel,
        driver,
        title: item.title,
        fingerprint: item.fingerprint,
        at: Date.parse(item.published_at),
        item,
      });
    }
  }
  return { by, regimes };
}

function topDrivers(sigs) {
  const scored = [...sigs]
    .filter((s) => Math.abs(s.contrib) >= 0.4 || s.channel === 'RELATIVE_PRICE' || s.channel === 'FISCAL_NFA')
    .sort((a, b) => Math.abs(b.contrib) - Math.abs(a.contrib))
    .map((s) => s.driver.replace(/\s+/g, ' ').trim().slice(0, 59))
    .filter((d, i, arr) => d && !/^https?:/i.test(d) && arr.indexOf(d) === i)
    .slice(0, 3);
  if (scored.length) return scored;
  return [...sigs]
    .map((s) => (s.driver || s.title || '').replace(/\s+/g, ' ').trim().slice(0, 59))
    .filter((d, i, arr) => d && !/^https?:/i.test(d) && arr.indexOf(d) === i)
    .slice(0, 3);
}

function clipChannel(sigs, channel, maxAbs) {
  const hits = sigs.filter((s) => s.channel === channel);
  const sum = hits.reduce((a, s) => a + s.contrib, 0);
  if (Math.abs(sum) <= maxAbs || !hits.length) return;
  const scale = maxAbs / Math.abs(sum);
  for (const s of hits) s.contrib *= scale;
}

function calcSetup(structural, impulse) {
  if (impulse == null) return '';
  if (Math.abs(structural) >= 18 && Math.abs(impulse) >= 12 && Math.sign(structural) === Math.sign(impulse)) return 'confluencia';
  if (Math.abs(structural) >= 18 && Math.abs(impulse) >= 15 && Math.sign(structural) !== Math.sign(impulse)) return 'giro';
  if (Math.abs(structural) < 18 && Math.abs(impulse) >= 18) return 'impulso';
  return '';
}

export function classifyAgent(items, now = Date.now()) {
  const { by, regimes } = scoreSignals(items, now);
  return CURRENCIES.map((currency) => {
    const sigs = by[currency] || [];
    const recent = sigs.filter((s) => {
      const age = now - s.at;
      if (!Number.isFinite(age)) return false;
      if (s.item.source_type === 'oficial') return age >= 0 && age <= WINDOWS.oficialMs;
      return age >= 0 && age <= WINDOWS.structuralMs;
    });
    if (!recent.length) {
      return {
        currency,
        score: 0,
        structural: 0,
        impulse: null,
        setup: '',
        bias: 'neutral',
        drivers: ['Sin catalizadores en el ciclo'],
        rationale: `Sin catalizadores claros en 0 titulares recientes.`,
        regime_note: '',
        noEvidence: true,
        channel: null,
        engine: 'agente',
      };
    }
    clipChannel(recent, 'RISK_GEO', 24);
    const structural = clamp(Math.round(recent.reduce((s, x) => s + x.contrib * windowWeight(x.item, now, signalWindowMs(x.item)), 0)));
    const impulseHits = sigs.filter((x) => now - x.at >= 0 && now - x.at <= WINDOWS.impulseMs && Math.abs(x.raw) >= 0.4 && x.channel !== 'OPERATIONAL');
    const impulse = impulseHits.length
      ? clamp(Math.round(impulseHits.reduce((s, x) => s + x.raw * decay(x.item, now, 1.5), 0)))
      : null;
    let score = structural;
    const signedHits = recent.filter((x) => Math.abs(x.raw) >= 0.4).length;
    const weak = signedHits < 2 && Math.abs(score) < 12;
    if (signedHits < 2 && Math.abs(score) <= 40) score = clamp(score, -40, 40);
    const drivers = topDrivers(recent);
    if (!drivers.length) {
      const fallback = recent.slice(0, 3).map((s) => (s.driver || s.title || '').replace(/\s+/g, ' ').trim().slice(0, 59))
        .filter((d) => d && !/^https?:/i.test(d));
      return {
        currency, score: 0, structural: 0, impulse, setup: '', bias: 'neutral',
        drivers: (fallback.length ? fallback : ['Sin catalizadores en el ciclo']).slice(0, 3),
        rationale: `${recent.length === 1 ? '1 titular' : `${recent.length} titulares`} sin canal cuantificable · Neutral.`,
        regime_note: '', noEvidence: false, channel: null, engine: 'agente',
      };
    }
    const mainCh = recent.slice().sort((a, b) => Math.abs(b.contrib) - Math.abs(a.contrib))[0]?.channel;
    const liveCh = [...new Set(recent.filter((x) => Math.abs(x.raw) >= 0.4).map((x) => x.channel))];
    const nTit = recent.length;
    const titWord = nTit === 1 ? 'titular' : 'titulares';
    const impTxt = impulse == null ? 'n/d' : `${impulse >= 0 ? '+' : ''}${impulse}`;
    const rationale = `${nTit} ${titWord} · ${liveCh.join(' + ') || mainCh || 'sin canal'} · Est ${score >= 0 ? '+' : ''}${score} | Imp 3h ${impTxt}${weak ? ' · evidencia débil' : ''}. Régimen real ${regimes[currency]}.`;
    return {
      currency,
      score,
      structural: score,
      impulse,
      setup: calcSetup(score, impulse),
      bias: biasFor(score),
      drivers,
      rationale,
      regime_note: '',
      noEvidence: false,
      channel: mainCh,
      citations: recent.map(x => x.fingerprint),
      ledger: recent.map(x => ({ fingerprint: x.fingerprint, title: x.title, url: x.item.url, published_at: x.item.published_at, channel: x.channel, raw: x.raw, contribution: x.contrib })),
      engine: 'agente',
    };
  });
}

export const attachRanks = rankRows;

export function rankingAlerts(prevRows, nextRows, engineLabel) {
  const alerts = [];
  const prev = new Map((prevRows || []).map((r) => [r.currency, r]));
  for (const r of nextRows) {
    const p = prev.get(r.currency);
    if (!p) continue;
    if (isNoEvidence(r) || isNoEvidence(p)) continue;
    if (p.bias && r.bias && p.bias !== r.bias) {
      alerts.push({
        title: `Cambio de régimen ${r.currency} (${engineLabel}): ${p.bias} → ${r.bias}`,
        body: `Score narrativo ${p.score} → ${r.score}. ${r.drivers[0] || ''}`,
        level: 'alto',
        alert_type: 'cambio_regimen',
        currency: r.currency,
      });
    }
  }
  const prevM = (prevRows || []).filter((r) => !isNoEvidence(r) && r.rank);
  const nextM = nextRows.filter((r) => !isNoEvidence(r) && r.rank);
  const prevLeader = prevM.find((r) => r.rank === 1);
  const nextLeader = nextM.find((r) => r.rank === 1);
  if (prevLeader && nextLeader && prevM.filter(r => r.rank === 1).length === 1 && nextM.filter(r => r.rank === 1).length === 1 && prevLeader.currency !== nextLeader.currency && Math.abs(nextLeader.score) >= 15) {
    alerts.push({
      title: `Cambio de ranking (${engineLabel}): lidera ${nextLeader.currency}`,
      body: `${nextLeader.currency} ${nextLeader.score >= 0 ? '+' : ''}${nextLeader.score} releva a ${prevLeader.currency}.`,
      level: 'alto',
      alert_type: 'cambio_ranking',
      currency: nextLeader.currency,
    });
  }
  for (const r of nextM) {
    const p = prev.get(r.currency);
    if (!p?.rank || !r.rank) continue;
    if (Math.abs(p.rank - r.rank) >= 2 && Math.abs((r.score || 0) - (p.score || 0)) >= 10) {
      alerts.push({
        title: `Cambio de ranking ${r.currency} (${engineLabel})`,
        body: `#${p.rank} → #${r.rank} · ${p.score} → ${r.score}`,
        level: 'medio',
        alert_type: 'cambio_ranking',
        currency: r.currency,
      });
    }
  }
  return alerts;
}

export { calcSetup };
