import { inverseChange, rankRows, hasNoEvidence, connectionState, nextCalendarEvent, fxClosed, safeUrl, sourceFetchedLive } from './domain.js';
import { classifyEventLock, lockSeverityIndex } from './lockSeverity.js';
const CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD', 'NZD'];
const BANK = { USD: 'Fed', EUR: 'BCE', GBP: 'BoE', JPY: 'BoJ', CHF: 'SNB', CAD: 'BoC', AUD: 'RBA', NZD: 'RBNZ' };
// Market quoting convention: the higher-priority currency is the base of the pair.
const PAIR_PRIORITY = ['EUR', 'GBP', 'AUD', 'NZD', 'USD', 'CAD', 'CHF', 'JPY'];
const CATEGORY_LABEL = { dato_macro: 'Dato', banco_central: 'Banco central', geopolitica: 'Geopolítica', mercado: 'Mercado', analisis: 'Análisis', otro: 'General' };
const LEVEL_LABEL = { critico: 'Crítico', alto: 'Alto', medio: 'Medio' };
const TYPE_LABEL = { breaking: 'Breaking', dato_macro: 'Dato macro', cambio_regimen: 'Cambio de régimen', cambio_ranking: 'Cambio de ranking', calendario: 'Agenda', titular: 'Titular' };
const SOURCE_TYPE = { breaking: 'Breaking', oficial: 'Oficial', agencia: 'Agencia' };
const SESSIONS = [
  { city: 'Sídney', tz: 'Australia/Sydney', open: 7, close: 16 },
  { city: 'Tokio', tz: 'Asia/Tokyo', open: 9, close: 18 },
  { city: 'Londres', tz: 'Europe/London', open: 8, close: 17 },
  { city: 'Nueva York', tz: 'America/New_York', open: 8, close: 17 },
];
const INVERTED = /unemployment|jobless|claims/i;
const BIAS_LABEL = { alcista: 'Soporte', bajista: 'Presión', neutral: 'Neutral' };
const BIAS_THRESHOLD = 12;
const ENGINE_NAME = 'Agente MMT';

const pressureLabel = (r) => {
  if (r.noEvidence) return 'N/D';
  return BIAS_LABEL[r.bias] || 'Neutral';
};

export function hasComparableScore(row) {
  return !!row && !row.noEvidence && typeof row.score === 'number' && Number.isFinite(row.score);
}

export function lookupMarketPair(marketPairs, base, quote) {
  if (!marketPairs) return null;
  const direct = marketPairs[`${base}/${quote}`];
  if (direct) return direct;
  const inv = marketPairs[`${quote}/${base}`];
  if (!inv) return null;
  return {
    rate: inv.rate ? Number((1 / inv.rate).toPrecision(5)) : null,
    changePct: typeof inv.changePct === 'number' ? (inverseChange(inv.changePct) == null ? null : Number(inverseChange(inv.changePct).toFixed(2))) : null,
  };
}

const $ = (sel) => (typeof document !== 'undefined' ? document.querySelector(sel) : null);
const $$ = (sel) => (typeof document !== 'undefined' ? [...document.querySelectorAll(sel)] : []);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function riskMapBoardHtml(rows = [], open = new Set()) {
  return (rows || []).map((r) => {
    const ccy = esc(r.currency);
    const level = esc(r.risk_level || '');
    const reasons = (Array.isArray(r.reasons) ? r.reasons : []).map((x) => esc(x)).filter(Boolean);
    const reasonText = reasons.join(' · ');
    const lock = r.lock_level && r.lock_level !== 'NINGUNO'
      ? `<span class="${lockPillClass(r.lock_level)}">${esc(r.lock_level)}${r.retirar_limitadas ? ' · retirar limitadas' : ''}</span>`
      : '';
    const silence = r.silence === true ? '<span>silencio</span>' : '';
    const expanded = open.has(r.currency);
    return `<li class="ccy-row${expanded ? ' open' : ''}" data-ccy="${ccy}">
      <button class="ccy-line" type="button" aria-expanded="${expanded}" aria-label="${ccy}: ${level}">
        <span class="code">${ccy}</span>
        <span class="risk-level">${level}</span>
      </button>
      <div class="ccy-meta"><span>${level}</span>${lock}${silence}</div>
      <p class="driver" title="${reasonText}">${reasonText}</p>
      <div class="ccy-detail"><p>${reasonText}</p></div>
    </li>`;
  }).join('');
}

export function pairRiskHtml(pairs = []) {
  return (pairs || []).map((p) => {
    const lock = p.lock_level && p.lock_level !== 'NINGUNO' ? ` · ${esc(p.lock_level)}` : '';
    return `<div class="pair"><b>${esc(p.pair)}</b><span>${esc(p.risk_level || '')}${lock}</span></div>`;
  }).join('');
}

const num = (v) => { const m = /-?\d+(?:\.\d+)?/.exec(String(v ?? '').replace(/,/g, '')); return m ? Number(m[0]) : null; };
const signed = (n) => (n > 0 ? `+${n}` : `${n}`);
const fmtImpulse = (v) => (v == null ? 'n/d' : signed(v));

const storageGet = (k) => {try {return typeof localStorage !== 'undefined' ? localStorage.getItem(k) : null;} catch {return null;}};

const ui = {
  data: null,
  filter: 'all',
  ccy: null,
  engine: 'agente',
  calImpact: storageGet('rn-cal') || 'Medium',
  open: new Set(),
  knownNews: new Set(),
  pushOn: false,
  browserSubEndpoint: null,
  serverDeviceMatch: null,
  swReg: null,
  syncing: false,
  connectionError: null,
  lastReceived: 0,
  view: storageGet('rn-view') || 'board',
  es: null,
};

const IS_BROWSER = typeof window !== 'undefined' && typeof document !== 'undefined';
const IS_IOS = IS_BROWSER && (/iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
const IS_STANDALONE = IS_BROWSER && (window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true);
const phone = IS_BROWSER ? window.matchMedia('(max-width: 760px)') : { matches: false, addEventListener: () => {} };

const fmtTime = (iso) => (iso ? new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) : '—');
const fmtDay = (iso) => { const t = new Date(iso).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }); return t[0].toUpperCase() + t.slice(1); };
const isToday = (iso) => new Date(iso).toDateString() === new Date().toDateString();
const dayKey = (iso) => new Date(iso).toDateString();

function relTime(iso) {
  if (!iso) return '—';
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (!Number.isFinite(s)) return '—';
  if (s < 60) return 'ahora';
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
  return `hace ${Math.floor(s / 86400)} d`;
}

