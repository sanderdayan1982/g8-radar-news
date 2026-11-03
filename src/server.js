import { startFinancialJuice } from './financialjuice.js';
import { createAccess } from './access.js';
import { RELEASE, endpointHash, sourceHealth, validPushSubscription, sameOriginMutation } from './operations.js';
import { randomUUID } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import compression from 'compression';
import express from 'express';
import QRCode from 'qrcode';
import webpush from 'web-push';
import { HOST, PORT, SOURCES, WINDOWS, ENGINE_NAME, DATA_DIR } from './config.js';
import {
  openDb,
  getMeta,
  setMeta,
  listNews,
  latestEngine,
  insertAlert,
  listAlerts,
  unreadCount,
  markAlertsRead,
  listCalendar,
  saveDevice,
  listDevices,
  removeDevice,
  saveMarketSnapshot,
  enqueuePushForAlerts,
  listDuePushQueue,
  markPushQueueAccepted,
  markPushQueueDisplayed,
  markPushQueueFailure,
  getPushQueueSummary,
  listSourceStates,
} from './db.js';
import { refreshFeed } from './refreshFeed.js';
import { fetchMarket } from './market.js';
import { turboEvent } from './calendar.js';
import { readSettings, writeSettings, scrubGeminiFromSettings, DEFAULT_VAPID_SUBJECT } from './settings.js';
import { OP_VERSION, SHADOW_VERSION } from './shadowCalibration.js';

const SRC = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(SRC);
const PUBLIC = join(ROOT, 'public');
const SPEC = join(ROOT, 'SPEC.md');

const IS_TEST = process.env.RADARNEWS_NO_LISTEN === '1'
  || Boolean(process.env.NODE_TEST_CONTEXT)
  || process.execArgv.includes('--test')
  || process.argv.includes('--test');

if (!IS_TEST) {
  scrubGeminiFromSettings();
}
const db = openDb(IS_TEST ? ':memory:' : undefined);
const app = express();
const access=IS_TEST ? null : createAccess(DATA_DIR,{secure:process.env.NODE_ENV!=='development'});
app.disable('x-powered-by');
app.use(compression());
app.use(sameOriginMutation);
app.use(express.json({ limit: '64kb' }));
app.use((req, res, next) => {
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});
// Only login assets and the authenticated-delivery receipt endpoint are public.
app.get('/login',(_req,res)=>res.sendFile(join(PUBLIC,'login.html')));
for(const file of ['login.js','login.css','icon.svg','icon-192.png','icon-512.png','apple-touch-icon.png'])app.get('/'+file,(_req,res)=>res.sendFile(join(PUBLIC,file)));
app.post('/api/login',(req,res)=>access ? access.login(req,res) : res.json({ok:true}));
app.post('/api/push/ack',(req,res,next)=>{
  if(access && !access.ackValid(req.body) && !access.sessionValid(req))return res.status(403).json({error:'Confirmación no autorizada'});
  const ok=markPushQueueDisplayed(db,req.body || {});
  if(ok)broadcast('push_ack',{});
  res.json({ok});
});
if(access)app.use(access.guard);
app.post('/api/logout',(req,res)=>access ? access.logout(req,res) : res.json({ok:true}));
app.use(express.static(PUBLIC, { etag: false, lastModified: false, maxAge: 0, extensions: ['html'] }));

const sse = new Set();
let lastSync = getMeta(db,'last_successful_sync',null);
let nextSyncAt=null;
let syncing = false;
let lastError = null;
let market = { updated_at: null, basketPct: {}, pairs: {} };
const pushWorkers = new WeakMap();
const scheduledPushTests = new Map();

export function ensureVapid() {
  const s = readSettings();
  if (!s.vapid?.publicKey || !s.vapid?.privateKey) {
    s.vapid = webpush.generateVAPIDKeys();
    writeSettings(s);
  }
  const subject = s.vapidSubject || DEFAULT_VAPID_SUBJECT;
  webpush.setVapidDetails(subject, s.vapid.publicKey, s.vapid.privateKey);
  return s.vapid;
}

