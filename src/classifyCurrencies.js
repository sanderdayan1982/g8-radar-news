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
const TRADE = /\b(trade balance|current account|exports?|imports?|terms of trade|dairy|gdt\b|wti\b|brent|crude|api crude|cushing|iron ore|ttf\b|lng\b)\b/i;
const TRADE_DEAL = /\b(trade (?:deal|agreement|ties)|strengthen(?:s|ed)? .{0,28}(?:ties|trade)|digital trade|new agreement on)\b/i;
const GROWTH_UP = /\b(revis(?:ión|ion) al alza|raises? (?:its )?(?:growth|gdp|forecast)|upgrades? (?:growth|gdp)|eleva(?:n)? .{0,28}previsión|growth (?:beats?|accelerat|stronger)|stronger than previously)\b/i;
const GROWTH_DOWN = /\b(revis(?:ión|ion) a la baja|cuts? (?:its )?(?:growth|gdp|forecast)|downgrades? (?:growth|gdp)|growth (?:slows?|miss(?:es)?|contracts?))\b/i;
const CONF_DOWN = /\b(confidence (?:collapses?|plunges?|falls?|slumps?|cracks?)|colapso de (?:la )?confianza|cost of living pressures)\b/i;
const CONF_UP = /\b(confidence (?:jumps?|surges?|rises?|rebounds?))\b/i;
const PMI_INDEX_RE = /\b(pmi\b|ism\b|caixin|purchasing managers)\b/i;
const AIG_INDEX_RE = /\b(aig\b|ai group)\b/i;
const PMI_UP = /\b(pmi (?:jumps?|rises?|expansion)|services (?:pmi )?(?:in )?expans(?:ion|ión)|expansión sólida|above 5[02])\b/i;
const PMI_DOWN = /\b(pmi (?:falls?|drops?|contracts?)|below 50|contraction)\b/i;
const RETAIL_UP = /\b(retail (?:sales )?(?:beat|jump|rise|surge|hot))\b/i;
const RETAIL_DOWN = /\b(retail (?:sales )?(?:miss|fall|drop|slump|weak))\b/i;
const LABOUR_UP = /\b(payrolls? beat|hot (?:labor|labour)|tight labour|employment (?:beats?|jumps?|rises?))\b/i;
const LABOUR_DOWN = /\b(payrolls? miss|jobless (?:rise|jump)|unemployment (?:rise|up)|claims (?:jump|rise|beat))\b/i;
const REAL = /\b(gdp|pib|pmi|ism|aig\b|ifo|zew|seco|payroll|nfp|employment|unemployment|jobless|claims|retail|housing|industrial|factory|durable|capacity|confidence|labour|labor|production)\b/i;
const HAWK_TONE = /\b(restrictive|vigilant|inflation persistent|tightening|higher for longer|hawkish|discount rate|assessment .{0,24}(?:tight|restrict))\b/i;
const DOVE_TONE = /\b(patient|easing cycle|dovish|cut rates|accommodative)\b/i;
const POLICY_EVENT = /\b(fomc|minutes|statement|ocr|mps|monetary policy (?:review|report)|assessment|outlook|remarks|press conference|projections)\b/i;
const OPERATIONAL = /\bincreased to|programme decreased|tender|\bbills?\b|auction|repo\b|rig count|baker hughes|bid-to-cover|tips (?:high )?yield/i;

// --- Reglas Maestras v4.0-G8 (Curso Maestro MMT + Matriz Macro v6.0) ---
export const MMT_SOVEREIGNTY = Object.freeze({
  USD: 'SOBERANO_EMISOR',
  JPY: 'SOBERANO_EMISOR',
  GBP: 'SOBERANO_EMISOR',
  CAD: 'SOBERANO_EMISOR',
  AUD: 'SOBERANO_EMISOR',
  NZD: 'SOBERANO_EMISOR',
  CHF: 'SOBERANO_EMISOR',
  EUR: 'USUARIO_MONEDA',
  XAU: 'ACTIVO_REAL_REFUGIO',
});

const INTERVENTION_EA4_RE = /\b(snb intervention|fx intervention|currency intervention|rate check|verbal warning|verbal intervention|excessive moves|one-sided|disorderly|speculative moves|smoothing operation|sight deposits|forex reserves intervention|kanda\b|mimura\b|(?:mof|ministry of finance).{0,45}(?:interven|yen|fx|rate check|warning|excessive|disorderly))\b/i;
const EUR_FRAG_B12_RE = /\b(btp\b|oat\b|btp[- ]bund|oat[- ]bund|bonos[- ]bund|spreads? (?:soberanos?|perif[eé]ricos?)|sovereign spreads?|fragmentation|fragmentaci[oó]n|french (?:deficit|budget|debt|rating)|italian (?:deficit|budget|debt|rating)|d[eé]ficit (?:en )?(?:francia|italia)|frexit|italexit|tpi\b)\b/i;
const BOND_VIGILANTES_B1_RE = /\b(bond vigilantes|gilt (?:selloff|crisis|yields? surge)|weak auction|poor auction|tail(?:ed)?|term premium (?:spike|surge)|mini[- ]budget|truss|fiscal dominance|indigesti[oó]n fiscal)\b/i;
const COST_PUSH_TARIFF_RE = /\b(tariffs?|aranceles?|trade war|guerra comercial|usmca|t-mec|ustr\b|retaliat|customs duties|carney.{0,50}(?:tariff|trade|trump|u\.?s\.?)|trump.{0,50}(?:tariff|canad|mexic|eu\b|china)|supply[- ]chain shock)\b/i;
const COST_PUSH_ENERGY_RE = /\b(oil (?:spike|surge|shock|jumps?)|crude (?:spike|surge|shock|jumps?)|gas (?:spike|surge|shock)|ttf (?:surge|jump|spike)|energy (?:crisis|shock|inflation|costs?)|stagflation|estanflaci[oó]n|cost[- ]push)\b/i;
const TREASURY_NFA_RE = /\b(treasury|nzdm|nz treasury|annual budget|budget release|presupuesto|fiscal (?:flow|impulse|balance)|debt (?:issuance|management)|gilt auction|bond auction|refunding|dmo\b|aofm\b|finanzagentur|agence france tresor)\b/i;
const TREASURY_SOURCES = new Set(['us_treasury', 'uk_dmo', 'de_finanzagentur', 'fr_aft', 'jp_mof', 'au_aofm', 'nz_treasury', 'ca_fin']);

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

