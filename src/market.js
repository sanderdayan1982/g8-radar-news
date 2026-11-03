import { CURRENCIES, PAIR_PRIORITY, UA, WINDOWS } from './config.js';

const FRANK = 'https://api.frankfurter.app';

function pairKey(a, b) {
  return PAIR_PRIORITY.indexOf(a) < PAIR_PRIORITY.indexOf(b) ? `${a}/${b}` : `${b}/${a}`;
}

function invert(rate) {
  return rate ? 1 / rate : null;
}

export async function fetchMarket() {
  const res = await fetch(`${FRANK}/latest?from=EUR`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(WINDOWS.fetchTimeoutMs) });
  if (!res.ok) throw new Error(`Frankfurter HTTP ${res.status}`);
  const latest = await res.json();
  const rates = { EUR: 1, ...latest.rates };
  const prevDate = previousBusinessDay(latest.date);
  let prevRates = rates;
  try {
    const prev = await fetch(`${FRANK}/${prevDate}?from=EUR`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(WINDOWS.fetchTimeoutMs) });
    if (prev.ok) {
      const j = await prev.json();
      prevRates = { EUR: 1, ...j.rates };
    }
  } catch { /* keep latest-only */ }

  const pairs = {};
  for (let i = 0; i < CURRENCIES.length; i++) {
    for (let j = i + 1; j < CURRENCIES.length; j++) {
      const a = CURRENCIES[i]; const b = CURRENCIES[j];
      const key = pairKey(a, b);
      const [base, quote] = key.split('/');
      const rate = (rates[quote] && rates[base]) ? rates[quote] / rates[base] : null;
      const prev = (prevRates[quote] && prevRates[base]) ? prevRates[quote] / prevRates[base] : null;
      if (!rate) continue;
      const changePct = prev ? Math.round(((rate / prev) - 1) * 10000) / 100 : 0;
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
      if (!p) continue;
      const [base] = key.split('/');
      sum += base === c ? p.changePct : -p.changePct;
      n++;
    }
    basketPct[c] = n ? Math.round((sum / n) * 100) / 100 : 0;
  }

  return {
    updated_at: new Date().toISOString(),
    reference_date: latest.date || null,
    prev_reference_date: prevDate || null,
    source: 'ecb_frankfurter_daily',
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
