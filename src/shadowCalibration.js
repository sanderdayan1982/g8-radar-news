import { CURRENCIES, WINDOWS, BIAS_THRESHOLD } from './config.js';
import { classifyAgent, scoreSignals, biasFor, clamp, parseNum } from './classifyCurrencies.js';
import { dedupeNews, extractReleaseIdentity } from './enrich.js';
import { evidenceContract } from './evidence.js';

export const OP_VERSION = 'mmt-agent-op-v4.1-G8';
export const SHADOW_VERSION = 'mmt-rubric-shadow-v2.1-frozen';
export const EXPANDED_EXPERIMENT_VERSION = 'mmt-expanded-coverage-exp-v1';

export const SHADOW_SPEC = Object.freeze({
  version: SHADOW_VERSION,
  opVersion: OP_VERSION,
  frozenAt: '2026-10-25T12:44:40.970Z',
  empirical: false,
  sameEvidenceInvariant: true,
  hypotheses: Object.freeze({
    H1_OIL_TERMS_OF_TRADE: {
      channel: 'TRADE_EXTERNAL',
      exporterCurrencies: ['CAD'],
      exporterRaw: 6,
      importerCurrencies: ['JPY', 'EUR'],
      importerRaw: -6,
      deescalationRaw: 0,
      assumption: 'Un shock de oferta de crudo/Estrecho de Ormuz mejora la relación real de intercambio del exportador energético neto (CAD) y encarece la factura energética importada (cost-push externo) de importadores netos (JPY, EUR). Declaraciones de desescalada no constituyen conflicto activo.',
    },
    H2_PMI_LEVEL_VS_SURPRISE: {
      channel: 'DATA_REAL',
      contractionThreshold: 50.0,
      strongExpansionThreshold: 55.0,
      noiseTolerance: 0.2,
      strongExpansionRaw: 4,
      assumption: 'En índices de difusión (PMI/ISM), lecturas <50 indican contracción real del sector privado y no aportan soporte positivo por batir marginalmente el consenso; lecturas >=55 con sorpresa negativa <=0.2 pts reflejan expansión real con ruido muestral.',
    },
    H3_COST_PUSH_POLICY_DISCOUNT: {
      channel: 'POLICY_PRICE',
      discountFactor: 0.5,
      applicableRegimes: ['mixed', 'weak'],
      assumption: 'Bajo Mosler/MMT, el endurecimiento del tipo overnight motivado por inflación (CPI/IPC) sin régimen real fuerte tiene menor tracción estructural porque encarece el precio del dinero sobre capacidad mixta.',
    },
    H4_RELEASE_FAMILY_CLUSTERING: {
      channel: 'DATA_REAL',
      unanimousBreadthFactor: 1.25,
      mixedBreadthFactor: 1.0,
      assumption: 'Subcomponentes publicados el mismo día dentro de un mismo boletín estadístico del mismo país y período (ej. Ventas minoristas MoM/YoY/Core o PMI Manufacturero/Servicios) constituyen una única observación macroeconómica compuesta; se conserva país, indicador, período y lista de componentes.',
    },
  }),
});

const GEO_DEESCALATION = /\b(close to ending|peace deal|ceasefire|de-escalat|let it wither)\b/i;
const OIL_SUPPLY_SHOCK = /\b(oil hits|boost oil|crude (?:surges?|jumps?|spikes?)|hormuz|oil (?:surge|spike|shock))\b/i;
const PMI_RE = /\b(pmi|ism)\b/i;
const CPI_RE = /\b(cpi|inflation|ipc|pce|ppi|teuerung)\b/i;

export function indicatorFamily(title = '', item = null) {
  const meta = item?.release_meta || extractReleaseIdentity(item || { title });
  if (meta.indicator === 'GENERAL' || meta.indicator === 'MONETARY_POLICY') return null;
  return `${meta.country}:${meta.indicator}:${meta.period}`;
}

function decayFactor(publishedIso, now, halfLifeH) {
  const ageH = Math.max(0, (now - Date.parse(publishedIso)) / 3600_000);
  return 2 ** (-ageH / halfLifeH);
}

/**
 * Computes candidate MMT/Mosler shadow scores (mmt-rubric-shadow-v2-frozen)
 * strictly on the EXACT same `evidenceItems` passed to operational `classifyAgent`.
 * Never mixes uncontracted stored news into the primary shadow evaluation.
 */