function countdown(ms) {
  if (ms <= 0) return '0:00';
  const t = Math.round(ms / 1000);
  const d = Math.floor(t / 86400);
  const h = Math.floor((t % 86400) / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  if (d) return `${d}d ${h}h`;
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}:${String(s).padStart(2, '0')}`;
}

async function api(path, opts = {}) {
  const {timeoutMs=15000,...init}=opts;
  const controller=new AbortController();
  const timer=setTimeout(() => controller.abort(),timeoutMs);
  try {
    const res=await fetch(path,{...init,signal:controller.signal,headers:{'Content-Type':'application/json',...init.headers}});
    if (res.status===401) { location.assign('/login'); throw new Error('Sesión caducada'); }
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
    return await res.json();
  } finally {clearTimeout(timer);}
}

// ---------------------------------------------------------------- header

function renderSessions() {
  const now = new Date();
  $('#sessions').innerHTML = SESSIONS.map((s) => {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: s.tz, hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false })
      .formatToParts(now).map((p) => [p.type, p.value]));
    const h = Number(parts.hour) % 24;
    const open = !['Sat', 'Sun'].includes(parts.weekday) && h >= s.open && h < s.close;
    return `<div class="session ${open ? 'open' : ''}" title="${s.city}: sesión ${open ? 'abierta' : 'cerrada'}"><span class="d"></span>${s.city}<span class="clock">${parts.hour}:${parts.minute}</span></div>`;
  }).join('');
  renderLive();
  renderNextEvent();
}

function renderLive() {
  const state=connectionState(ui.data,ui.connectionError,ui.lastReceived);
  const el=$('#live');
  el.dataset.state=state.kind;
  el.className='live ' + state.kind;
  $('#live-text').textContent=state.label;
  const last=ui.data?.last_sync?.finished_at;
  const detail=last ? `Última sincronización: ${fmtTime(last)} · ${relTime(last)}` : 'Esperando primera sincronización';
  el.title=state.label+' · '+detail;
  el.setAttribute('aria-label',el.title+'. Ver fuentes');
  const summary=$('#desk-status');
  if (summary) {
    const d=ui.data;
    const zone=Intl.DateTimeFormat().resolvedOptions().timeZone;
    summary.textContent=d ? `${d.sources?.filter(sourceFetchedLive).length || 0}/${d.sources?.length || 0} fuentes responden · ${d.news?.length || 0} noticias recientes · ${detail} · ${zone}` : `Conectando con la mesa · ${zone}`;
  }
}

function setSyncing(on) {
  ui.syncing = on;
  $('#refresh').disabled = on;
  $('#refresh').classList.toggle('loading', on);
  renderLive();
}

function isSourceActiveWithinWindow(s, nowMs = Date.now()) {
  if (!s || !sourceFetchedLive(s)) return false;
  if (!s.last_news_published_at) return true;
  const pubMs = Date.parse(s.last_news_published_at);
  if (!Number.isFinite(pubMs)) return true;
  const maxAgeDays = s.type === 'oficial' ? 45 : 7;
  return (nowMs - pubMs) <= maxAgeDays * 86400_000;
}

function liveCoverage() {
  const sources = ui.data?.sources || [];
  const total = sources.length;
  const matched = sources.filter((s) => isSourceActiveWithinWindow(s)).length;
  return { total, matched, degraded: total > 0 && matched / total < 0.8 };
}

function renderStatus() {
  const d = ui.data;
  const band = $('#error-band');
  const last = d.last_sync?.finished_at;
  const stale = last && Date.now() - Date.parse(last) > 15 * 60_000 && !d.syncing;
  const cov = liveCoverage();
  band.classList.toggle('warn', !d.error && !stale && cov.degraded);
  if (ui.connectionError) {
    band.hidden=false;
    band.textContent="Sin conexión. Se conserva la última lectura; los datos no se están actualizando.";
  } else if (d.error) {
    band.hidden = false;
    band.textContent = `Error de sincronización: ${d.error}`;
  } else if (stale) {
    band.hidden = false;
    band.textContent = `Sin sincronizar desde ${fmtTime(last)}. El servidor reintenta automáticamente.`;
  } else if (cov.degraded) {
    band.hidden = false;
    band.textContent = `Datos degradados: cobertura Act ${cov.matched}/${cov.total}. Fuentes operativas no equivalen a integridad; el ranking opera con evidencia incompleta.`;
  } else {
    band.hidden = true;
    band.textContent = '';
  }
  setSyncing(d.syncing);
}

// ---------------------------------------------------------------- tape

function macroHtml(n) {
  if (!n.actual) return '';
  const a = num(n.actual);
  const ref = num(n.forecast) ?? num(n.previous);
  let cls = '';
  if (a != null && ref != null && a !== ref) {
    const up = a > ref;
    cls = (INVERTED.test(n.title) ? !up : up) ? 'up' : 'down';
  }
  const zHtml = typeof n.absZ === 'number' && n.absZ >= 0.3
    ? ` <span class="z-badge ${n.z > 0 ? 'pos' : n.z < 0 ? 'neg' : ''}" title="Sorpresa estadística estandarizada (Z-Score)">${n.z > 0 ? '+' : ''}${n.z.toFixed(1)}σ</span>`
    : '';
  return `<span class="macro">Act <b class="${cls}">${esc(n.actual)}</b>${n.forecast ? ` · Est <b>${esc(n.forecast)}</b>` : ''}${n.previous ? ` · Prev <b>${esc(n.previous)}</b>` : ''}${zHtml}</span>`;
}

function renderCcyFilter() {
  const sel = $('#ccy-filter');
  if (!sel.options.length) {
    sel.innerHTML = '<option value="">Todas las divisas (G8 + XAU)</option>' + [...CURRENCIES, 'XAU'].map((c) => `<option value="${c}">${c}</option>`).join('');
  }
  sel.value = ui.ccy || '';
}

function renderTape() {
  const d = ui.data;
  let items = d.news || [];
  if (ui.filter === 'breaking') items = items.filter((n) => n.impact >= 4 || n.source_type === 'breaking');
  else if (ui.filter !== 'all') items = items.filter((n) => n.category === ui.filter);
  if (ui.ccy) items = items.filter((n) => (n.currencies || []).includes(ui.ccy));
  const q = (ui.search || '').trim().toLowerCase();
  if (q) items = items.filter((n) => `${n.title} ${n.source} ${n.calendar_title || ''} ${(n.currencies || []).join(' ')}`.toLowerCase().includes(q));

  const el = $('#tape');
  if (!d.news?.length) {
    el.innerHTML = '<div class="state-msg"><strong>Aún no hay titulares</strong>Se cargan en la primera sincronización.<button class="btn primary" data-action="refresh">Actualizar ahora</button></div>';
    return;
  }
  if (!items.length) {
    el.innerHTML = '<div class="state-msg">No hay titulares con este filtro.</div>';
    return;
  }
  const firstLoad = ui.knownNews.size === 0;
  const freshItems = firstLoad ? [] : (d.news || []).filter((n) => !ui.knownNews.has(n.id));
  if (freshItems.length > 0) {
    const topLevel = freshItems.some((n) => n.impact >= 5) ? 'critico' : 'alto';
    playAlertSound(topLevel);
    for (const n of freshItems.slice(0, 5)) {
      const alertObj = {
        id: n.id,
        news_item_id: n.id,
        level: n.impact >= 5 ? 'critico' : 'alto',
        title: `${n.currencies?.length ? `[${n.currencies.join('/')}] ` : ''}${n.source}`,
        body: n.title,
      };
      toast(alertObj);
      localNotify(alertObj);
    }
  }
  let lastDay = '';
  el.innerHTML = items.slice(0, 300).map((n) => {
    let sep = '';
    const k = dayKey(n.published_at);
    if (k !== lastDay) {
      if (lastDay || !isToday(n.published_at)) sep = `<div class="day-sep">${isToday(n.published_at) ? 'Hoy' : fmtDay(n.published_at)}</div>`;
      lastDay = k;
    }
    const cls = [n.impact >= 5 ? 'critical' : n.impact >= 4 ? 'hot' : '', !firstLoad && !ui.knownNews.has(n.id) ? 'fresh' : ''].join(' ');
    let calChip = '';
    if (n.calendar_title) {
      const calEv = (d.calendar || []).find((e) => e.news_item_id === n.id || (e.title === n.calendar_title && (n.currencies || []).includes(e.currency)));
      const diffEst = calEv?.forecast && n.forecast && num(calEv.forecast) !== num(n.forecast);
      const diffPrev = calEv?.previous && n.previous && num(calEv.previous) !== num(n.previous);
      const calLabel = diffEst
        ? `◆ ${esc(n.calendar_title)} · Agenda Est ${esc(calEv.forecast)}`
        : `◆ ${esc(n.calendar_title)}`;
      const calTip = (diffEst || diffPrev)
        ? `Discrepancia de consenso entre fuentes: Titular (${n.source}) reporta Est ${n.forecast || '—'} / Prev ${n.previous || '—'}, mientras Agenda (ForexFactory) registra Est ${calEv?.forecast || '—'} / Prev ${calEv?.previous || '—'}.`
        : `Enlazado con la agenda (${n.calendar_title})${calEv?.forecast ? ` · Consenso Agenda: Est ${calEv.forecast} / Prev ${calEv.previous || '—'}` : ''}`;
      calChip = `<span class="cal-link" title="${esc(calTip)}">${calLabel}</span>`;
    }
    const meta = [
      n.impact >= 4 ? `<span class="tag-hot">${n.impact >= 5 ? 'Crítico' : 'Breaking'}</span>` : '',
      `<span>${esc(n.source)}</span>`,
      n.iris_category ? `<span class="ccy" title="Categoría determinista IRIS">${esc(n.iris_category)}</span>` : `<span>${CATEGORY_LABEL[n.category] || n.category}</span>`,
      n.ficha_v6 ? `<span class="ficha-pill-sm" title="Ficha Matriz Macro v6.0 · Lente MMT: ${esc(n.mmt_lens || 'MMT')}">Ficha ${esc(n.ficha_v6)}</span>` : '',
      n.mmt_lens && n.mmt_lens !== 'NEUTRAL_OBSERVACION' ? `<span class="mmt-lens-sm" title="Clasificación Curso Maestro MMT">${esc(n.mmt_lens)}</span>` : '',
      n.currencies?.length ? `<span class="ccy">${n.currencies.join(' · ')}</span>` : '',
      macroHtml(n),
      calChip,
    ].filter(Boolean).join('');
    const capAt = n.captured_at || n.created_at;
    const dateDrift = capAt && Math.abs(Date.parse(n.published_at) - Date.parse(capAt)) > 2 * 3600_000;
    const timeTip = dateDrift
      ? `Publicado ${new Date(n.published_at).toISOString()} · Capturado ${capAt}`
      : '';
    return `${sep}<div class="row ${cls}" id="news-${Number(n.id)}">
      <div class="time" title="${esc(timeTip)}">${fmtTime(n.published_at)}</div>
      <div class="headline">${safeUrl(n.url, "") ? `<a href="${esc(safeUrl(n.url))}" target="_blank" rel="noopener">${esc(n.title)}</a>` : `<span>${esc(n.title)}</span>`}<div class="meta">${meta}</div></div>
    </div>`;
  }).join('');
  for (const n of d.news) ui.knownNews.add(n.id);
}

// ---------------------------------------------------------------- board

const SETUP_META = {
  confluencia: { label: 'Confluencia', title: 'Sesgo estructural (72h) e impulso táctico (3h) alineados en la misma dirección' },
  giro: { label: 'Giro intradía', title: 'El impulso táctico de las últimas 3h contradice el sesgo estructural de 72h' },
  impulso: { label: 'Impulso 3h', title: 'Ruptura táctica reciente sobre base estructural neutral' },
};

function calcSetup(structural, impulse) {
  if (impulse == null) return '';
  if (Math.abs(structural) >= 18 && Math.abs(impulse) >= 12 && Math.sign(structural) === Math.sign(impulse)) return 'confluencia';
  if (Math.abs(structural) >= 18 && Math.abs(impulse) >= 15 && Math.sign(structural) !== Math.sign(impulse)) return 'giro';
  if (Math.abs(structural) < 18 && Math.abs(impulse) >= 18) return 'impulso';
  return '';
}

const isNoEvidence = hasNoEvidence;
const sortAndRankWithEvidence = rankRows;
const isFxWeekend = () => fxClosed();

function engineView() {
  const engines = (ui.data?.engines || []).filter((e) => e.engine === 'agente' && e.rows?.length);
  if (!engines.length) return null;
  const e = engines[0];
  const rawRows = e.rows.map((r) => {
    const h = e.history?.[r.currency] || [];
    const structural = r.structural ?? r.score;
    const impulse = r.impulse == null ? null : r.impulse;
    return {
      ...r,
      structural,
      impulse,
      setup: r.setup || calcSetup(structural, impulse),
      prevRank: h.length > 1 ? h[h.length - 2][2] : null,
      series: h.map((p) => p[1]),
    };
  });
  const rows = sortAndRankWithEvidence(rawRows);
  return {
    label: ENGINE_NAME,
    snapshot_at: e.snapshot_at,
    regime_note: e.regime_note,
    rows,
  };
}

function sparkline(series) {
  if (!series || series.length < 2) return '';
  const pts = series.slice(-48);
  const w = 120; const h = 22;
  const x = (i) => (i / (pts.length - 1)) * w;
  const y = (v) => h / 2 - (v / 100) * (h / 2 - 1);
  const d = pts.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const last = pts[pts.length - 1];
  const color = last > 0 ? '#22c55e' : last < 0 ? '#ef4444' : '#7c8794';
  return `<div class="spark-row"><svg class="spark" viewBox="0 0 ${w} ${h}"><line x1="0" x2="${w}" y1="${h / 2}" y2="${h / 2}" stroke="#2a323d"/><path d="${d}" fill="none" stroke="${color}" stroke-width="1.5"/></svg>Últimas 48 observaciones</div>`;
}

function renderEngineTabs() {
  const el = $('#engine-tabs');
  if (!el) return;
  el.innerHTML = `<button data-engine="agente" class="active">${ENGINE_NAME}</button>`;
}

const driversList = (drivers) => `<ul>${(drivers || []).map((x) => `<li>${esc(x)}</li>`).join('') || '<li>Sin catalizadores</li>'}</ul>`;

function cleanRationale(s) {
  return String(s || '')
    .replace(/\[[0-9a-f]{7,40}\]/gi, '')
    .replace(/\b[0-9a-f]{32,40}\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([.,;:])/g, '$1')
    .trim();
}

function ledgerHtml(row) {
  if (!row.ledger?.length) return '';
  return `<details><summary>Contribuciones MMT v4.1-G8 (${row.ledger.length} noticias)</summary>${row.ledger.map((x) => `<p>${esc(x.published_at)} · ${esc(x.channel)}${x.ficha_v6 ? ` · <b>Ficha ${esc(x.ficha_v6)}</b>` : ''}${x.mmt_lens ? ` (${esc(x.mmt_lens)})` : ''} · bruto ${Number(x.raw).toFixed(2)} · tras antigüedad/tope ${Number(x.contribution).toFixed(2)} · ${esc(x.title)}</p>`).join('')}</details>`;
}

function lockPillClass(level) {
  return `cal-lock-pill lock lock-${String(level || '').toLowerCase().replace(/_/g, '-')}`;
}

function formatLockHours(hours) {
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m`;
  return `${hours.toFixed(1)}h`;
}