export function extractHeadlineActual(item) {
  const direct = parseNum(item?.actual);
  if (direct != null) return direct;
  const title = String(item?.title || '');
  const mAct = /\bactual\s+(-?\d+(?:\.\d+)?)/i.exec(title);
  if (mAct) return Number(mAct[1]);
  return null;
}

export function extractHeadlineRef(item) {
  const f = parseNum(item?.forecast);
  if (f != null) return f;
  const p = parseNum(item?.previous);
  if (p != null) return p;
  const title = String(item?.title || '');
  const mFor = /\bforecast\s+(-?\d+(?:\.\d+)?)/i.exec(title);
  if (mFor) return Number(mFor[1]);
  const mPrev = /\bprevious\s+(-?\d+(?:\.\d+)?)/i.exec(title);
  if (mPrev) return Number(mPrev[1]);
  return null;
}

export function surpriseSigned(item) {
  const a = extractHeadlineActual(item);
  const f = extractHeadlineRef(item);
  if (a == null || f == null || a === f) return 0;
  let dir = a > f ? 1 : -1;
  if (INVERTED.test(item.title || '')) dir = -dir;
  const mag = Math.min(22, 8 + (item.absZ ? item.absZ * 5 : 6));
  return dir * mag;
}

/**
 * Regla 1 v4.0-G8: Detección de régimen real respetando umbral de expansión PMI >= 50.0 e índices AiG < 0.
 * Jamás cuenta un PMI < 50.0 ni un AiG negativo como 'strongHit' aunque supere décimas al previo.
 */
export function detectRealRegime(items, ccy) {
  const mine = items.filter((n) => (n.currencies || []).includes(ccy));
  const blob = mine.map((n) => n.title).join(' · ');
  let weakHits = 0;
  let strongHits = 0;

  for (const n of mine) {
    const t = n.title || '';
    const act = extractHeadlineActual(n);
    const surp = surpriseSigned(n);

    if (PMI_INDEX_RE.test(t) && act != null) {
      if (act < 50.0) {
        weakHits += 1;
      } else if (act >= 50.0 && surp > 0) {
        strongHits += 1;
      }
      continue;
    }
    if (AIG_INDEX_RE.test(t) && act != null) {
      if (act < 0) weakHits += 1;
      else if (act > 0 && surp > 0) strongHits += 1;
      continue;
    }

    if (WEAK.test(t) || (act != null && surp < 0 && /\b(pmi|gdp|retail|payroll|employment|unemployment|jobless)\b/i.test(t))) {
      weakHits += 1;
    } else if (STRONG.test(t) || (surp > 0 && /\b(gdp|payroll|employment|retail)\b/i.test(t) && !INVERTED.test(t))) {
      strongHits += 1;
    }
  }

  if (WEAK.test(blob) || (weakHits >= 1 && weakHits > strongHits)) return 'weak';
  if (strongHits >= 2 && strongHits > weakHits) return 'strong';
  return 'mixed';
}

export const MOSLER_RULES = `Clasificación FX según Curso Maestro MMT Forex + Matriz Macro de Escenarios v6.0 (mmt-agent-op-v4.0-G8), 100% determinista (Cero LLMs).

INVARIANTES v4.0-G8
1. Emisor Soberano vs Usuario de Moneda (Regla MMT #1 y #9): USD, JPY, GBP, CAD, AUD, NZD, CHF = SOBERANO_EMISOR. EUR = USUARIO_MONEDA (activo en B12 EUR_FRAG ante tensión en BTP/OAT/Bund o déficits periféricos).
2. Regla PMI < 50 e Índices AiG: Cualquier PMI (Manufacturing, Services, Composite, ISM, Caixin) con Actual < 50.0 está en CONTRACCIÓN. Prohibido etiquetarlo como "Dato real fuerte" o darle +14..+30 pts; máximo +5 pts como "Contracción menor a la previa (PMI < 50)" y 0 si coincide con índices industriales negativos (AiG < 0). Solo Actual >= 50.0 batiendo consenso activa Ficha A5.
3. Los 5 Tipos de Inflación (Módulo 12 MMT): Inflación o precios ligados a energía (WTI, Brent, TTF), cadenas de suministro o aranceles comerciales (USMCA/Carney/Trump) = COST_PUSH / RIESGO EA-1 (STAG_TRAP), nunca soporte alcista lineal por tasas.
4. Separación Fiscal (NFA / Déficit) vs Monetaria (QE/QT / Tasas): Noticias del Tesoro / Presupuesto (NZ Treasury, CAD Budget, DMO, US Treasury) = FLUJO_FISCAL_NFA (Fichas A12 / B10 / C3 / B1), separadas de decisiones de tipos de Bancos Centrales (Fichas A1 / B2).
5. Mapeo a Matriz Macro v6.0 (ficha_v6) y Candado de Agenda ⚑BC <48h / ✓ POST-EVENTO.`;