export function classifyAgentShadow(evidenceItems, now = Date.now()) {
  const inputItems = Array.isArray(evidenceItems) ? evidenceItems : [];
  const { by, regimes } = scoreSignals(inputItems, now);

  return CURRENCIES.map((currency) => {
    const sigs = by[currency] || [];
    const adjusted = [];
    const inputFingerprints = [];

    for (const s of sigs) {
      const item = s.item;
      const maxMs = item.source_type === 'oficial' ? WINDOWS.oficialMs : WINDOWS.structuralMs;
      const age = now - Date.parse(item.published_at);
      if (!Number.isFinite(age) || age < 0 || age > maxMs) continue;

      if (item.fingerprint && !inputFingerprints.includes(item.fingerprint)) {
        inputFingerprints.push(item.fingerprint);
      }

      let raw = s.raw;
      let channel = s.channel;
      const title = item.title || '';
      const actual = parseNum(item.actual);
      const forecast = parseNum(item.forecast);
      const w = item.source_type === 'oficial' ? 1.25 : item.impact >= 4 ? 1.15 : 1;
      const hl = item.source_type === 'oficial' ? WINDOWS.halfLifeOficialH : WINDOWS.halfLifeBreakingH;
      const d = decayFactor(item.published_at, now, hl);
      const releaseMeta = item.release_meta || extractReleaseIdentity(item);

      // H1: Geopolitical de-escalation & Oil terms-of-trade (exporters vs importers)
      if (channel === 'RISK_GEO') {
        if (GEO_DEESCALATION.test(title)) {
          raw = 0;
        } else if (OIL_SUPPLY_SHOCK.test(title)) {
          if (SHADOW_SPEC.hypotheses.H1_OIL_TERMS_OF_TRADE.exporterCurrencies.includes(currency)) {
            raw = SHADOW_SPEC.hypotheses.H1_OIL_TERMS_OF_TRADE.exporterRaw * w;
            channel = 'TRADE_EXTERNAL';
          } else if (SHADOW_SPEC.hypotheses.H1_OIL_TERMS_OF_TRADE.importerCurrencies.includes(currency)) {
            const impRaw = SHADOW_SPEC.hypotheses.H1_OIL_TERMS_OF_TRADE.importerRaw * w;
            adjusted.push({
              fingerprint: `${item.fingerprint}:oil_tot`,
              title: `${title} [shock energético importado]`,
              published_at: item.published_at,
              channel: 'TRADE_EXTERNAL',
              raw: impRaw,
              contrib: impRaw * d,
              family: null,
              release_meta: releaseMeta,
            });
          }
        }
      }

      // H2: Diffusion index (PMI/ISM) level vs marginal surprise
      if (channel === 'DATA_REAL' && PMI_RE.test(title) && actual != null) {
        if (actual < SHADOW_SPEC.hypotheses.H2_PMI_LEVEL_VS_SURPRISE.contractionThreshold && raw > 0) {
          raw = 0;
        } else if (
          actual >= SHADOW_SPEC.hypotheses.H2_PMI_LEVEL_VS_SURPRISE.strongExpansionThreshold &&
          forecast != null &&
          Math.abs(actual - forecast) <= SHADOW_SPEC.hypotheses.H2_PMI_LEVEL_VS_SURPRISE.noiseTolerance &&
          raw < 0
        ) {
          raw = SHADOW_SPEC.hypotheses.H2_PMI_LEVEL_VS_SURPRISE.strongExpansionRaw * w;
        }
      }

      // H3: Cost-push discount on inflation-driven tightening in non-strong real regime
      if (channel === 'POLICY_PRICE' && CPI_RE.test(title) && raw > 0 && regimes[currency] !== 'strong') {
        raw *= SHADOW_SPEC.hypotheses.H3_COST_PUSH_POLICY_DISCOUNT.discountFactor;
      }

      adjusted.push({
        fingerprint: item.fingerprint,
        title,
        published_at: item.published_at,
        channel,
        raw,
        contrib: raw * d,
        family: indicatorFamily(title, item),
        release_meta: releaseMeta,
      });
    }

    // H4: Release-family clustering within (country, indicator, period, publication day)
    // If sibling components of the same (country, indicator) on the same day have a single explicitPeriod,
    // inherit it for sibling components on that day that omitted the month token.
    const dayExplicitPeriods = new Map();
    for (const x of adjusted) {
      if (x.channel === 'DATA_REAL' && x.release_meta?.explicitPeriod && x.release_meta.indicator !== 'GENERAL') {
        const baseKey = `${x.release_meta.country}|${x.release_meta.indicator}|${String(x.published_at).slice(0, 10)}`;
        if (!dayExplicitPeriods.has(baseKey)) dayExplicitPeriods.set(baseKey, new Set());
        dayExplicitPeriods.get(baseKey).add(x.release_meta.explicitPeriod);
      }
    }

    const clustered = [];
    const groups = new Map();
    for (const x of adjusted) {
      if (x.channel === 'DATA_REAL' && x.family && Math.abs(x.contrib) > 0) {
        const pubDay = String(x.published_at).slice(0, 10);
        const baseKey = `${x.release_meta.country}|${x.release_meta.indicator}|${pubDay}`;
        const expSet = dayExplicitPeriods.get(baseKey);
        const resolvedPeriod = x.release_meta.explicitPeriod
          || (expSet && expSet.size === 1 ? [...expSet][0] : x.release_meta.period);
        const dayKey = `${x.release_meta.country}:${x.release_meta.indicator}:${resolvedPeriod}|${pubDay}`;
        if (!groups.has(dayKey)) groups.set(dayKey, { period: resolvedPeriod, items: [] });
        groups.get(dayKey).items.push(x);
      } else {
        clustered.push(x);
      }
    }

    for (const { period: grpPeriod, items: grp } of groups.values()) {
      const meanContrib = grp.reduce((acc, g) => acc + g.contrib, 0) / grp.length;
      const signs = new Set(grp.filter((g) => Math.abs(g.contrib) > 0).map((g) => Math.sign(g.contrib)));
      const breadth = grp.length >= 2 && signs.size === 1
        ? SHADOW_SPEC.hypotheses.H4_RELEASE_FAMILY_CLUSTERING.unanimousBreadthFactor
        : SHADOW_SPEC.hypotheses.H4_RELEASE_FAMILY_CLUSTERING.mixedBreadthFactor;
      clustered.push({
        ...grp[0],
        contrib: meanContrib * breadth,
        clusterSize: grp.length,
        breadthFactor: breadth,
        country: grp[0].release_meta?.country || 'GLOBAL',
        indicator: grp[0].release_meta?.indicator || 'GENERAL',
        period: grpPeriod || grp[0].release_meta?.period || null,
        components: grp.map((g) => ({
          component: g.release_meta?.component || 'HEADLINE',
          title: g.title,
          fingerprint: g.fingerprint,
          raw: g.raw,
          contrib: Math.round(g.contrib * 100) / 100,
        })),
      });
    }

    // Clip RISK_GEO at 24
    const geoHits = clustered.filter((x) => x.channel === 'RISK_GEO');
    const geoSum = geoHits.reduce((acc, x) => acc + x.contrib, 0);
    if (Math.abs(geoSum) > 24 && geoHits.length) {
      const scale = 24 / Math.abs(geoSum);
      for (const g of geoHits) g.contrib *= scale;
    }

    const channelSums = {};
    for (const x of clustered) {
      if (Math.abs(x.contrib) > 0) {
        channelSums[x.channel] = Math.round(((channelSums[x.channel] || 0) + x.contrib) * 100) / 100;
      }
    }

    const score = clustered.length
      ? clamp(Math.round(clustered.reduce((acc, x) => acc + x.contrib, 0)))
      : 0;
    const noEvidence = !clustered.length || clustered.every((x) => Math.abs(x.raw) < 0.4 && x.channel !== 'RELATIVE_PRICE' && x.channel !== 'FISCAL_NFA');

    return {
      version: SHADOW_VERSION,
      frozenAt: SHADOW_SPEC.frozenAt,
      empirical: false,
      sameEvidenceAsOp: true,
      currency,
      score: noEvidence ? 0 : score,
      bias: noEvidence ? 'neutral' : biasFor(score, BIAS_THRESHOLD),
      noEvidence,
      regime: regimes[currency],
      channelSums,
      itemCount: clustered.length,
      evidenceFingerprints: inputFingerprints,
      clusters: clustered.filter((c) => c.components?.length).map((c) => ({
        country: c.country,
        indicator: c.indicator,
        period: c.period,
        clusterSize: c.clusterSize,
        breadthFactor: c.breadthFactor,
        components: c.components,
      })),
    };
  });
}