function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data || {})}\n\n`;
  for (const res of sse) {
    try { res.write(payload); } catch { sse.delete(res); }
  }
}

/**
 * Procesa la cola persistente `push_queue` en SQLite.
 * Distingue explícitamente:
 * - `accepted_by_push_service`: HTTP 2xx del relay push (FCM / Apple Web Push / Mozilla)
 * - `displayed_on_device`: confirmado por el Service Worker tras `showNotification` (`POST /api/push/ack`)
 * - `retrying` / `failed` / `expired_subscription`
 * Nunca reporta éxito cuando el envío falla.
 */
export async function processPushQueue(targetDb = db, options = {}) {
  const previous=pushWorkers.get(targetDb);
  if (previous) { await previous; return processPushQueue(targetDb, options); }
  const promise=drainPushQueue(targetDb, options);
  pushWorkers.set(targetDb,promise);
  try { return await promise; } finally { if (pushWorkers.get(targetDb)===promise) pushWorkers.delete(targetDb); }
}
async function drainPushQueue(targetDb, { onlyQueueIds = null, sendFn = null } = {}) {
  try {
    if (!sendFn) ensureVapid();
    const sender = sendFn || ((sub, body) => webpush.sendNotification(sub, body, {TTL:86400,urgency:'high',timeout:10000}));
    const unread = unreadCount(targetDb);
    let due = listDuePushQueue(targetDb, new Date().toISOString(), 200, onlyQueueIds);
    if (Array.isArray(onlyQueueIds) && onlyQueueIds.length > 0) {
      const idSet = new Set(onlyQueueIds.map(Number));
      due = due.filter((item) => idSet.has(Number(item.id)));
    }

    let accepted = 0;
    let failed = 0;
    let retrying = 0;
    const results = [];

    for (const item of due) {
      if (!item.subscription?.endpoint) {
        const failState = markPushQueueFailure(targetDb, item.id, item.device_id, 'Suscripción sin endpoint válido', 400);
        failed += 1;
        results.push({
          queueId: item.id,
          deviceId: item.device_id,
          deviceLabel: item.device_label,
          tag: item.notification_tag,
          status: failState.status,
          error: 'Suscripción sin endpoint válido',
        });
        continue;
      }

      const payloadObj = {
        ...item.payload,
        queueId: item.id,
        deviceId: item.device_id,
        token: access?.ackToken(item.id,item.device_id),
        title: String(item.payload.title || 'RadarNews').slice(0,180),
        body: String(item.payload.body || '').slice(0,500),
        tag: item.notification_tag,
        badge: unread,
      };

      try {
        const res = await sender(item.subscription, JSON.stringify(payloadObj));
        const statusCode = res?.statusCode || 201;
        markPushQueueAccepted(targetDb, item.id, item.device_id, statusCode);
        accepted += 1;
        results.push({
          queueId: item.id,
          deviceId: item.device_id,
          deviceLabel: item.device_label,
          tag: item.notification_tag,
          status: 'accepted_by_push_service',
          httpStatus: statusCode,
        });
      } catch (err) {
        const statusCode = err?.statusCode || null;
        const errMsg = err?.body || err?.message || String(err);
        const failState = markPushQueueFailure(targetDb, item.id, item.device_id, errMsg, statusCode);
        if (failState.status === 'retrying') retrying += 1;
        else failed += 1;
        results.push({
          queueId: item.id,
          deviceId: item.device_id,
          deviceLabel: item.device_label,
          tag: item.notification_tag,
          status: failState.status,
          httpStatus: statusCode,
          error: String(errMsg).slice(0, 240),
        });
      }
    }

    return {
      processed: due.length,
      accepted,
      failed,
      retrying,
      results,
    };
  } finally { /* Lock is released by processPushQueue for this database. */ }
}

export async function dispatchAlertsNow(alerts, { targetDb = db, sendFn = null } = {}) {
  if (!alerts?.length) {
    return {
      devices: listDevices(targetDb).length,
      enqueued: 0,
      accepted: 0,
      failed: 0,
      retrying: 0,
      displayed: 0,
      results: [],
    };
  }
  const savedAlerts = alerts.map((a) => (a.id ? a : insertAlert(targetDb, a)));
  broadcast('alerts', { alerts: savedAlerts });
  const queueIds = enqueuePushForAlerts(targetDb, savedAlerts);
  const devices = listDevices(targetDb);
  if (!devices.length || !queueIds.length) {
    return {
      devices: devices.length,
      enqueued: queueIds.length,
      accepted: 0,
      failed: 0,
      retrying: 0,
      displayed: 0,
      results: [],
    };
  }
  const qResult = await processPushQueue(targetDb, { onlyQueueIds: queueIds, sendFn });
  return {
    devices: devices.length,
    enqueued: queueIds.length,
    accepted: qResult.accepted,
    failed: qResult.failed,
    retrying: qResult.retrying,
    displayed: 0,
    results: qResult.results,
  };
}

export async function runSync() {
  if (syncing) return lastSync;
  syncing = true;
  lastError = null;
  broadcast('sync_start', {});
  try {
    const result = await refreshFeed(db, {
      classify: true,
      onNewAlerts: async (immediateAlerts) => {
        broadcast('alerts', { alerts: immediateAlerts });
        await processPushQueue(db);
      },
    });
    lastSync = result;
    setMeta(db,'last_successful_sync',result);
    // Procesar también cualquier notificación pendiente en cola de ciclos previos
    await processPushQueue(db).catch(() => {});
    try {
      market = await fetchMarket();
      saveMarketSnapshot(db, market, result.finished_at);
    } catch { /* keep last */ }
    broadcast('sync_done', { inserted: result.inserted, updated: result.updated || 0 });
    return result;
  } catch (err) {
    lastError = String(err.message || err);
    throw err;
  } finally {
    syncing = false;
  }
}

function formatDeviceForApi(d) {
  let endpointHost = null;
  let endpointOrigin = null;
  try {
    const u = new URL(d.subscription?.endpoint || '');
    endpointHost = u.host;
    endpointOrigin = u.origin;
  } catch { /* ignore */ }
  return {
    id: d.id,
    label: d.label,
    endpoint_hash: endpointHash(d.subscription?.endpoint),
    endpoint_host: endpointHost,
    endpoint_origin: endpointOrigin,
    status: d.status || 'active',
    created_at: d.created_at,
    last_ok_at: d.last_ok_at,
    last_accepted_at: d.last_accepted_at || d.last_ok_at || null,
    last_displayed_at: d.last_displayed_at || null,
    last_http_status: d.last_http_status || null,
    last_error: d.last_error || null,
    last_error_at: d.last_error_at || null,
  };
}

function state() {
  const agentEngine = latestEngine(db, 'agente');
  const engines = agentEngine ? [agentEngine] : [];
  const cal = listCalendar(db);
  const turbo = turboEvent(cal);
  const sourceStates = listSourceStates(db).map(s => sourceHealth(s));
  const devices = listDevices(db).map(formatDeviceForApi);
  const pushSummary = getPushQueueSummary(db, 25);
  return {
    version: RELEASE,
    now: new Date().toISOString(),
    coverage_start_at: db.prepare('SELECT MIN(created_at) AS t FROM news').get()?.t || null,
    last_sync: lastSync ? {...lastSync, health:undefined} : null,
    next_sync_at: nextSyncAt,
    syncing,
    turbo: turbo ? { currency: turbo.currency, title: turbo.title } : null,
    error: lastError,
    engine_meta: {
      id: 'agente',
      label: ENGINE_NAME,
      op_version: OP_VERSION,
      shadow_version: SHADOW_VERSION,
      empirical: false,
      mode: 'single_engine_agente_mmt',
    },
    // Compatibilidad para pestañas abiertas con versión previa de app.js en memoria antes de recargar
    llm: {
      configured: false,
      status: 'ok',
      model: ENGINE_NAME,
      retired: true,
    },
    sources: sourceStates,
    news: listNews(db, 300),
    engines,
    market,
    calendar: cal,
    calendar_sync: lastSync?.calendar_sync || null,
    push_devices: devices.length,
    push_queue: {counts:pushSummary.counts},
    keep_awake: process.platform === 'darwin',
    platform: process.platform,
    alerts: listAlerts(db, 50),
    unread: unreadCount(db),
  };
}

app.get('/api/state', (_req, res) => res.json(state()));
app.get('/api/health', (_req,res) => res.json({version:RELEASE,ok:!lastError,uptime:Math.round(process.uptime()),last_sync_at:lastSync?.finished_at || null,syncing}));
app.post('/api/push/status', (req,res) => {
  const device=listDevices(db).find(d => endpointHash(d.subscription?.endpoint)===req.body?.endpointHash);
  res.json({device:device ? formatDeviceForApi(device) : null});
});
app.get('/api/spec', (_req, res) => {
  if (!existsSync(SPEC)) return res.status(404).type('text').send('SPEC.md no encontrado');
  res.type('text/markdown').send(readFileSync(SPEC, 'utf8'));
});
app.get('/api/push/key', (_req, res) => res.json({ publicKey: ensureVapid().publicKey }));
app.get('/api/push/devices', (_req, res) => {
  res.json({
    devices: listDevices(db, true).map(formatDeviceForApi),
    queue: getPushQueueSummary(db, 30),
    scheduled: [...scheduledPushTests.values()],
  });
});
app.post('/api/push/subscribe', (req, res) => {
  const subscription = req.body?.subscription;
  if (!validPushSubscription(subscription)) return res.status(400).json({ error: 'Suscripción inválida o proveedor push no reconocido' });
  const id = req.body.id || randomUUID();
  const savedId=saveDevice(db, { id, label: String(req.body.label || 'Dispositivo').slice(0,80), subscription });
  res.json({ id:savedId });
});
app.post('/api/push/devices/remove', (req, res) => {
  removeDevice(db, req.body?.id);
  res.json({ ok: true });
});
app.post('/api/push/test', async (_req, res) => {
  const r = await dispatchAlertsNow([
    {
      title: 'Prueba RadarNews · Agente MMT',
      body: `Verificación de canal push (${new Date().toISOString().slice(11, 19)} UTC).`,
      alert_type: 'titular',
      level: 'alto',
    },
  ]);
  res.json({
    ok: r.accepted > 0,
    devices: r.devices,
    enqueued: r.enqueued,
    accepted: r.accepted,
    failed: r.failed,
    retrying: r.retrying,
    displayed: r.displayed,
    results: r.results,
  });
});
app.post('/api/push/schedule-test', (req, res) => {
  const delaySeconds = Math.max(5, Math.min(300, Number(req.body?.delaySeconds) || 30));
  const scheduleId = randomUUID();
  const scheduledAt = new Date().toISOString();
  const fireAt = new Date(Date.now() + delaySeconds * 1000).toISOString();
  const entry = {
    id: scheduleId,
    delaySeconds,
    scheduledAt,
    fireAt,
    status: 'scheduled',
    result: null,
  };
  scheduledPushTests.set(scheduleId, entry);

  const timer = setTimeout(async () => {
    entry.status = 'firing';
    try {
      const r = await dispatchAlertsNow([
        {
          title: `Prueba con app cerrada · RadarNews (${delaySeconds}s)`,
          body: `Prueba programada emitida a las ${new Date().toISOString().slice(11, 19)} UTC. Comprueba aviso y sonido en este dispositivo.`,
          alert_type: 'breaking',
          level: 'critico',
        },
      ]);
      entry.status = 'completed';
      entry.firedAt = new Date().toISOString();
      entry.result = r;
    } catch (err) {
      entry.status = 'failed';
      entry.error = String(err.message || err);
    }
  }, delaySeconds * 1000);
  timer.unref?.();

  res.json({
    ok: true,
    scheduleId,
    delaySeconds,
    scheduledAt,
    fireAt,
  });
});
app.post('/api/alerts/read-all', (_req, res) => {
  markAlertsRead(db);
  res.json({ ok: true });
});
app.post('/api/refresh', async (_req, res) => {
  try {
    const r = await runSync();
    res.json({ ok: true, inserted: r.inserted, updated: r.updated || 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  res.write('event: hello\ndata: {}\n\n');
  sse.add(res);
  const heartbeat=setInterval(() => res.write(': heartbeat\n\n'),25000);
  req.on('close', () => {clearInterval(heartbeat); sse.delete(res);});
});
app.get('/api/devices', async (req, res) => {
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.get('host');
  const url = process.env.RADARNEWS_URL || `${proto}://${host}`;
  const secure = new URL(url).protocol === 'https:';
  let qr = '';
  try { qr = `<img alt="QR" src="${await QRCode.toDataURL(url, { margin: 1, width: 180 })}" />`; } catch { qr = ''; }
  res.json({
    url,
    secure,
    qr,
    access: 'https-login',
  });
});