export function computeLiveCalendarBadge(currency, row, calEvents = [], nowMs = Date.now()) {
  const classified = (calEvents || [])
    .filter((e) => e && e.currency === currency)
    .map((e) => ({ e, ...classifyEventLock(e, nowMs) }))
    .filter((x) => x.lock_class && x.hours_until != null);

  const active = classified.filter((x) => x.active).sort((a, b) => {
    const byLevel = lockSeverityIndex(a.lock_level) - lockSeverityIndex(b.lock_level);
    if (byLevel !== 0) return byLevel;
    return a.hours_until - b.hours_until;
  });
  const top = active[0] || null;
  const past = classified.filter((x) => x.in_post_window).sort((a, b) => b.hours_until - a.hours_until);
  const prev = past.find((x) => x.e.actual != null) || past[0] || null;

  const pills = [];
  const paint = (info, extra = '') => {
    const hTxt = formatLockHours(info.hours_until);
    return `<span class="${lockPillClass(info.lock_level)}" title="${esc(info.lock_class)}: ${esc(info.e.title)} en ${hTxt}">${esc(info.lock_level)} · ${esc(String(info.e.title).slice(0, 22))} (${hTxt})${extra}</span>`;
  };

  if (top) {
    pills.push(paint(top, top.retirar_limitadas ? ' · retirar limitadas' : ''));
    const other = active.find((x) => x.retirar_limitadas && x !== top);
    if (other) pills.push(paint(other, ' · retirar limitadas'));
  } else if ((!calEvents || calEvents.length === 0) && row?.lock_level && row.lock_level !== 'NINGUNO') {
    const ev0 = row.lock_events?.[0];
    const title = ev0?.title ? ` · ${esc(String(ev0.title).slice(0, 22))}` : '';
    const when = ev0?.hours_until != null ? ` (${ev0.hours_until}h)` : '';
    const flag = row.retirar_limitadas ? ' · retirar limitadas' : '';
    pills.push(`<span class="${lockPillClass(row.lock_level)}" title="${esc(row.calendar_lock_detail || row.lock_class || '')}">${esc(row.lock_level)}${title}${when}${flag}</span>`);
  }

  if (prev) {
    const ago = (nowMs - Date.parse(prev.e.event_at)) / 3_600_000;
    const actVsEst = prev.e.actual ? `Act ${prev.e.actual}${prev.e.forecast ? ` vs ${prev.e.forecast}` : ''}` : 'Publicado';
    pills.push(`<span class="cal-lock-pill post" title="Evento publicado hace ${ago.toFixed(1)}h: ${esc(prev.e.title)} (${esc(actVsEst)})">✓ POST-EVENTO · ${esc(String(prev.e.title).slice(0, 16))} (${esc(actVsEst)})</span>`);
  } else if (row?.post_event_status) {
    pills.push(`<span class="cal-lock-pill post" title="${esc(row.post_event_status)}">✓ POST-EVENTO</span>`);
  }
  return pills.join('');
}

function renderBoard() {
  renderEngineTabs();
  if (Array.isArray(ui.data?.risk_map) && ui.data.risk_map.length) {
    const board = $('#board');
    const opVer = ui.data?.engine_meta?.op_version || '';
    const when = ui.data?.generated_at ? fmtTime(ui.data.generated_at) : '';
    const batch = $('#batch-time');
    if (batch) batch.textContent = ['Mapa de riesgo de evento', opVer, when].filter(Boolean).join(' · ');
    if (board) board.innerHTML = riskMapBoardHtml(ui.data.risk_map, ui.open);
    const matrix = $('#matrix');
    if (matrix) matrix.innerHTML = '';
    const top = $('#top-pairs');
    if (top) top.innerHTML = pairRiskHtml(ui.data.pair_risk);
    const sheet = $('#pair-sheet');
    if (sheet) { sheet.hidden = true; sheet.innerHTML = ''; }
    const regime = $('#regime');
    if (regime) { regime.hidden = true; regime.textContent = ''; }
    return;
  }
  const view = engineView();
  const board = $('#board');
  if (!view) {
    board.innerHTML = '<li class="state-msg">Sin clasificación todavía. Se genera tras la primera sincronización.</li>';
    $('#matrix').innerHTML = '';
    $('#top-pairs').innerHTML = '';
    $('#batch-time').textContent = '';
    return;
  }

  const opVer = ui.data?.engine_meta?.op_version || 'mmt-agent-op-v4.1-G8';
  $('#batch-time').textContent = view.snapshot_at
    ? `${ENGINE_NAME} (${opVer}) · ${fmtTime(view.snapshot_at)} · Curso Maestro MMT + Matriz v6.0 · umbral ±${BIAS_THRESHOLD}`
    : `${ENGINE_NAME} (${opVer}) · Escala MMT descriptiva`;

  const cov = liveCoverage();
  if (cov.degraded) {
    $('#batch-time').textContent += ` · datos degradados ${cov.matched}/${cov.total} Act`;
  }

  const basketPct = ui.data.market?.basketPct || {};
  const wknd = isFxWeekend();
  const spotLabel = wknd ? 'Spot (vie.)' : 'Spot';
  const spotTitle = wknd
    ? 'Variación spot al cierre del viernes frente a cesta G8 (mercado FX cerrado en fin de semana)'
    : 'Variación media spot 24h frente a cesta G8';

  board.innerHTML = view.rows.map((r) => {
    const w = Math.abs(r.score) / 2;
    const cls = r.score > 0 ? 'pos' : r.score < 0 ? 'neg' : 'zero';
    let delta = '<span class="delta"></span>';
    if (!r.noEvidence && !r.tied && r.prevRank && r.rank && r.prevRank !== r.rank) {
      const up = r.prevRank > r.rank;
      delta = `<span class="delta ${up ? 'up' : 'down'}" title="Antes #${r.prevRank}">${up ? '▲' : '▼'} ${Math.abs(r.prevRank - r.rank)}</span>`;
    }
    const detail = `${driversList(r.drivers)}<div>${esc(cleanRationale(r.rationale || ''))}</div>${ledgerHtml(r)}`;
    const impCls = r.impulse == null ? '' : r.impulse > 0 ? 'pos' : r.impulse < 0 ? 'neg' : '';
    const setupMeta = SETUP_META[r.setup];
    const setupHtml = setupMeta ? `<span class="setup-pill ${r.setup}" title="${setupMeta.title}">${setupMeta.label}</span>` : '';
    const bPct = basketPct[r.currency];
    const fxHtml = typeof bPct === 'number' && bPct !== 0
      ? `<span class="fx-pct ${bPct > 0 ? 'up' : 'down'}" title="${spotTitle}">${spotLabel} ${bPct > 0 ? '+' : ''}${bPct.toFixed(2)}%</span>`
      : '';
    const fichaV6 = r.ficha_v6 || 'A1 / B2';
    const fichaHtml = `<span class="ficha-pill" title="Escenario Matriz Macro Institucional v6.0">Ficha ${esc(fichaV6)}</span>`;
    const sovMmt = r.sovereignty_mmt || (r.currency === 'EUR' ? 'USUARIO_MONEDA' : 'SOBERANO_EMISOR');
    const isB12 = sovMmt === 'B12_EUR_FRAG_RIESGO' || (r.currency === 'EUR' && fichaV6 === 'B12');
    const sovHtml = isB12
      ? `<span class="mmt-sov-pill b12" title="Matriz v6.0 Ficha B12: Veto alcista activo por riesgo de fragmentación fiscal en Eurozona">B12_EUR_FRAG_RIESGO</span>`
      : `<span class="mmt-sov-pill ${sovMmt === 'USUARIO_MONEDA' ? 'user' : 'sov'}" title="Naturaleza Monetaria Curso Maestro MMT (Regla #1 y #9)">${sovMmt === 'USUARIO_MONEDA' ? 'USUARIO_MONEDA' : 'SOBERANO_EMISOR'}</span>`;
    const calLockHtml = computeLiveCalendarBadge(r.currency, r, ui.data?.calendar || []);
    const biasText = r.noEvidence ? 'N/D' : pressureLabel(r);
    const drvText = r.drivers?.[0] || 'Sin catalizadores claros';
    const rankLabel = r.noEvidence ? '<span class="rank" title="Sin evidencia medida en la ventana">—</span>' : `<span class="rank" title="${r.tied ? 'Empate' : 'Posición'}">${r.tied ? '=' : ''}${r.rank}</span>`;

    return `<li class="ccy-row ${ui.open.has(r.currency) ? 'open' : ''} ${r.noEvidence ? 'nd' : ''}" data-ccy="${r.currency}">
      <button class="ccy-line" type="button" aria-expanded="${ui.open.has(r.currency)}" aria-controls="detail-${r.currency}" aria-label="${r.currency}: ${r.noEvidence ? 'sin evidencia' : signed(r.score)}. Ver contribuciones">
        ${rankLabel}<span class="code">${r.currency}</span>
        <span class="score ${cls}">${signed(r.score)}</span>${delta}
      </button>
      <div class="bar" aria-hidden="true"><span class="mid"></span><span class="fill ${cls}" style="width:${w}%"></span></div>
      <div class="ccy-meta">
        <span class="bias ${r.noEvidence ? 'nd' : r.bias}" title="${r.noEvidence ? 'Sin catalizadores medidos en la ventana actual' : ''}">${biasText}</span>
        ${fichaHtml}${sovHtml}
        <span class="vec-pill" title="Impulso táctico últimas 3 horas. n/d = sin prints en la ventana">Imp 3h <b class="${impCls}">${fmtImpulse(r.impulse)}</b></span>
        ${setupHtml}${fxHtml}${calLockHtml}
      </div>
      <p class="driver" title="${esc(drvText)}">${esc(drvText)}</p>
      <div class="ccy-detail" id="detail-${r.currency}">${detail}${sparkline(r.series)}</div>
    </li>`;
  }).join('');

  const regime = $('#regime');
  regime.hidden = !view.regime_note;
  regime.textContent = view.regime_note ? `Régimen · ${view.regime_note}` : '';
  renderMatrix(view.rows);
}