/**
 * Evaluates expanded window coverage (all eligible news within the time window without the 80-item cap)
 * strictly as a SEPARATE experiment with its own independent evidenceContract.
 */
export function evaluateExpandedCoverageExperiment(allWindowNews, now = Date.now()) {
  const deduped = dedupeNews(allWindowNews || []).filter((item) => {
    const maxMs = item.source_type === 'oficial' ? WINDOWS.oficialMs : WINDOWS.structuralMs;
    const age = now - Date.parse(item.published_at);
    return Number.isFinite(age) && age >= 0 && age <= maxMs;
  });
  const baseContract = evidenceContract(deduped, now);
  const contract = {
    ...baseContract,
    version: EXPANDED_EXPERIMENT_VERSION,
    experimentType: 'expanded_coverage_uncapped',
    empirical: false,
  };
  const opRows = classifyAgent(deduped, now);
  const shadowRows = classifyAgentShadow(deduped, now);
  const byCurrency = {};
  for (const c of CURRENCIES) {
    const op = opRows.find((r) => r.currency === c);
    const sh = shadowRows.find((r) => r.currency === c);
    byCurrency[c] = {
      evidenceSet: contract.evidenceSet,
      perCurrencyEvidence: contract.perCurrency?.[c] ?? 0,
      opScore: op?.noEvidence ? null : (op?.score ?? 0),
      opBias: op?.noEvidence ? 'no_evidence' : (op?.bias ?? 'neutral'),
      shadowScore: sh?.noEvidence ? null : (sh?.score ?? 0),
      shadowBias: sh?.noEvidence ? 'no_evidence' : (sh?.bias ?? 'neutral'),
    };
  }
  return {
    experimentVersion: EXPANDED_EXPERIMENT_VERSION,
    contract,
    byCurrency,
  };
}