function relativePrice(surprise, w, regime, text) {
  if (COST_PUSH_ENERGY_RE.test(text) || COST_PUSH_TARIFF_RE.test(text)) {
    return {
      raw: Math.min(0, surprise ? surprise * 0.5 : -6) * w,
      channel: 'RELATIVE_PRICE',
      driver: 'COST_PUSH / RIESGO EA-1 (STAG_TRAP)',
      ficha_v6: 'EA-1',
      mmt_lens: 'COST_PUSH_STAG_TRAP',
    };
  }
  if (regime === 'weak' || WEAK.test(text)) {
    return {
      raw: Math.min(0, surprise) * w,
      channel: 'RELATIVE_PRICE',
      driver: 'CPI cost-push en economía débil (sin soporte)',
      ficha_v6: 'B8',
      mmt_lens: 'COST_PUSH_EROSION_REAL',
    };
  }
  if (regime === 'strong') {
    return {
      raw: clamp(surprise * 0.45, -10, 10) * w,
      channel: 'RELATIVE_PRICE',
      driver: 'CPI demand-pull con economía en capacidad',
      ficha_v6: surprise >= 0 ? 'A1' : 'B2',
      mmt_lens: 'DEMAND_PULL_INFLATION',
    };
  }
  return {
    raw: clamp(surprise * 0.55, -12, 12) * w,
    channel: 'RELATIVE_PRICE',
    driver: surprise ? 'CPI vs consenso' : 'CPI sin sorpresa',
    ficha_v6: surprise > 0 ? 'A1' : surprise < 0 ? 'B2' : 'C2',
    mmt_lens: 'INFLATION_PRINT',
  };
}

function realEconomy(text, surprise, w, title, item = null, regime = 'mixed') {
  const q = (n) => (surprise ? surprise * w : n * w);
  const act = extractHeadlineActual(item || { title });
  const ref = extractHeadlineRef(item || { title });

  // Regla 1a: Índices industriales AiG (Australian Industry Group)
  if (AIG_INDEX_RE.test(text)) {
    if (act != null && act < 0) {
      const drop = ref != null && act < ref;
      const rawVal = drop ? clamp(act * 0.55, -18, -10) : clamp(act * 0.4, -12, -6);
      return {
        raw: rawVal * w,
        channel: 'DATA_REAL',
        driver: `Contracción industrial AiG (${act})`,
        ficha_v6: 'B2',
        mmt_lens: 'CONTRACCION_REAL_AIG',
      };
    }
    if (act != null && act >= 0) {
      return {
        raw: clamp((surprise || 8) * 0.6, 4, 12) * w,
        channel: 'DATA_REAL',
        driver: `Índice AiG positivo (${act})`,
        ficha_v6: 'A5',
        mmt_lens: 'EXPANSION_REAL_A5',
      };
    }
  }

  // Regla 1b: Cualquier PMI (Manufacturing, Services, Composite, ISM, Caixin)
  if (PMI_INDEX_RE.test(text)) {
    if (act != null && act < 50.0) {
      // CONTRACCIÓN: Jamás puede etiquetarse como "Dato real fuerte" ni recibir +14..+30 pts
      if (surprise > 0) {
        const capped = regime === 'weak' ? 0 : Math.min(4.5, Math.max(1.5, Math.round(surprise * 0.22 * 10) / 10));
        return {
          raw: capped,
          channel: 'DATA_REAL',
          driver: `Contracción menor a la previa (PMI ${act} < 50)`,
          ficha_v6: 'B2',
          mmt_lens: 'PMI_CONTRACCION_SUB50',
        };
      }
      return {
        raw: -16 * w,
        channel: 'DATA_REAL',
        driver: `PMI en contracción (${act} < 50)`,
        ficha_v6: 'B2',
        mmt_lens: 'PMI_CONTRACCION_SUB50',
      };
    }
    if (act != null && act >= 50.0) {
      if (surprise >= 0) {
        return {
          raw: q(16),
          channel: 'DATA_REAL',
          driver: `Expansión real confirmada (PMI ${act} >= 50)`,
          ficha_v6: 'A5',
          mmt_lens: 'EXPANSION_REAL_A5',
        };
      }
      return {
        raw: (act >= 52.5 ? Math.max(-4, surprise * 0.3) : surprise * 0.6) * w,
        channel: 'DATA_REAL',
        driver: `PMI en expansión (${act}) bajo consenso`,
        ficha_v6: 'A5',
        mmt_lens: 'EXPANSION_MODERADA_A5',
      };
    }
    if (PMI_DOWN.test(text)) {
      return { raw: q(-16), channel: 'DATA_REAL', driver: 'PMI en contracción (< 50)', ficha_v6: 'B2', mmt_lens: 'PMI_CONTRACCION_SUB50' };
    }
    if (PMI_UP.test(text)) {
      return { raw: q(16), channel: 'DATA_REAL', driver: 'Expansión real confirmada (PMI >= 50)', ficha_v6: 'A5', mmt_lens: 'EXPANSION_REAL_A5' };
    }
  }

  if (GROWTH_UP.test(text)) return { raw: q(16), channel: 'DATA_REAL', driver: 'Revisión al alza del crecimiento', ficha_v6: 'A5', mmt_lens: 'EXPANSION_REAL_A5' };
  if (GROWTH_DOWN.test(text)) return { raw: q(-16), channel: 'DATA_REAL', driver: 'Revisión a la baja del crecimiento', ficha_v6: 'B2', mmt_lens: 'CONTRACCION_REAL' };
  if (CONF_DOWN.test(text)) return { raw: q(-18), channel: 'DATA_REAL', driver: 'Colapso de confianza / demanda', ficha_v6: 'B2', mmt_lens: 'CONTRACCION_REAL' };
  if (CONF_UP.test(text)) return { raw: q(12), channel: 'DATA_REAL', driver: 'Confianza al alza', ficha_v6: 'A5', mmt_lens: 'EXPANSION_REAL_A5' };
  if (RETAIL_DOWN.test(text)) return { raw: q(-12), channel: 'DATA_REAL', driver: 'Ventas al por menor débiles', ficha_v6: 'B2', mmt_lens: 'CONTRACCION_REAL' };
  if (RETAIL_UP.test(text)) return { raw: q(12), channel: 'DATA_REAL', driver: 'Ventas al por menor fuertes', ficha_v6: 'A5', mmt_lens: 'EXPANSION_REAL_A5' };
  if (LABOUR_DOWN.test(text) || (INVERTED.test(text) && surprise < 0)) {
    return {
      raw: q(-15),
      channel: 'DATA_REAL',
      driver: act != null && INVERTED.test(text) ? ` deterioro laboral (Paro ${act}%)` : 'Mercado laboral suave',
      ficha_v6: 'B2',
      mmt_lens: 'DETERIORO_LABORAL_NAIBER',
    };
  }
  if (LABOUR_UP.test(text) || (INVERTED.test(text) && surprise > 0)) {
    return {
      raw: q(14),
      channel: 'DATA_REAL',
      driver: 'Mercado laboral firme (Pleno Empleo)',
      ficha_v6: 'A5',
      mmt_lens: 'EXPANSION_REAL_A5',
    };
  }
  if (surprise) {
    return {
      raw: surprise * w,
      channel: 'DATA_REAL',
      driver: surprise > 0 ? `Dato real fuerte: ${title.slice(0, 120)}` : `Dato real suave: ${title.slice(0, 120)}`,
      ficha_v6: surprise > 0 ? 'A5' : 'B2',
      mmt_lens: surprise > 0 ? 'EXPANSION_REAL_A5' : 'CONTRACCION_REAL',
    };
  }
  return null;
}