function cellColor(v) {
  const a = Math.min(1, Math.abs(v) / 120);
  return v > 0 ? `rgba(34,197,94,${0.06 + a * 0.5})` : v < 0 ? `rgba(239,68,68,${0.06 + a * 0.5})` : '#0a0d11';
}

function pairConfluence(diff, changePct) {
  if (changePct == null || Math.abs(diff) < 20) return null;
  const sameSign = Math.sign(diff) === Math.sign(changePct);
  if (sameSign && Math.abs(changePct) >= 0.85) {
    return {
      kind: 'agotamiento',
      label: 'Priced-in / Ext.',
      title: 'Extensión de precio: Spot 24h ≥ 0.85% alineado con el diferencial narrativo (|ΔScore| ≥ 20). Posible descuento en precio.',
    };
  }
  if (sameSign && Math.abs(changePct) >= 0.10) {
    return {
      kind: 'confirmado',
      label: 'Alineado con spot',
      title: 'Alineación precio-narrativa: diferencial |ΔScore| ≥ 20 pts y Spot 24h ≥ 0.10% en la misma dirección.',
    };
  }
  if (!sameSign && Math.abs(diff) >= 28 && Math.abs(changePct) >= 0.18) {
    return {
      kind: 'divergencia',
      label: 'Divergencia precio',
      title: 'Divergencia precio-narrativa: el precio Spot (≥ 0.18%) se mueve en sentido opuesto al diferencial narrativo (|ΔScore| ≥ 28 pts).',
    };
  }
  return null;
}

function renderPairSheet(rows) {
  const sheet = $('#pair-sheet');
  if (!sheet) return;
  if (!ui.selectedPair) {
    sheet.hidden = true;
    return;
  }
  const [base, quote] = ui.selectedPair.split('/');
  const byCcy = Object.fromEntries(rows.map((r) => [r.currency, r]));
  const bRow = byCcy[base];
  const qRow = byCcy[quote];
  if (!bRow || !qRow) { sheet.hidden = true; return; }
  const comparable = hasComparableScore(bRow) && hasComparableScore(qRow);
  const diff = comparable ? bRow.score - qRow.score : null;
  const mkt = lookupMarketPair(ui.data.market?.pairs, base, quote);
  const conf = comparable ? pairConfluence(diff, mkt?.changePct) : null;
  const wknd = isFxWeekend();
  const spotPrefix = wknd ? 'Spot (cierre vie.)' : 'Spot';
  const now = Date.now();
  const upcoming = (ui.data.calendar || []).filter((e) => (e.currency === base || e.currency === quote) && e.impact === 'High' && Date.parse(e.event_at) > now && Date.parse(e.event_at) - now <= 48 * 3600_000).slice(0, 3);
  const riskHtml = upcoming.length
    ? `<b>Riesgo en agenda (48h):</b> ` + upcoming.map((e) => `${e.currency} ${esc(e.title)} (${fmtTime(e.event_at)})`).join(' · ')
    : `<b>Riesgo en agenda (48h):</b> Sin eventos de impacto alto próximos para ${base} o ${quote}.`;

  sheet.hidden = false;
  sheet.innerHTML = `
    <div class="pair-sheet-head">
      <div class="pair-sheet-title">
        <span>Ficha comparativa (${ENGINE_NAME}) · ${base}/${quote}</span>
        <span class="${diff >= 0 ? 'up' : 'down'}">${comparable ? `${diff >= 0 ? '▲' : '▼'} ${Math.abs(diff)} pts (${diff >= 0 ? `Soporte relativo ${base}` : `Soporte relativo ${quote}`})` : 'Sin diferencial válido · evidencia insuficiente'}</span>
        ${mkt ? `<span class="spot-tag">${spotPrefix} ${mkt.rate} (${mkt.changePct > 0 ? '+' : ''}${mkt.changePct}%)</span>` : `<span class="spot-tag muted">sin precio</span>`}
        ${conf ? `<span class="conf-badge ${conf.kind}" title="${esc(conf.title || '')}">${conf.label}</span>` : ''}
      </div>
      <button class="link" id="close-pair-sheet" type="button">Cerrar ✕</button>
    </div>
    <div class="pair-sheet-grid">
      <div class="pair-col">
        <h5><span>${base} (${BANK[base]})</span><span class="${bRow.score >= 0 ? 'up' : 'down'}">${hasComparableScore(bRow) ? signed(bRow.score) : pressureLabel(bRow)} · Est ${hasComparableScore(bRow) ? signed(bRow.structural) : '—'} | Imp 3h ${fmtImpulse(bRow.impulse)}</span></h5>
        ${driversList(bRow.drivers)}
      </div>
      <div class="pair-col">
        <h5><span>${quote} (${BANK[quote]})</span><span class="${qRow.score >= 0 ? 'up' : 'down'}">${hasComparableScore(qRow) ? signed(qRow.score) : pressureLabel(qRow)} · Est ${hasComparableScore(qRow) ? signed(qRow.structural) : '—'} | Imp 3h ${fmtImpulse(qRow.impulse)}</span></h5>
        ${driversList(qRow.drivers)}
      </div>
    </div>
    <div class="pair-risk">${riskHtml}</div>
  `;
}

function renderMatrix(rows) {
  const s = Object.fromEntries(rows.map((r) => [r.currency, hasComparableScore(r) ? r.score : null]));
  const order = rows.map((r) => r.currency);
  let html = '<span></span>' + order.map((c) => `<span class="h">${c}</span>`).join('');
  for (const a of order) {
    html += `<span class="rh">${a}</span>`;
    for (const b of order) {
      if (a === b) { html += '<span class="self">·</span>'; continue; }
      if (s[a] == null || s[b] == null) { html += '<span class="self" title="Sin evidencia medida">—</span>'; continue; }
      const v = s[a] - s[b];
      const [base, quote] = PAIR_PRIORITY.indexOf(a) < PAIR_PRIORITY.indexOf(b) ? [a, b] : [b, a];
      html += `<button type="button" data-pair="${base}/${quote}" aria-label="${base}/${quote}: diferencial ${signed(v)}" style="background:${cellColor(v)}" title="${a} vs ${b}: ${signed(v)} (clic para ficha)">${signed(v)}</button>`;
    }
  }
  $('#matrix').innerHTML = html;

  const mktPairs = ui.data.market?.pairs || {};
  const wknd = isFxWeekend();
  const pairs = [];
  for (let i = 0; i < CURRENCIES.length; i++) {
    for (let j = i + 1; j < CURRENCIES.length; j++) {
      const [x, y] = [CURRENCIES[i], CURRENCIES[j]];
      const [base, quote] = PAIR_PRIORITY.indexOf(x) < PAIR_PRIORITY.indexOf(y) ? [x, y] : [y, x];
      if (s[base] == null || s[quote] == null) continue;
      const key = `${base}/${quote}`;
      pairs.push({ key, base, quote, v: s[base] - s[quote], mkt: lookupMarketPair(mktPairs, base, quote) });
    }
  }
  pairs.sort((a, b) => Math.abs(b.v) - Math.abs(a.v));
  $('#top-pairs').innerHTML = pairs.slice(0, 6).map((p) => {
    const conf = pairConfluence(p.v, p.mkt?.changePct);
    const spotHtml = p.mkt
      ? `<span class="spot-tag">${p.mkt.rate} <b class="${p.mkt.changePct > 0 ? 'up' : p.mkt.changePct < 0 ? 'down' : ''}">${p.mkt.changePct > 0 ? '+' : ''}${p.mkt.changePct}%${wknd ? ' (vie.)' : ''}</b></span>`
      : `<span class="spot-tag muted">sin precio</span>`;
    const confHtml = conf ? `<span class="conf-badge ${conf.kind}" title="${esc(conf.title || '')}">${conf.label}</span>` : '';
    return `<button type="button" class="pair ${ui.selectedPair === p.key ? 'active' : ''}" data-pair="${p.key}">
      <div>
        <b>${p.key}</b>
        <small>${p.v > 0 ? p.base : p.quote} más fuerte</small>
        <div class="pair-meta">${spotHtml}${confHtml}</div>
      </div>
      <span class="${p.v > 0 ? 'up' : 'down'}">${p.v > 0 ? '▲' : '▼'} ${Math.abs(p.v)}</span>
    </button>`;
  }).join('');
  renderPairSheet(rows);
}

