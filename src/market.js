import { CURRENCIES, PAIR_PRIORITY, UA, WINDOWS } from './config.js';

const FRANK = 'https://api.frankfurter.dev/v1';

function pairKey(a, b) {
  return PAIR_PRIORITY.indexOf(a) < PAIR_PRIORITY.indexOf(b) ? `${a}/${b}` : `${b}/${a}`;
}

function invert(rate) {
  return rate ? 1 / rate : null;
}

const ECB_90D = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml';
const FAWAZ = (d) => `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${d}/v1/currencies`;

async function getText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(WINDOWS.fetchTimeoutMs), redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.text();
}

// ENZO 2026-11-04: fuente 1 = BCE oficial (hist-90d trae ultimo fixing y el previo en una sola llamada).
async function fromEcb() {
  const xml = await getText(ECB_90D);
  const days = [...xml.matchAll(/<Cube time="(\d{4}-\d{2}-\d{2})">([\s\S]*?)<\/Cube>\s*(?=<Cube time=|<\/Cube>)/g)].slice(0, 2)
    .map(([, date, body]) => ({ date, rates: { EUR: 1, ...Object.fromEntries([...body.matchAll(/currency="(\w+)" rate="([\d.]+)"/g)].map(([, c, r]) => [c, Number(r)])) } }));
  if (days.length < 2) throw new Error('ECB 90d sin dos fixings');
  return { latest: days[0], prev: days[1], source: 'ecb_eurofxref_hist90d' };
}

// fuente 2 = Frankfurter (.dev; .app redirige 301). Historico intermitente (522) -> prev null, nunca prev = latest.
async function fromFrankfurter() {
  const latest = JSON.parse(await getText(`${FRANK}/latest?base=EUR`));
  const prevDate = previousBusinessDay(latest.date);
  let prev = null;
  try { const j = JSON.parse(await getText(`${FRANK}/${prevDate}?base=EUR`)); prev = { date: j.date, rates: { EUR: 1, ...j.rates } }; } catch { /* sin previo */ }
  return { latest: { date: latest.date, rates: { EUR: 1, ...latest.rates } }, prev, source: 'frankfurter_dev' };
}

// fuente 3 = fawazahmed0 currency-api (jsDelivr, con fecha). Base EUR.
async function fromFawaz() {
  const latest = JSON.parse(await getText(`${FAWAZ('latest')}/eur.json`));
  const up = (o) => ({ EUR: 1, ...Object.fromEntries(CURRENCIES.filter((c) => c !== 'EUR').map((c) => [c, o.eur[c.toLowerCase()]])) });
  const prevDate = previousBusinessDay(latest.date);
  let prev = null;
  try { const j = JSON.parse(await getText(`${FAWAZ(prevDate)}/eur.json`)); prev = { date: j.date, rates: up(j) }; } catch { /* sin previo */ }
  return { latest: { date: latest.date, rates: up(latest) }, prev, source: 'fawazahmed0_currency_api' };
}

// XAU/USD spot diario (fawazahmed0, con fecha). STALE si falla; nunca inventa.
async function fetchXau(prevMarket) {
  try {
    const l = JSON.parse(await getText(`${FAWAZ('latest')}/xau.json`));
    const prevDate = previousBusinessDay(l.date);
    let p = null;
    try { p = JSON.parse(await getText(`${FAWAZ(prevDate)}/xau.json`)); } catch { /* sin previo */ }
    const rate = l.xau?.usd; const prev = p?.xau?.usd;
    if (!rate) throw new Error('sin xau');
    return { rate: roundRate(rate), changePct: prev ? Math.round(((rate / prev) - 1) * 10000) / 100 : null, reference_date: l.date, prev_reference_date: p?.date || null, source: 'fawazahmed0_currency_api_xau', stale: !prev };
  } catch {
    const old = prevMarket?.pairs?.['XAU/USD'];
    return old ? { ...old, changePct: null, stale: true } : { rate: null, changePct: null, reference_date: null, source: null, stale: true };
  }
}

export async function fetchMarket(prevMarket = null) {
  let got = null; const errors = [];
  for (const fn of [fromEcb, fromFrankfurter, fromFawaz]) {
    try { got = await fn(); if (got.prev) break; errors.push(`${got.source}: sin previo`); } catch (e) { errors.push(String(e.message || e)); }
  }
  if (!got) throw new Error(`market sin fuente: ${errors.join(' | ')}`);
  const rates = got.latest.rates;
  const prevRates = got.prev?.rates || null;

  const pairs = {};
  for (let i = 0; i < CURRENCIES.length; i++) {
    for (let j = i + 1; j < CURRENCIES.length; j++) {
      const a = CURRENCIES[i]; const b = CURRENCIES[j];
      const key = pairKey(a, b);
      const [base, quote] = key.split('/');
      const rate = (rates[quote] && rates[base]) ? rates[quote] / rates[base] : null;
      const prev = (prevRates && prevRates[quote] && prevRates[base]) ? prevRates[quote] / prevRates[base] : null;
      if (!rate) continue;
      const changePct = prev ? Math.round(((rate / prev) - 1) * 10000) / 100 : null;
      pairs[key] = { rate: roundRate(rate), changePct };
    }
  }

  const basketPct = {};
  for (const c of CURRENCIES) {
    let sum = 0; let n = 0;
    for (const other of CURRENCIES) {
      if (other === c) continue;
      const key = pairKey(c, other);
      const p = pairs[key];
      if (!p || p.changePct == null) continue;
      const [base] = key.split('/');
      sum += base === c ? p.changePct : -p.changePct;
      n++;
    }
    basketPct[c] = n ? Math.round((sum / n) * 100) / 100 : null;
  }

  const xau = await fetchXau(prevMarket);
  pairs['XAU/USD'] = { rate: xau.rate, changePct: xau.changePct };

  return {
    updated_at: new Date().toISOString(),
    reference_date: got.latest.date || null,
    prev_reference_date: got.prev?.date || null,
    source: got.source,
    stale: !prevRates,
    source_errors: errors,
    xau: { reference_date: xau.reference_date, prev_reference_date: xau.prev_reference_date || null, source: xau.source, stale: xau.stale },
    horizon: 'daily_fixing',
    basketPct,
    pairs,
    invert,
  };
}

function roundRate(r) {
  if (r >= 100) return Math.round(r * 100) / 100;
  if (r >= 1) return Math.round(r * 10000) / 10000;
  return Math.round(r * 100000) / 100000;
}

function previousBusinessDay(isoDate) {
  const d = new Date(`${isoDate}T12:00:00Z`);
  do { d.setUTCDate(d.getUTCDate() - 1); } while ([0, 6].includes(d.getUTCDay()));
  return d.toISOString().slice(0, 10);
}