export function channelAndRaw(item, ccy, regime = 'mixed') {
  const text = `${item.title || ''} ${item.body || ''}`;
  const surprise = surpriseSigned(item);
  const w = item.source_type === 'oficial' ? 1.25 : item.impact >= 4 ? 1.15 : 1;
  const title = item.title || '';
  const policyTone = (HIKE.test(text) || CUT.test(text) || NO_HIKE.test(text) || HAWK_TONE.test(text) || DOVE_TONE.test(text)) && !/tax hike/i.test(text);
  const cpiPrint = CPI.test(text);
  const realHit = REAL.test(text) || GROWTH_UP.test(text) || GROWTH_DOWN.test(text) || CONF_UP.test(text) || CONF_DOWN.test(text);
  const isTreasurySource = TREASURY_SOURCES.has(item.source_id);

  // 1. Intervención Cambiaria Oficial Esterilizada (MoF Japón / SNB Suiza -> Ficha EA-4)
  if (INTERVENTION_EA4_RE.test(text)) {
    const dir = ccy === 'JPY' ? 14 : ccy === 'CHF' ? -10 : 0;
    return {
      raw: dir * w,
      channel: 'INTERVENTION_EA4',
      driver: `Intervention Watchdog (${ccy === 'CHF' ? 'SNB' : 'MoF/BC'}): ${title.slice(0, 42)}`,
      ficha_v6: 'EA-4',
      mmt_lens: 'INTERVENCION_SOBERANA_EA4',
    };
  }

  // 2. Regla MMT #1 y #9: EUR Usuario de Moneda y Fragmentación Soberana (Ficha B12 EUR_FRAG)
  if (ccy === 'EUR' && EUR_FRAG_B12_RE.test(text)) {
    return {
      raw: -14 * w,
      channel: 'FISCAL_SOVEREIGN_RISK',
      driver: 'B12 EUR_FRAG: fragmentación en usuario de moneda',
      ficha_v6: 'B12',
      mmt_lens: 'USUARIO_MONEDA_EUR_FRAG',
    };
  }

  // 3. Los 5 Tipos de Inflación MMT (Módulo 12): Aranceles comerciales / Guerra Comercial / Energía -> COST_PUSH / RIESGO EA-1 (STAG_TRAP)
  if (COST_PUSH_TARIFF_RE.test(text)) {
    const isTarget = ccy !== 'USD' || /\bretaliat|counter[- ]tariff/i.test(text);
    const tariffRaw = isTarget ? -10 * w : -4 * w;
    return {
      raw: tariffRaw,
      channel: 'TRADE_EXTERNAL',
      driver: `COST_PUSH / RIESGO EA-1 (STAG_TRAP): ${title.slice(0, 42)}`,
      ficha_v6: 'EA-1',
      mmt_lens: 'COST_PUSH_STAG_TRAP',
    };
  }

  // 4. Separación Fiscal (NFA / Déficit / Tesoros) vs Monetaria (QE/QT / Tasas)
  if (BOND_VIGILANTES_B1_RE.test(text)) {
    return {
      raw: -14 * w,
      channel: 'FISCAL_NFA',
      driver: 'Indigestión fiscal / prima por plazo (B1)',
      ficha_v6: 'B1',
      mmt_lens: 'FLUJO_FISCAL_NFA',
    };
  }
  if (NFA_ADD.test(text)) {
    return {
      raw: 12 * w,
      channel: 'FISCAL_NFA',
      driver: 'FLUJO_FISCAL_NFA: Inyección NFA / déficit',
      ficha_v6: 'A12 / B10 / C3',
      mmt_lens: 'FLUJO_FISCAL_NFA',
    };
  }
  if (FISCAL_DRAIN.test(text) && !/cannot afford/i.test(text)) {
    return {
      raw: -10 * w,
      channel: 'FISCAL_NFA',
      driver: 'FLUJO_FISCAL_NFA: Drenaje fiscal / superávit',
      ficha_v6: 'A12 / B10 / C3',
      mmt_lens: 'FLUJO_FISCAL_NFA',
    };
  }
  if (FISCAL_SCARE.test(text)) {
    if (ccy === 'EUR') {
      return {
        raw: -12 * w,
        channel: 'FISCAL_SOVEREIGN_RISK',
        driver: 'B12 EUR_FRAG: restricción fiscal en usuario de moneda',
        ficha_v6: 'B12',
        mmt_lens: 'USUARIO_MONEDA_EUR_FRAG',
      };
    }
    return {
      raw: 0,
      channel: 'FISCAL_NFA',
      driver: 'FLUJO_FISCAL_NFA: Emisor soberano sin riesgo default',
      ficha_v6: 'A12 / B10 / C3',
      mmt_lens: 'FLUJO_FISCAL_NFA',
    };
  }
  if ((isTreasurySource || TREASURY_NFA_RE.test(text)) && !policyTone && !realHit && !cpiPrint) {
    return {
      raw: 0,
      channel: 'FISCAL_NFA',
      driver: `FLUJO_FISCAL_NFA: ${title.slice(0, 44)}`,
      ficha_v6: 'A12 / B10 / C3',
      mmt_lens: 'FLUJO_FISCAL_NFA',
    };
  }

  if ((item.category === 'mercado' || OPERATIONAL.test(text)) && OPERATIONAL.test(text) && !HIKE.test(text) && !CUT.test(text)) {
    return {
      raw: 0,
      channel: 'OPERATIONAL',
      driver: 'FLUJO_FISCAL_NFA: Operaciones / subasta / IRMA',
      ficha_v6: 'A12 / B10 / C3',
      mmt_lens: 'FLUJO_FISCAL_NFA',
    };
  }

  // 5. Economía Real (PMI < 50 vs >= 50, AiG, PIB, Empleo)
  if ((realHit || item.actual != null || item.category === 'dato_macro') && !cpiPrint && !TRADE.test(text)) {
    const hit = realEconomy(text, surprise, w, title, item, regime);
    if (hit) return hit;
  }

  // 6. Términos de Intercambio y Commodities (Ficha EA-1)
  if (TRADE.test(text) || TRADE_DEAL.test(text) || COST_PUSH_ENERGY_RE.test(text)) {
    if (COST_PUSH_ENERGY_RE.test(text)) {
      const isExporter = ccy === 'CAD' || ccy === 'USD';
      const isImporter = ccy === 'EUR' || ccy === 'JPY' || ccy === 'GBP' || ccy === 'CHF' || ccy === 'NZD';
      const rawE = isExporter ? 8 * w : isImporter ? -10 * w : -4 * w;
      return {
        raw: rawE,
        channel: 'TRADE_EXTERNAL',
        driver: isImporter ? 'COST_PUSH / RIESGO EA-1 (STAG_TRAP)' : 'Impulso ToT energético (EA-1)',
        ficha_v6: 'EA-1',
        mmt_lens: isImporter ? 'COST_PUSH_STAG_TRAP' : 'TOT_COMMODITIES_EA1',
      };
    }
    if (surprise) {
      return {
        raw: clamp(surprise, -18, 18) * w,
        channel: 'TRADE_EXTERNAL',
        driver: `Términos de Intercambio (EA-1): ${title.slice(0, 38)}`,
        ficha_v6: 'EA-1',
        mmt_lens: 'TOT_COMMODITIES_EA1',
      };
    }
    if (TRADE_DEAL.test(text)) {
      return {
        raw: 8 * w,
        channel: 'TRADE_EXTERNAL',
        driver: 'Acuerdo comercial / sector exterior (C1/EA-1)',
        ficha_v6: 'EA-1',
        mmt_lens: 'TOT_COMMODITIES_EA1',
      };
    }
    return {
      raw: 0,
      channel: 'TRADE_EXTERNAL',
      driver: ' Términos de Intercambio / Commodities (EA-1)',
      ficha_v6: 'EA-1',
      mmt_lens: 'TOT_COMMODITIES_EA1',
    };
  }

  // 7. Flujo de Refugio Risk-Off y Beta Cíclica (Fichas A6 / B5 / B15)
  if (GEO_SEVERE.test(text) && !isHistoricalCommemoration(text)) {
    if (SAFE.has(ccy)) {
      return {
        raw: 16 * w,
        channel: 'RISK_GEO',
        driver: 'Refugio Risk-Off (A6: USD/JPY/CHF)',
        ficha_v6: 'A6 / B5 / B15',
        mmt_lens: 'SAFE_HAVEN_A6',
      };
    }
    if (BETA.has(ccy)) {
      return {
        raw: -16 * w,
        channel: 'RISK_GEO',
        driver: 'Presión Risk-Off sobre cíclica (B5 / B15)',
        ficha_v6: 'A6 / B5 / B15',
        mmt_lens: 'RISK_OFF_CYCLICAL_B5',
      };
    }
    return {
      raw: -6 * w,
      channel: 'RISK_GEO',
      driver: 'Riesgo geopolítico (A6 / B5)',
      ficha_v6: 'A6 / B5 / B15',
      mmt_lens: 'RISK_OFF_CYCLICAL_B5',
    };
  }

  // 8. Política Monetaria y Repricing de Tasas Cortas (Fichas A1 / B2)
  if (NO_HIKE.test(text)) {
    return {
      raw: regime === 'weak' ? 0 : -8 * w,
      channel: 'POLICY_PRICE',
      driver: 'Pausa BC: precio del dinero estable',
      ficha_v6: 'B2',
      mmt_lens: 'REPRICING_MONETARIO',
    };
  }
  if (policyTone && (HIKE.test(text) || HAWK_TONE.test(text))) {
    if (COST_PUSH_ENERGY_RE.test(text) || COST_PUSH_TARIFF_RE.test(text) || regime === 'weak') {
      return {
        raw: 0,
        channel: 'POLICY_PRICE',
        driver: 'COST_PUSH / RIESGO EA-1 (STAG_TRAP): Hike sin soporte',
        ficha_v6: 'EA-1',
        mmt_lens: 'COST_PUSH_STAG_TRAP',
      };
    }
    return {
      raw: clamp(12 * w, 0, 16),
      channel: 'POLICY_PRICE',
      driver: 'Repricing hawkish BC (Ficha A1)',
      ficha_v6: 'A1 / B2',
      mmt_lens: 'REPRICING_MONETARIO_A1',
    };
  }
  if (policyTone && (CUT.test(text) || DOVE_TONE.test(text))) {
    return {
      raw: regime === 'weak' ? -12 * w : -8 * w,
      channel: 'POLICY_PRICE',
      driver: 'Divergencia dovish BC (Ficha B2)',
      ficha_v6: 'A1 / B2',
      mmt_lens: 'REPRICING_MONETARIO_B2',
    };
  }

  if (cpiPrint) return relativePrice(surprise, w, regime, text);

  if (item.category === 'banco_central' || (item.source_type === 'oficial' && POLICY_EVENT.test(text))) {
    return {
      raw: 0,
      channel: 'POLICY_PRICE',
      driver: title.slice(0, 52),
      ficha_v6: 'A1 / B2',
      mmt_lens: 'REPRICING_MONETARIO',
    };
  }

  if (item.actual != null || item.category === 'dato_macro') {
    return {
      raw: surprise * w,
      channel: 'DATA_REAL',
      driver: title.slice(0, 52),
      ficha_v6: surprise > 0 ? 'A5' : 'B2',
      mmt_lens: surprise > 0 ? 'EXPANSION_REAL_A5' : 'CONTRACCION_REAL',
    };
  }

  return {
    raw: 0,
    channel: 'DATA_REAL',
    driver: title.slice(0, 52),
    ficha_v6: isTreasurySource ? 'A12 / B10 / C3' : 'A1 / B2',
    mmt_lens: isTreasurySource ? 'FLUJO_FISCAL_NFA' : 'NEUTRAL_OBSERVACION',
  };
}