app.use((err,req,res,next) => {
  console.error('request_error',err.name);
  if (!res.headersSent) res.status(err.status || 500).json({error:'No se pudo completar la solicitud'});
});

app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  res.sendFile(join(PUBLIC, 'index.html'));
});

function loop() {
  const cal = listCalendar(db);
  const wait = turboEvent(cal) ? WINDOWS.turboMs : WINDOWS.refreshMs;
  nextSyncAt=new Date(Date.now()+wait).toISOString();
  setTimeout(async () => {
    try { await runSync(); } catch (err) { console.error('sync', err.message); }
    loop();
  }, wait);
}

function retryQueueLoop() {
  setTimeout(async () => {
    try { await processPushQueue(db); } catch (err) { console.error('push_queue', err.message); }
    retryQueueLoop();
  }, 20_000);
}

if (!IS_TEST) {
  ensureVapid();
  app.listen(PORT, HOST, () => {
    console.log(`RadarNews http://${HOST}:${PORT}`);
    startFinancialJuice(db,DATA_DIR,{onNews:({alert})=>{
      if(alert)broadcast('alerts',{alerts:[alert]});
      broadcast('sync_done',{source:'financialjuice-live'});
      processPushQueue(db).catch(()=>{});
    }});
    processPushQueue(db).catch(() => {});
    runSync().catch((err) => console.error('initial sync', err.message));
    loop();
    retryQueueLoop();
  });
}

export { app, db };