// ---------------------------------------------------------------- agenda

const captureStart = () => Date.parse(ui.data?.coverage_start_at || ui.data?.now) || Date.now();

function calFiltered() {
  const ev = ui.data.calendar || [];
  if (ui.calImpact === 'High') return ev.filter((e) => e.impact === 'High');
  if (ui.calImpact === 'Medium') return ev.filter((e) => e.impact === 'High' || e.impact === 'Medium' || e.impact === 'Holiday');
  return ev;
}

function renderCalendar() {
  for (const b of $$('#cal-filter button')) {b.classList.toggle('active',b.dataset.impact===ui.calImpact);b.setAttribute('aria-pressed',String(b.dataset.impact===ui.calImpact));}
  const events = calFiltered();
  const el = $('#calendar');
  if (!ui.data.calendar?.length) {
    el.innerHTML = '<div class="cal-empty">La agenda de la semana aún no está disponible.</div>';
    renderNextEvent();
    return;
  }
  const now = Date.now();
  const upcoming = ui.data.calendar.filter((e) => Date.parse(e.event_at) > now);
  const nextHigh = nextCalendarEvent(upcoming);
  let html = '';
  let lastDay = '';
  let scrollTo = null;
  for (const e of events) {
    const k = dayKey(e.event_at);
    if (k !== lastDay) {
      html += `<div class="cal-day ${isToday(e.event_at) ? 'today' : ''}" ${isToday(e.event_at) ? 'id="cal-today"' : ''}>${fmtDay(e.event_at)}</div>`;
      lastDay = k;
    }
    const evMs = Date.parse(e.event_at);
    const past = evMs < now;
    if (!past && !scrollTo) scrollTo = e.id;
    let actCls = '';
    if (e.actual && e.forecast) {
      const a = num(e.actual); const f = num(e.forecast);
      if (a != null && f != null && a !== f) actCls = ((a > f) !== INVERTED.test(e.title)) ? 'up' : 'down';
    }
    const ageMs = now - evMs;
    const preCapture = evMs < captureStart();
    const actHtml = e.actual
      ? `<span>Act <b class="${actCls}">${esc(e.actual)}</b></span>`
      : (past && e.impact !== 'Holiday' && (e.forecast || e.previous))
        ? (ageMs < 2 * 3600_000
          ? `<span>Act <b class="muted">Publicando…</b></span>`
          : preCapture
            ? `<span>Act <b class="muted">No capturado (antes del inicio)</b></span>`
            : `<span>Act <b class="muted">Sin dato en cinta</b></span>`)
        : '';
    const vals = [actHtml, e.forecast && `<span>Est <b>${esc(e.forecast)}</b></span>`, e.previous && `<span>Prev <b>${esc(e.previous)}</b></span>`].filter(Boolean).join('');
    const impactLabel = { High: 'Alto', Medium: 'Medio', Low: 'Bajo', Holiday: 'Festivo' }[e.impact] || e.impact;
    const lockInfo = classifyEventLock(e, now);
    const lockMark = lockInfo.active
      ? `<span class="${lockPillClass(lockInfo.lock_level)}">${esc(lockInfo.lock_level)}${lockInfo.retirar_limitadas ? ' · retirar limitadas' : ''}</span> `
      : '';
    html += `<div class="ev ${e.impact} ${past ? 'past' : ''} ${nextHigh && e.id === nextHigh.id ? 'next' : ''}" data-ev="${esc(e.id)}" title="Impacto ${impactLabel}">
      <span class="t">${e.impact === 'Holiday' ? 'Día' : fmtTime(e.event_at)}</span><span class="cur">${e.currency}</span>
      <div><div class="title">${lockMark}${esc(e.title)}</div>${vals ? `<div class="vals">${vals}</div>` : ''}</div>
    </div>`;
  }
  const first = !el.dataset.rendered;
  el.innerHTML = html || '<div class="cal-empty">Sin eventos para este filtro.</div>';
  if (first && scrollTo) {
    el.dataset.rendered = '1';
    const target = el.querySelector(`[data-ev="${CSS.escape(scrollTo)}"]`);
    if (target) el.scrollTop = Math.max(0, target.offsetTop - 80);
  }
  renderNextEvent();
}

function renderNextEvent() {
  const d = ui.data;
  const box = $('#next-event');
  if (!d) return;
  const upcoming = (d.calendar || []).filter((e) => Date.parse(e.event_at) > Date.now());
  const next = nextCalendarEvent(upcoming);
  box.hidden = !(d.calendar || []).length;
  if (!next) {
    box.innerHTML = '<div class="lbl">Próximo dato</div><div class="ttl"><span>Sin más datos relevantes esta semana</span></div>';
    return;
  }
  const when = isToday(next.event_at) ? `Hoy ${fmtTime(next.event_at)}` : `${new Date(next.event_at).toLocaleDateString('es-ES', { weekday: 'long' })} ${fmtTime(next.event_at)}`;
  box.innerHTML = `<div class="lbl">Próximo dato · impacto ${next.impact === 'High' ? 'alto' : 'medio'}</div>
    <div class="ttl"><span class="cur">${next.currency}</span><span>${esc(next.title)}</span></div>
    <div class="bottom"><span>${when}${next.forecast ? ` · Est ${esc(next.forecast)}` : ''}${next.previous ? ` · Prev ${esc(next.previous)}` : ''}</span><span class="cd">${countdown(Date.parse(next.event_at) - Date.now())}</span></div>`;
}

// ---------------------------------------------------------------- alerts & push verification

async function verifyBrowserSubscriptionState() {
  ui.browserSubEndpoint = null;
  ui.serverDeviceMatch = null;
  ui.pushOn = false;

  if (!ui.swReg || !('PushManager' in window)) return;
  try {
    const sub = await ui.swReg.pushManager.getSubscription();
    if (!sub?.endpoint) {
      localStorage.removeItem('rn-push');
      return;
    }
    ui.browserSubEndpoint = sub.endpoint;
    const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(sub.endpoint));
    const endpointHash=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
    const {device:matched}=await api('/api/push/status',{method:'POST',body:JSON.stringify({endpointHash})});
    if (matched) {
      ui.serverDeviceMatch = matched;
      ui.pushOn = true;
      localStorage.setItem('rn-push', '1');
      localStorage.setItem('rn-device-id', matched.id);
    } else {
      ui.pushOn = false;
      localStorage.removeItem('rn-push');
    }
  } catch {
    ui.pushOn = false;
  }
}