/**
 * Clasifica un titular individual con su Ficha de la Matriz Macro v6.0 y su lente MMT v4.0-G8.
 */
export function classifyItemMmtV4(item) {
  const primaryCcy = (item.g8_currencies && item.g8_currencies[0])
    || (item.currencies || []).find((c) => c !== 'XAU')
    || (item.currencies || [])[0]
    || 'USD';
  if (primaryCcy === 'XAU') {
    return {
      ficha_v6: 'A6 / EA-7',
      mmt_lens: 'ACTIVO_REAL_REFUGIO',
      sovereignty_mmt: MMT_SOVEREIGNTY.XAU,
    };
  }
  const res = channelAndRaw(item, primaryCcy, 'mixed');
  return {
    ficha_v6: res.ficha_v6 || 'A1 / B2',
    mmt_lens: res.mmt_lens || 'REPRICING_MONETARIO',
    sovereignty_mmt: MMT_SOVEREIGNTY[primaryCcy] || 'SOBERANO_EMISOR',
  };
}

/**
 * Regla 4 v4.0-G8: Cruce automático con la columna izquierda (Agenda de la semana - 113 eventos)
 * para activar el Candado `⚑BC <48h (Candado CIRO)` y el sello `✓ POST-EVENTO`.
 */
const CB_HIGH_EVENT_RE = /\b(official bank rate|monetary policy|fomc|rate decision|rate statement|cash rate|interest rate|policy rate|policy assessment|mpc\b|press conference|projections|gov(?:ernor)?\s+\w+\s+speaks|president\s+\w+\s+speaks|bailey speaks|lagarde speaks|powell speaks|ueda speaks|bullock speaks|orr speaks|macklem speaks|schlegel speaks)\b/i;

