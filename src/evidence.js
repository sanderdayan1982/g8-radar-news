import { createHash } from 'node:crypto';
import { CURRENCIES, WINDOWS } from './config.js';
import { isRelevant } from './enrich.js';

/**
 * Selecciona la evidencia elegible para el análisis determinista Agente MMT.
 * Los filtros de relevancia macro/MMT (`isRelevant`) y ventanas temporales se aplican
 * exclusivamente aquí (capa de análisis), nunca en la recepción ni en la cinta o alertas.
 */
export function selectEvidence(items, now = Date.now(), cap = 80) {
  const eligible = items.filter((n) => {
    const age = now - Date.parse(n.published_at);
    return n.fingerprint
      && Number.isFinite(age)
      && age >= 0
      && age <= (n.source_type === 'oficial' ? WINDOWS.oficialMs : WINDOWS.structuralMs)
      && isRelevant(n);
  }).sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at) || a.fingerprint.localeCompare(b.fingerprint));
  const queues = CURRENCIES.map((c) => eligible.filter((n) => n.currencies?.includes(c)));
  const seen = new Set();
  const selected = [];
  while (selected.length < cap && queues.some((q) => q.length)) {
    for (const q of queues) {
      while (q.length && seen.has(q[0].fingerprint)) q.shift();
      const n = q.shift();
      if (n && selected.length < cap) {
        seen.add(n.fingerprint);
        selected.push(n);
      }
    }
  }
  return selected;
}

export function evidenceContract(news, now) {
  return {
    version: 'mmt-evidence-v1',
    empirical: false,
    asOf: new Date(now).toISOString(),
    evidenceSet: createHash('sha256').update(JSON.stringify(news)).digest('hex'),
    count: news.length,
    perCurrency: Object.fromEntries(CURRENCIES.map((c) => [c, news.filter((n) => n.currencies?.includes(c)).length])),
  };
}