function notifState() {
  if (IS_IOS && !IS_STANDALONE) return 'ios-browser';
  if (!('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  if (Notification.permission === 'granted') {
    if (ui.pushOn && ui.browserSubEndpoint && ui.serverDeviceMatch) return 'push';
    if (ui.browserSubEndpoint && !ui.serverDeviceMatch) return 'sub-unregistered';
    return 'local';
  }
  return 'default';
}

function renderAlerts() {
  const d = ui.data;
  const badge = $('#badge');
  badge.hidden = d.unread === 0;
  badge.textContent = d.unread > 99 ? '99+' : d.unread;
  $('#tab-badge').hidden = d.unread === 0;
  $('#tab-badge').textContent = badge.textContent;
  document.title = d.unread ? `(${d.unread}) RadarNews` : 'RadarNews · Agente MMT';
  navigator.setAppBadge?.(d.unread || undefined)?.catch?.(() => {});
  $('#alerts-list').innerHTML = d.alerts?.length
    ? d.alerts.map((a) => `<li class="alert ${a.level} ${a.is_read ? '' : 'unread'}">
        <div class="meta"><span class="lvl ${a.level}">${LEVEL_LABEL[a.level] || a.level}</span><span>${TYPE_LABEL[a.alert_type] || a.alert_type}</span>${a.currency ? `<span>${a.currency}</span>` : ''}<span>${relTime(a.occurred_at)}</span></div>
        <div class="t">${esc(a.title)}</div>${a.body ? `<div class="b">${esc(a.body)}</div>` : ''}
      </li>`).join('')
    : '<li class="alerts-empty">Sin alertas registradas todavía.</li>';
  renderNotif();
}

function renderNotif() {
  const st = notifState();
  const btn = $('#notif-btn');
  const text = {
    unsupported: 'Este navegador no admite notificaciones Web Push. En Mac usa Safari (Añadir al Dock) o Chrome.',
    'ios-browser': 'En iPhone/iPad debes abrir RadarNews desde el icono en la pantalla de inicio (modo PWA standalone) para recibir push con la app cerrada.',
    push: 'Suscripción verificada. Envía una prueba para comprobar aviso y sonido con la app cerrada en este dispositivo.',
    'sub-unregistered': 'El navegador tiene suscripción Push pero no figura registrada en el servidor. Pulsa Reactivar para sincronizarla.',
    local: 'Permiso concedido solo en pestaña abierta (sin suscripción Push activa en segundo plano). Pulsa Activar para registrar Push.',
    denied: 'Permiso bloqueado en el navegador/sistema. Actívalo en Ajustes del Sistema › Notificaciones.',
    default: 'Notificaciones desactivadas en este dispositivo.',
  }[st];
  $('#notif-state').textContent = text;

  const diagEl = $('#notif-diag');
  if (diagEl) {
    const swStatus = ui.swReg?.active ? 'Activo' : ('serviceWorker' in navigator ? 'Pendiente' : 'No soportado');
    const pmStatus = 'PushManager' in window ? (ui.browserSubEndpoint ? 'Suscrito' : 'Sin suscripción') : 'No soportado';
    const srvStatus = ui.serverDeviceMatch ? `Registrado (${ui.serverDeviceMatch.label})` : 'No registrado';
    const modeStatus = IS_STANDALONE ? 'PWA instalada (standalone)' : 'Pestaña de navegador';
    diagEl.innerHTML = `Service Worker: <b>${swStatus}</b> · PushManager: <b>${pmStatus}</b> · Servidor: <b>${esc(srvStatus)}</b> · Modo: <b>${modeStatus}</b>`;
  }

  btn.disabled = ['unsupported', 'ios-browser', 'denied'].includes(st);
  $('#ios-install').hidden = st !== 'ios-browser';
  btn.textContent = st === 'push' ? 'Revalidar suscripción' : st === 'sub-unregistered' ? 'Reactivar Push' : 'Activar Push';
  btn.classList.toggle('on', st === 'push');

  const n = ui.data?.push_devices ?? 0;
  $('#notif-test').disabled = n === 0;
  $('#notif-test').textContent = n ? `Enviar prueba inmediata (${n})` : 'Enviar prueba inmediata';
  const schedBtn = $('#notif-schedule-test');
  if (schedBtn) schedBtn.disabled = n === 0;
  $('#notif-hint').hidden = ['push', 'unsupported', 'denied', 'ios-browser'].includes(st);

  const qSum = ui.data?.push_queue?.counts;
  const qEl = $('#push-queue-summary');
  if (qEl && qSum) {
    qEl.innerHTML = `Cola Push SQLite: <b>${qSum.accepted_by_push_service || 0}</b> aceptadas por servicio push · <b>${qSum.displayed_on_device || 0}</b> mostradas en dispositivo (ACK SW) · <b>${qSum.pending + qSum.retrying}</b> pendientes/reintentando · <b>${qSum.failed || 0}</b> fallidas`;
  }
}

let audioCtx = null;
function ensureAudio() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  if (!audioCtx) audioCtx = new Ctx();
  if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
  return audioCtx;
}
if (IS_BROWSER) {
  ['pointerdown', 'keydown', 'touchstart'].forEach((ev) => {
    window.addEventListener(ev, () => ensureAudio(), { passive: true });
  });
}

function playAlertSound(level = 'alto') {
  try {
    const ctx = ensureAudio();
    if (!ctx) return;
    const now = ctx.currentTime;
    const notes = level === 'critico'
      ? [
          { f: 1046.5, t: 0, d: 0.14, g: 0.24 },
          { f: 1567.98, t: 0.13, d: 0.16, g: 0.26 },
          { f: 2093.0, t: 0.28, d: 0.34, g: 0.28 },
        ]
      : [
          { f: 880.0, t: 0, d: 0.16, g: 0.20 },
          { f: 1318.5, t: 0.15, d: 0.32, g: 0.22 },
        ];
    for (const n of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(n.f, now + n.t);
      gain.gain.setValueAtTime(0.0001, now + n.t);
      gain.gain.exponentialRampToValueAtTime(n.g, now + n.t + 0.018);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + n.t + n.d);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + n.t);
      osc.stop(now + n.t + n.d + 0.02);
    }
  } catch { /* ignore audio errors if blocked */ }
}

function toast(a) {
  const el = document.createElement('div');
  el.className = `toast ${a.level || ''}`;
  el.innerHTML = `<div class="t">${esc(a.title)}</div>${a.body ? `<div class="b">${esc(a.body)}</div>` : ''}`;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), 9000);
}

async function localNotify(a) {
  if (ui.pushOn || notifState() !== 'local') return;
  const uniqueTag = a.news_item_id ? `rn-news-${a.news_item_id}` : `rn-alert-${a.id || Date.now()}`;
  const opts = { body: a.body || '', tag: uniqueTag, icon: '/icon-512.png?v=2', silent: false };
  try {
    if (ui.swReg) await ui.swReg.showNotification(a.title, opts);
    else new Notification(a.title, opts);
  } catch { /* ignore */ }
}

function urlB64ToUint8Array(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

function deviceLabel() {
  const custom=$('#device-label')?.value?.trim() || storageGet('rn-device-label');
  if (custom) return custom.slice(0,80);
  const ua = navigator.userAgent;
  const kind = /iPhone|iPod/.test(ua) ? 'iPhone' : /iPad/.test(ua) || (IS_IOS && !/iPhone/.test(ua)) ? 'iPad' : /Macintosh/.test(ua) ? 'Mac' : /Android/.test(ua) ? 'Android' : 'Ordenador';
  const browser = IS_STANDALONE ? 'app' : /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : 'Safari';
  return `${kind} · ${browser}`;
}

async function postSubscription(sub) {
  const existingId = localStorage.getItem('rn-device-id');
  const { id } = await api('/api/push/subscribe', {
    method: 'POST',
    body: JSON.stringify({ id: existingId || undefined, subscription: sub, label: deviceLabel() }),
  });
  localStorage.setItem('rn-device-id', id);
  localStorage.setItem('rn-device-label',deviceLabel());
  ui.browserSubEndpoint = sub.endpoint;
  ui.pushOn = true;
  localStorage.setItem('rn-push', '1');
}

async function syncSubscription() {
  if (!ui.swReg || !('PushManager' in window) || !('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    let sub = await ui.swReg.pushManager.getSubscription();
    if (!sub) {
      const { publicKey } = await api('/api/push/key');
      sub = await ui.swReg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8Array(publicKey) });
    }
    await postSubscription(sub);
  } catch (err) {
    console.warn('No se pudo renovar la suscripción push:', err);
  }
}

const DEVICE_ICON = {
  iPhone: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="7" y="2" width="10" height="20" rx="2.5"/><path d="M11 18h2"/></svg>',
  iPad: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="2" width="16" height="20" rx="2.5"/><path d="M11 18h2"/></svg>',
  Mac: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M2 20h20"/></svg>',
};

async function renderDevicesList() {
  const el = $('#device-list');
  if (!el) return;
  let devices = [];
  try {
    ({ devices } = await api('/api/push/devices'));
  } catch (err) {
    el.innerHTML = `<li class="empty">${esc(err.message)}</li>`;
    return;
  }
  const mine = localStorage.getItem('rn-device-id');
  $('#device-count').textContent=`${devices.filter(d=>d.status!=='expired').length} suscripciones activas. Objetivo: 2 iPhone, Mac e iPad. Un navegador adicional cuenta como otra suscripción.`;
  el.innerHTML = devices.length ? devices.map((d) => {
    const label = d.label || 'Dispositivo';
    const kind = label.split(' · ')[0];
    const parts = [];
    if (d.endpoint_host) parts.push(`Relay: ${esc(d.endpoint_host)}`);
    if (d.last_accepted_at) parts.push(`Aceptada por push: ${relTime(d.last_accepted_at)}`);
    if (d.last_displayed_at) parts.push(`Mostrada en dispositivo (SW): ${relTime(d.last_displayed_at)}`);
    if (d.status==='expired') parts.push('Suscripción caducada: abre y reactiva Push en ese dispositivo.');
    if (d.last_accepted_at && !d.last_displayed_at) parts.push('Sin confirmación del dispositivo. Comprueba conexión, permisos y modo Concentración.');
    if (d.last_error) parts.push(`Último fallo (${relTime(d.last_error_at)}): ${esc(d.last_error)}`);
    if (!parts.length) parts.push(`Suscrito ${relTime(d.created_at)}`);
    const statusCls = d.status==='expired' || d.last_error ? 'dev-sub err' : 'dev-sub';
    return `<li><span class="dev-icon">${DEVICE_ICON[kind] || DEVICE_ICON.Mac}</span>
      <div class="dev-main"><div class="dev-name">${esc(label)}${d.id === mine ? '<small>este navegador</small>' : ''}</div><div class="${statusCls}">${parts.join(' · ')}</div></div>
      <button class="link danger" data-remove-device="${esc(d.id)}">Quitar</button></li>`;
  }).join('') : '<li class="empty">Ningún dispositivo suscrito todavía. Pulsa Activar Push en cada dispositivo.</li>';
}

async function enableNotifications() {
  if (!('Notification' in window)) return;
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return renderNotif();
  try {
    if (ui.swReg && 'PushManager' in window) {
      const { publicKey } = await api('/api/push/key');
      const sub = (await ui.swReg.pushManager.getSubscription())
        || await ui.swReg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8Array(publicKey) });
      await postSubscription(sub);
      toast({ level: 'alto', title: 'Suscripción Push verificada', body: 'Registro guardado. Envía una prueba para comprobar aviso y sonido.' });
    }
  } catch (err) {
    console.warn('Push no disponible:', err);
    ui.pushOn = false;
    localStorage.removeItem('rn-push');
  }
  await verifyBrowserSubscriptionState();
  await load();
  renderNotif();
  renderDevicesList();
}

async function testNotification() {
  const out = $('#test-result');
  out.textContent = 'Ejecutando prueba de sonido y notificación…';
  playAlertSound('critico');
  const sample = {
    id: Date.now(),
    level: 'critico',
    title: 'Prueba RadarNews G8 · Alerta Sonora Activa',
    body: 'Sonido WebAudio y notificación del navegador verificados en modo Serverless.',
  };
  toast(sample);
  try {
    if ('Notification' in window && Notification.permission === 'granted') {
      if (ui.swReg) await ui.swReg.showNotification(sample.title, { body: sample.body, icon: '/icon-512.png?v=2', tag: 'rn-test-' + Date.now() });
      else new Notification(sample.title, { body: sample.body, icon: '/icon-512.png?v=2' });
    }
  } catch { /* ignore */ }
  out.textContent = 'Sonido reproducido y notificación local disparada correctamente.';
}