export function computeCalendarLock(currency, calendarEvents = [], nowMs = Date.now()) {
  if (!Array.isArray(calendarEvents) || !calendarEvents.length) {
    return {
      calendar_lock: null,
      calendar_lock_detail: null,
      post_event_status: null,
      upcoming_48h: [],
      recent_24h: [],
    };
  }

  const ccyEvents = calendarEvents.filter((e) => e && e.currency === currency);
  const upcoming48h = [];
  const recent24h = [];

  for (const e of ccyEvents) {
    const evMs = Date.parse(e.event_at || '');
    if (!Number.isFinite(evMs)) continue;
    const diffMs = evMs - nowMs;
    const isHigh = e.impact === 'High';
    const isCb = CB_HIGH_EVENT_RE.test(e.title || '');
    if (!isHigh && !isCb) continue;

    if (diffMs > 0 && diffMs <= 48 * 3600_000) {
      upcoming48h.push({
        title: e.title,
        event_at: e.event_at,
        impact: e.impact,
        is_cb: isCb,
        hours_until: Math.round((diffMs / 3600_000) * 10) / 10,
        forecast: e.forecast || null,
        previous: e.previous || null,
      });
    } else if (diffMs <= 0 && diffMs >= -24 * 3600_000) {
      recent24h.push({
        title: e.title,
        event_at: e.event_at,
        impact: e.impact,
        is_cb: isCb,
        hours_ago: Math.round((Math.abs(diffMs) / 3600_000) * 10) / 10,
        actual: e.actual || null,
        forecast: e.forecast || null,
        previous: e.previous || null,
      });
    }
  }

  upcoming48h.sort((a, b) => a.hours_until - b.hours_until);
  recent24h.sort((a, b) => a.hours_ago - b.hours_ago);

  // Priorizar eventos de Banco Central o High Impact en las próximas 48h para el Candado CIRO
  const nextCbOrHigh = upcoming48h.find((e) => e.is_cb) || upcoming48h[0] || null;
  const lastPublished = recent24h.find((e) => e.actual != null) || recent24h[0] || null;

  let calendarLock = null;
  let calendarLockDetail = null;
  let postEventStatus = null;

  if (lastPublished) {
    const actTxt = lastPublished.actual
      ? `Act ${lastPublished.actual}${lastPublished.forecast ? ` vs Est ${lastPublished.forecast}` : lastPublished.previous ? ` vs Prev ${lastPublished.previous}` : ''}`
      : 'Publicado';
    postEventStatus = `✓ POST-EVENTO (${lastPublished.title}: ${actTxt})`;
  }

  if (nextCbOrHigh) {
    calendarLock = '⚑BC <48h (Candado CIRO)';
    calendarLockDetail = `${nextCbOrHigh.title} en ${nextCbOrHigh.hours_until}h`;
  } else if (postEventStatus) {
    calendarLock = '✓ POST-EVENTO';
    calendarLockDetail = postEventStatus;
  }

  return {
    calendar_lock: calendarLock,
    calendar_lock_detail: calendarLockDetail,
    post_event_status: postEventStatus,
    upcoming_48h: upcoming48h,
    recent_24h: recent24h,
  };
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
      const { raw, channel, driver, ficha_v6, mmt_lens } = channelAndRaw(item, ccy, regimes[ccy]);
      const hl = item.source_type === 'oficial' ? WINDOWS.halfLifeOficialH : WINDOWS.halfLifeBreakingH;
      const d = decay(item, now, hl);
      by[ccy].push({
        raw,
        contrib: raw * d,
        channel,
        driver,
        ficha_v6: ficha_v6 || 'A1 / B2',
        mmt_lens: mmt_lens || 'REPRICING_MONETARIO',
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
    .filter((s) => Math.abs(s.contrib) >= 0.4 || s.channel === 'RELATIVE_PRICE' || s.channel === 'FISCAL_NFA' || s.mmt_lens === 'PMI_CONTRACCION_SUB50')
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

function selectPrimaryFichaV6(recentSigs, currency, score) {
  // Prioridad a alertas estructurales v6.0 (EA-4, B12, B1, EA-1) y luego al catalizador de mayor peso
  const hasEa4 = recentSigs.some((s) => s.ficha_v6 === 'EA-4');
  if (hasEa4) return 'EA-4';
  if (currency === 'EUR' && recentSigs.some((s) => s.ficha_v6 === 'B12')) return 'B12';
  if (recentSigs.some((s) => s.ficha_v6 === 'B1' && s.raw < 0)) return 'B1';

  const active = [...recentSigs]
    .filter((s) => Math.abs(s.contrib) >= 0.4 || s.mmt_lens === 'FLUJO_FISCAL_NFA' || s.mmt_lens === 'PMI_CONTRACCION_SUB50')
    .sort((a, b) => Math.abs(b.contrib) - Math.abs(a.contrib));

  if (active.length > 0 && active[0].ficha_v6) {
    const top = active[0].ficha_v6;
    if (top === 'A1 / B2') return score > 6 ? 'A1' : score < -6 ? 'B2' : 'A1 / B2';
    return top;
  }
  if (score >= 12) return 'A1';
  if (score <= -12) return 'B2';
  return 'A12 / B10 / C3';
}

function calcSetup(structural, impulse) {
  if (impulse == null) return '';
  if (Math.abs(structural) >= 18 && Math.abs(impulse) >= 12 && Math.sign(structural) === Math.sign(impulse)) return 'confluencia';
  if (Math.abs(structural) >= 18 && Math.abs(impulse) >= 15 && Math.sign(structural) !== Math.sign(impulse)) return 'giro';
  if (Math.abs(structural) < 18 && Math.abs(impulse) >= 18) return 'impulso';
  return '';
}

export function classifyAgent(items, now = Date.now(), calendarEvents = []) {
  const { by, regimes } = scoreSignals(items, now);
  return CURRENCIES.map((currency) => {
    const sigs = by[currency] || [];
    const sovereigntyMmt = MMT_SOVEREIGNTY[currency] || 'SOBERANO_EMISOR';
    const calLockInfo = computeCalendarLock(currency, calendarEvents, now);

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
        ficha_v6: 'A12 / B10 / C3',
        sovereignty_mmt: sovereigntyMmt,
        calendar_lock: calLockInfo.calendar_lock,
        calendar_lock_detail: calLockInfo.calendar_lock_detail,
        post_event_status: calLockInfo.post_event_status,
        drivers: ['Sin catalizadores en el ciclo'],
        rationale: `Sin catalizadores claros en 0 titulares recientes · ${sovereigntyMmt}.`,
        regime_note: '',
        noEvidence: true,
        channel: null,
        engine: 'agente',
      };
    }

    // Regla 1c v4.0-G8: Ponderación conjunta de ventana (ej. PMI < 50 + AiG negativos en AUD)
    // Si hay contracción industrial/real negativa en la ventana, un rebote marginal de PMI < 50 no puede sumar positivo
    const hasRealContraction = recent.some(
      (s) => s.channel === 'DATA_REAL' && s.raw < -4 && s.mmt_lens !== 'PMI_CONTRACCION_SUB50',
    );
    if (hasRealContraction) {
      for (const s of recent) {
        if (s.mmt_lens === 'PMI_CONTRACCION_SUB50' && s.raw > 0) {
          s.raw = 0;
          s.contrib = 0;
        }
      }
    }

    // Regla 2a v4.0-G8: Si EUR tiene activa la bandera B12 EUR_FRAG, aplica freno bajista estructural
    // que impide dar soporte alcista por simple subida de yields periféricos
    const hasEurFragB12 = currency === 'EUR' && recent.some((s) => s.ficha_v6 === 'B12');
    if (hasEurFragB12) {
      for (const s of recent) {
        if (s.channel === 'POLICY_PRICE' && s.raw > 0) {
          s.raw = 0;
          s.contrib = 0;
        }
      }
    }

    clipChannel(recent, 'RISK_GEO', 24);
    const structural = clamp(Math.round(recent.reduce((s, x) => s + x.contrib * windowWeight(x.item, now, signalWindowMs(x.item)), 0)));
    const impulseHits = sigs.filter((x) => now - x.at >= 0 && now - x.at <= WINDOWS.impulseMs && Math.abs(x.raw) >= 0.4 && x.channel !== 'OPERATIONAL');
    const impulse = impulseHits.length
      ? clamp(Math.round(impulseHits.reduce((s, x) => s + x.raw * decay(x.item, now, 1.5), 0)))
      : null;
    let score = structural;
    if (hasEurFragB12 && score > 0) {
      score = Math.min(0, score);
    }
    const signedHits = recent.filter((x) => Math.abs(x.raw) >= 0.4).length;
    const weak = signedHits < 2 && Math.abs(score) < 12;
    if (signedHits < 2 && Math.abs(score) <= 40) score = clamp(score, -40, 40);

    const fichaV6 = selectPrimaryFichaV6(recent, currency, score);
    const drivers = topDrivers(recent);
    if (!drivers.length) {
      const fallback = recent.slice(0, 3).map((s) => (s.driver || s.title || '').replace(/\s+/g, ' ').trim().slice(0, 59))
        .filter((d) => d && !/^https?:/i.test(d));
      return {
        currency,
        score: 0,
        structural: 0,
        impulse,
        setup: '',
        bias: 'neutral',
        ficha_v6: fichaV6,
        sovereignty_mmt: sovereigntyMmt,
        calendar_lock: calLockInfo.calendar_lock,
        calendar_lock_detail: calLockInfo.calendar_lock_detail,
        post_event_status: calLockInfo.post_event_status,
        drivers: (fallback.length ? fallback : ['Sin catalizadores en el ciclo']).slice(0, 3),
        rationale: `${recent.length === 1 ? '1 titular' : `${recent.length} titulares`} · Ficha ${fichaV6} · ${sovereigntyMmt} · Neutral.`,
        regime_note: '',
        noEvidence: false,
        channel: null,
        engine: 'agente',
      };
    }
    const mainCh = recent.slice().sort((a, b) => Math.abs(b.contrib) - Math.abs(a.contrib))[0]?.channel;
    const liveCh = [...new Set(recent.filter((x) => Math.abs(x.raw) >= 0.4 || x.channel === 'FISCAL_NFA').map((x) => x.channel))];
    const nTit = recent.length;
    const titWord = nTit === 1 ? 'titular' : 'titulares';
    const impTxt = impulse == null ? 'n/d' : `${impulse >= 0 ? '+' : ''}${impulse}`;
    const lockTxt = calLockInfo.calendar_lock ? ` · ${calLockInfo.calendar_lock}` : '';
    const rationale = `${nTit} ${titWord} · Ficha ${fichaV6} (${sovereigntyMmt})${lockTxt} · ${liveCh.join(' + ') || mainCh || 'sin canal'} · Est ${score >= 0 ? '+' : ''}${score} | Imp 3h ${impTxt}${weak ? ' · evidencia débil' : ''}. Régimen real ${regimes[currency]}.`;
    return {
      currency,
      score,
      structural: score,
      impulse,
      setup: calcSetup(score, impulse),
      bias: biasFor(score),
      ficha_v6: fichaV6,
      sovereignty_mmt: sovereigntyMmt,
      calendar_lock: calLockInfo.calendar_lock,
      calendar_lock_detail: calLockInfo.calendar_lock_detail,
      post_event_status: calLockInfo.post_event_status,
      drivers,
      rationale,
      regime_note: '',
      noEvidence: false,
      channel: mainCh,
      citations: recent.map((x) => x.fingerprint),
      ledger: recent.map((x) => ({
        fingerprint: x.fingerprint,
        title: x.title,
        url: x.item.url,
        published_at: x.item.published_at,
        channel: x.channel,
        ficha_v6: x.ficha_v6,
        mmt_lens: x.mmt_lens,
        raw: x.raw,
        contribution: x.contrib,
      })),
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
  if (prevLeader && nextLeader && prevM.filter((r) => r.rank === 1).length === 1 && nextM.filter((r) => r.rank === 1).length === 1 && prevLeader.currency !== nextLeader.currency && Math.abs(nextLeader.score) >= 15) {
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