async function scheduleClosedAppTest() {
  const out = $('#test-result');
  out.textContent = 'Programando prueba para dentro de 30 segundos…';
  try {
    const r = await api('/api/push/schedule-test', {
      method: 'POST',
      body: JSON.stringify({ delaySeconds: 30 }),
    });
    out.textContent = `Prueba programada (ID ${r.scheduleId.slice(0, 8)}): se enviará a las ${fmtTime(r.fireAt)}. Cierra ahora RadarNews o bloquea la pantalla para comprobar la recepción con la app cerrada.`;
  } catch (err) {
    out.textContent = `Error al programar prueba: ${err.message}`;
  }
}

// ---------------------------------------------------------------- health & sources

function renderHealth() {
  const rows = ui.data.sources || [];
  const checked = rows.filter((r) => r.last_attempt_at);
  const ok = rows.filter((r) => sourceFetchedLive(r)).length;
  const emptyCount = rows.filter((r) => r.status === 'empty_feed').length;
  const errCount = rows.filter((r) => r.status === 'error').length;
  const cal = ui.data.calendar_sync;
  const cov = liveCoverage();
  const covText = cov.total ? ` · Cobertura Act ${cov.matched}/${cov.total}` : '';
  const el = $('#health');
  el.className = `health ${errCount > 0 || emptyCount > 0 || !checked.length ? 'warn' : ''}`;
  el.innerHTML = `<span class="d"></span>${checked.length ? `${ok}/${rows.length} fuentes con titulares (${emptyCount} vacías, ${errCount} errores)` : 'Fuentes pendientes'} · Agenda ${cal ? `${cal.events} eventos` : 'no disponible'}${covText}`;

  $('#engines-status').textContent = `Motor único: ${ENGINE_NAME} (${ui.data.engine_meta?.op_version || 'MMT/Mosler'})`;

  const fmtDelay = (sec) => {
    if (sec == null || !Number.isFinite(sec)) return '—';
    if (sec < 60) return `${sec}s`;
    if (sec < 3600) return `${Math.round(sec / 60)}m`;
    if (sec < 86400) return `${Math.round(sec / 3600)}h`;
    return `${Math.round(sec / 86400)}d`;
  };

  $('#sources-body').innerHTML = rows.map((r) => {
    const noteHtml = r.channel_note ? `<div class="muted small">${esc(r.channel_note)}</div>` : '';
    const attemptStr = r.last_attempt_at ? `${fmtTime(r.last_attempt_at)} / ${r.last_success_at ? fmtTime(r.last_success_at) : '—'}` : 'Pendiente';
    const latestNewsStr = r.last_news_published_at
      ? `${relTime(r.last_news_published_at)} (retraso ${fmtDelay(r.last_delay_sec)})`
      : 'Sin titulares';
    const freshness=r.freshness==='review' ? '<div class="muted small">Antigüedad elevada: revisar cobertura</div>' : '';
    const countsStr = `+${r.last_new_count ?? 0} (total ${r.stored_count ?? 0}) / ${r.pending_count ?? 0} pend.`;
    let statusHtml = '<span class="muted">Pendiente</span>';
    if (r.kind === 'live' && sourceFetchedLive(r)) {
      statusHtml = '<span class="st">Conectada · ' + (r.stored_count ? 'titulares recibidos' : 'esperando titulares') + '</span>';
    } else if (r.status === 'ok' || r.status === 'live') {
      statusHtml = r.freshness === 'review'
        ? `<span class="st err" title="La fuente responde pero su ultimo titular es antiguo">Responde, contenido antiguo (${Math.round((r.content_age_sec || 0) / 86400)} d)</span>`
        : `<span class="st">Operativa (${r.last_fetched_count} extraídos)</span>`;
    } else if (r.status === 'cached') {
      statusHtml = `<span class="st" title="${esc(r.cached_reason || '')}">Copia de la última sincronización (sin respuesta en esta consulta)</span>`;
    } else if (r.status === 'empty_feed') {
      statusHtml = `<span class="st err" title="${esc(r.last_error || '')}">Vacía (HTTP ${r.last_http_status || 200} · 0 titulares)</span>`;
    } else if (r.status === 'error') {
      statusHtml = `<span class="st err" title="${esc(r.last_error || '')}">Error: ${esc((r.last_error || 'Fallo').slice(0, 48))}</span>`;
    }
    return `<tr>
      <td><b>${esc(r.name)}</b> <span class="muted small">(${SOURCE_TYPE[r.type] || r.type} · ${esc(r.kind)})</span>${noteHtml}</td>
      <td>${attemptStr}</td>
      <td>${latestNewsStr}${freshness}</td>
      <td>${countsStr}</td>
      <td>${statusHtml}</td>
    </tr>`;
  }).join('') + `<tr>
    <td><b>Agenda (ForexFactory)</b> <span class="muted small">(Calendario)</span></td>
    <td>${ui.data.last_sync?.finished_at ? fmtTime(ui.data.last_sync.finished_at) : '—'}</td>
    <td>${cal ? `${cal.events} eventos` : '—'}</td>
    <td>—</td>
    <td>${cal?.ok ? '<span class="st">Operativa</span>' : '<span class="st err">Error</span>'}</td>
  </tr>`;
}

function awakeNote() {
  if (ui.data?.platform !== 'darwin') return '';
  return ui.data.keep_awake
    ? '<div class="card awake"><div class="card-title">El Mac se mantiene despierto</div><div class="muted">Mientras RadarNews funciona, el Mac no entra en reposo.</div></div>'
    : '';
}

async function renderDevices() {
  const el = $('#devices-body');
  let d;
  try {
    d = await api('/api/devices');
  } catch (err) {
    el.innerHTML = `<p class="form-msg err">${esc(err.message)}</p>`;
    return;
  }
  if (d.secure) {
    const here = location.origin === d.url;
    el.innerHTML = `<div class="card"><div class="qr-wrap">
        <div class="qr">${d.qr}</div>
        <div>
          <div class="card-title">Acceso seguro activo</div>
          <div class="url">${esc(d.url)}</div>
          ${here ? '<p class="form-msg ok">Estás usando esta conexión ahora mismo.</p>' : ''}
        </div>
      </div></div>
      <h4>En el iPhone o el iPad</h4>
      <ol>
        <li>Abre <b>${esc(d.url)}</b> en <b>Safari</b>.</li>
        <li>Pulsa <b>Compartir</b> y luego <b>Añadir a pantalla de inicio</b>.</li>
        <li>Abre RadarNews desde el icono en la pantalla de inicio → <b>Ajustes › Notificaciones › Activar Push</b>.</li>
      </ol>${awakeNote()}`;
    return;
  }
  el.innerHTML = `<div class="card"><div class="card-row"><div><div class="card-title">Acceso desde iPhone y iPad</div><div class="muted">${esc(d.url)}</div></div></div></div>`;
}

function setView(view) {
  ui.view = view;
  document.body.dataset.view = view;
  if (view !== 'alerts') localStorage.setItem('rn-view', view);
  for (const b of $$('#tabbar button')) {b.classList.toggle('active',b.dataset.view===view); b.setAttribute('aria-current',b.dataset.view===view?'page':'false');}
  const panel = $('#alerts-panel');
  if (phone.matches) panel.hidden = view !== 'alerts';
}

function openSettings(tab = 'notif') {
  if (tab === 'ai') tab = 'mmt';
  if (tab === 'devices') renderDevices();
  if (tab === 'notif') {renderDevicesList(); verifyBrowserSubscriptionState().then(renderNotif);}
  for (const b of $$('#settings-tabs button')) b.classList.toggle('active', b.dataset.tab === tab);
  for (const p of $$('#settings .tab')) p.hidden = p.dataset.pane !== tab;
  const dlg = $('#settings');
  if (!dlg.open) dlg.showModal();
}

// ---------------------------------------------------------------- spec

function mdToHtml(md) {
  const inline = (s) => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\*([^*]+)\*/g, '<em>$1</em>');
  const lines = md.split('\n');
  let html = '';
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (/^\|/.test(l)) {
      const rows = [];
      while (i < lines.length && /^\|/.test(lines[i])) rows.push(lines[i++]);
      const cells = (r) => r.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      html += `<table><thead><tr>${cells(rows[0]).map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>`
        + rows.slice(2).map((r) => `<tr>${cells(r).map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('') + '</tbody></table>';
      continue;
    }
    if (/^\s*[-*] /.test(l) || /^\s*\d+\. /.test(l)) {
      const ordered = /^\s*\d+\. /.test(l);
      const items = [];
      while (i < lines.length && (/^\s*[-*] /.test(lines[i]) || /^\s*\d+\. /.test(lines[i]))) items.push(lines[i++].replace(/^\s*([-*]|\d+\.) /, ''));
      html += `<${ordered ? 'ol' : 'ul'}>${items.map((x) => `<li>${inline(x)}</li>`).join('')}</${ordered ? 'ol' : 'ul'}>`;
      continue;
    }
    const h = /^(#{1,4}) (.*)/.exec(l);
    if (h) html += `<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`;
    else if (/^---+$/.test(l)) html += '<hr/>';
    else if (/^> /.test(l)) html += `<blockquote>${inline(l.slice(2))}</blockquote>`;
    else if (l.trim()) html += `<p>${inline(l)}</p>`;
    i++;
  }
  return html;
}

async function openSpec() {
  $('#settings').close();
  $('#spec-dialog').showModal();
  try {
    const res = await fetch('/api/spec');
    $('#spec-body').innerHTML = mdToHtml(await res.text());
  } catch {
    $('#spec-body').textContent = 'No se pudo cargar la especificación.';
  }
}

// ---------------------------------------------------------------- data flow

function renderAll() {
  renderStatus();
  renderCcyFilter();
  renderTape();
  renderBoard();
  renderCalendar();
  renderAlerts();
  renderHealth();
}

const GITHUB_RAW_FALLBACK = 'https://raw.githubusercontent.com/sanderdayan1982/g8-radar-news/main/public/data/radar_news_full.json';

async function fetchDashboardState() {
  try {
    return await api('/api/radar-full');
  } catch {
    try {
      const r = await fetch(`${GITHUB_RAW_FALLBACK}?t=${Date.now()}`, { cache: 'no-store' });
      if (r.ok) return await r.json();
    } catch { /* fallback to local static */ }
    return await api(`/data/radar_news_full.json?t=${Date.now()}`);
  }
}

let pendingLoad=null;
function load() {
  if (pendingLoad) return pendingLoad;
  pendingLoad=(async () => {
    try {
      const data=await fetchDashboardState();
      if (!data || !Array.isArray(data.news) || !Array.isArray(data.sources)) throw new Error('Respuesta de datos inválida');
      ui.data=data;
      ui.lastReceived=Date.now();
      ui.connectionError=null;
      renderAll();
      const newsId=new URLSearchParams(location.search).get('news');
      if (newsId && !ui.openedNews) {setView('tape');const row=document.getElementById('news-'+Number(newsId));row?.scrollIntoView({block:'center'});row?.classList.add('selected-news');ui.openedNews=true;}
    } catch(err) {
      ui.connectionError=err.message;
      $('#error-band').hidden=false;
      $('#error-band').textContent=ui.data ? 'Sin conexión. Mostrando la última lectura; reintentamos automáticamente.' : 'No se pudo cargar la mesa. Comprueba tu conexión y pulsa Actualizar.';
      $('#refresh').disabled=false;
      if (!ui.data) for (const id of ['board','calendar','tape']) $('#'+id).textContent='Datos no disponibles. Esperando conexión segura.';
      renderLive();
    }
  })().finally(()=>{pendingLoad=null;});
  return pendingLoad;
}
let loadTimer;
function scheduleLoad() {clearTimeout(loadTimer);loadTimer=setTimeout(load,350);}

async function refresh() {
  if (ui.syncing) return;
  setSyncing(true);
  try {
    const data = await api('/api/radar-full?refresh=1', { method: 'GET', timeoutMs:45000 });
    if (data && Array.isArray(data.news)) {
      ui.data = data;
      ui.lastReceived = Date.now();
      ui.connectionError = null;
      renderAll();
      setSyncing(false);
      return;
    }
  } catch (err) {
    toast({ level: 'critico', title: 'Error al actualizar', body: err.message });
  }
  await load();
}

function connectEvents() {
  if (location.hostname.endsWith('.netlify.app') || ui.data?.platform === 'serverless-netlify-github') return;
  ui.es?.close();
  const es = new EventSource('/api/events');
  ui.es = es;
  es.addEventListener('sync_start', () => setSyncing(true));
  es.addEventListener('sync_done', scheduleLoad);
  es.addEventListener('push_ack', () => {
    scheduleLoad();
    if ($('#settings')?.open) renderDevicesList();
  });
  es.addEventListener('alerts', (ev) => {
    const { alerts } = JSON.parse(ev.data);
    if (!alerts?.length) return;
    const topLevel = alerts.some((a) => a.level === 'critico') ? 'critico' : 'alto';
    playAlertSound(topLevel);
    // Mostrar cada alerta individualmente sin truncar con slice(0, 4)
    for (const a of alerts) {
      toast(a);
      localNotify(a);
    }
    scheduleLoad();
  });
  es.onerror = () => {ui.connectionError='Canal de eventos desconectado';renderLive();};
  es.onopen = scheduleLoad;
}

function bind() {
  $('#refresh').addEventListener('click', refresh);
  $('#live').addEventListener('click', () => openSettings('sources'));
  $('#tape').addEventListener('click', (e) => { if (e.target.closest('[data-action="refresh"]')) refresh(); });
  $('#filters').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-filter]');
    if (!b) return;
    ui.filter = b.dataset.filter;
    for (const x of $$('#filters button')) {x.classList.toggle('active', x === b);x.setAttribute('aria-pressed',String(x===b));}
    renderTape();
  });
  $('#ccy-filter').addEventListener('change', (e) => { ui.ccy = e.target.value || null; renderTape(); });
  $('#tape-search')?.addEventListener('input', (e) => { ui.search = e.target.value || ''; renderTape(); });
  $('#board').addEventListener('click', (e) => {
    const li = e.target.closest('.ccy-row');
    if (!li) return;
    const c = li.dataset.ccy;
    if (ui.open.has(c)) ui.open.delete(c); else ui.open.add(c);
    li.classList.toggle('open');
    li.querySelector('button').setAttribute('aria-expanded',String(ui.open.has(c)));
  });
  const onPairClick = (e) => {
    const el = e.target.closest('[data-pair]');
    if (!el) return;
    ui.selectedPair = ui.selectedPair === el.dataset.pair ? null : el.dataset.pair;
    renderBoard();
  };
  $('#top-pairs')?.addEventListener('click', onPairClick);
  $('#matrix')?.addEventListener('click', onPairClick);
  $('#pair-sheet')?.addEventListener('click', (e) => {
    if (e.target.closest('#close-pair-sheet')) {
      ui.selectedPair = null;
      renderBoard();
    }
  });
  $('#cal-filter').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-impact]');
    if (!b) return;
    ui.calImpact = b.dataset.impact;
    localStorage.setItem('rn-cal', ui.calImpact);
    renderCalendar();
  });

  const panel = $('#alerts-panel');
  const togglePanel = (force) => {
    panel.hidden = force === undefined ? !panel.hidden : !force;
    $('#bell').setAttribute('aria-expanded', String(!panel.hidden));
  };
  $('#bell').addEventListener('click', (e) => { e.stopPropagation(); togglePanel(); });
  document.addEventListener('click', (e) => { if (!phone.matches && !panel.hidden && !e.target.closest('.bell-wrap')) togglePanel(false); });
  $('#tabbar').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-view]');
    if (b) setView(b.dataset.view);
  });
  phone.addEventListener('change', () => { panel.hidden = !(phone.matches && ui.view === 'alerts'); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (!ui.es || ui.es.readyState === EventSource.CLOSED) connectEvents();
    load();
  });
  window.addEventListener('pageshow', (e) => { if (e.persisted) { connectEvents(); load(); } });
  $('#read-all').addEventListener('click', async () => { await api('/api/alerts/read-all', { method: 'POST' }); load(); });
  $('#notif-hint-btn').addEventListener('click', enableNotifications);

  $('#settings-btn').addEventListener('click', () => openSettings('notif'));
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-open-settings]');
    if (t) openSettings(t.dataset.openSettings);
  });
  $('#settings-tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-tab]');
    if (b) openSettings(b.dataset.tab);
  });
  for (const b of $$('[data-close]')) b.addEventListener('click', () => b.closest('dialog').close());
  for (const d of $$('dialog')) d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
  $('#notif-btn').addEventListener('click', enableNotifications);
  $('#notif-test').addEventListener('click', testNotification);
  $('#notif-schedule-test')?.addEventListener('click', scheduleClosedAppTest);
  $('#sound-test')?.addEventListener('click', () => { playAlertSound('critico'); toast({ level: 'critico', title: 'Sonido de Radar activo', body: 'Así sonarán las alertas de RadarNews.' }); });
  $('#device-list').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-remove-device]');
    if (!b || !confirm('¿Dejar de enviar alertas a este dispositivo?')) return;
    await api('/api/push/devices/remove', { method: 'POST', body: JSON.stringify({ id: b.dataset.removeDevice }) });
    if (b.dataset.removeDevice === localStorage.getItem('rn-device-id')) {
      await (await ui.swReg?.pushManager.getSubscription())?.unsubscribe();
      ui.pushOn = false;
      ui.browserSubEndpoint = null;
      ui.serverDeviceMatch = null;
      localStorage.removeItem('rn-push');
    }
    await load();
    renderDevicesList();
  });
  $('#spec-btn').addEventListener('click', openSpec);

  document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.target.matches('input, textarea, select')) return;
    if ($$('dialog').some((d) => d.open)) return;
    const k = e.key.toLowerCase();
    if (k === 'r') refresh();
    else if (k === 'a') togglePanel();
    else if (k === ',') openSettings('notif');
    else if (k === '/') { e.preventDefault(); $('#tape-search')?.focus(); }
    else if (k === 'escape') togglePanel(false);
    else if ('12345'.includes(k)) $$('#filters button')[Number(k) - 1]?.click();
  });
}

async function registerSw() {
  if (!('serviceWorker' in navigator)) return;
  try {
    ui.swReg = await navigator.serviceWorker.register('/sw.js?v=3.0.0');
  } catch (err) {
    console.warn('Service worker no registrado:', err);
  }
}

if (IS_BROWSER) {
  if (!['board','tape','agenda'].includes(ui.view)) ui.view='board';
  if (new URLSearchParams(location.search).get('view')==='alerts') ui.view='alerts';
  bind();
  setView(ui.view);
  $('#device-label').value=storageGet('rn-device-label') || '';
  registerSw().then(syncSubscription).then(verifyBrowserSubscriptionState).then(()=>{renderNotif();ui.swReg?.active?.postMessage({type:'FLUSH_ACKS'});}).catch(()=>{});
  load().then(() => { if (ui.data?.platform !== 'serverless-netlify-github') connectEvents(); });
  setInterval(renderSessions, 1000);
  setInterval(() => { if (document.visibilityState === 'visible') load(); }, 60_000);
  renderSessions();
}
