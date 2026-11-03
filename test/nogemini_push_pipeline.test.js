import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  openDb,
  insertNewsWithStatus,
  insertAlert,
  listNews,
  listAlerts,
  saveDevice,
  listDevices,
  enqueuePushForAlerts,
  getPushQueueSummary,
  markPushQueueDisplayed,
  latestEngine,
} from '../src/db.js';
import { pullSource, refreshFeed, buildNewsAlert } from '../src/refreshFeed.js';
import { processPushQueue, dispatchAlertsNow } from '../src/server.js';
import { selectEvidence } from '../src/evidence.js';
import { classifyAgent } from '../src/classifyCurrencies.js';
import { scrubGeminiFromSettings } from '../src/settings.js';
import { OP_VERSION, SHADOW_VERSION, SHADOW_SPEC } from '../src/shadowCalibration.js';

test('Caso 1: Noticias nuevas que caían fuera del antiguo tope de 60 (insertCap) o detrás de ítems ya vistos se ingieren íntegras', async () => {
  const db = openDb(':memory:');
  const now = Date.parse('2026-10-25T16:00:00Z');

  // Insertamos 75 noticias nuevas de una misma fuente o lote que antes habría sido truncado en 60 por roundRobinInsert
  let insertedCount = 0;
  for (let i = 1; i <= 75; i++) {
    const pub = new Date(now - (80 - i) * 60_000).toISOString();
    const res = insertNewsWithStatus(db, {
      title: `Titular institucional número ${i} sobre mercado global`,
      body: `Cuerpo del titular ${i}`,
      source: 'FT · Mercados',
      source_id: 'ft-markets',
      source_type: 'agencia',
      url: `https://www.ft.com/content/item-${i}`,
      published_at: pub,
      currencies: ['USD'],
      impact: 2,
      category: 'mercado',
    });
    if (res.inserted) insertedCount += 1;
  }
  assert.equal(insertedCount, 75, 'Las 75 noticias deben insertarse sin truncado en 60');
  const stored = listNews(db, 100);
  assert.equal(stored.length, 75);
  db.close();
});

test('Caso 1b: Recuperación mediante paginación ?before= en Telegram cuando hay hueco respecto al cursor_id', async () => {
  const origFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url) => {
      const u = String(url);
      if (u.includes('?before=105')) {
        return {
          ok: true,
          status: 200,
          url: u,
          headers: new Map([['content-type', 'text/html']]),
          text: async () => `
            <div class="tgme_widget_message_wrap">
              <div class="tgme_widget_message_text">Mensaje recuperado 103 tras caída</div>
              <time datetime="2026-10-25T15:03:00Z"></time>
              <a href="https://t.me/FinancialJuice/103">x</a>
            </div>
            <div class="tgme_widget_message_wrap">
              <div class="tgme_widget_message_text">Mensaje recuperado 104 tras caída</div>
              <time datetime="2026-10-25T15:04:00Z"></time>
              <a href="https://t.me/FinancialJuice/104">x</a>
            </div>
          `,
        };
      }
      return {
        ok: true,
        status: 200,
        url: u,
        headers: new Map([['content-type', 'text/html']]),
        text: async () => `
          <div class="tgme_widget_message_wrap">
            <div class="tgme_widget_message_text">Mensaje reciente 105 en primera página</div>
            <time datetime="2026-10-25T15:05:00Z"></time>
            <a href="https://t.me/FinancialJuice/105">x</a>
          </div>
        `,
      };
    };

    const source = {
      id: 'financialjuice',
      name: 'FinancialJuice (Telegram · no afiliado)',
      type: 'breaking',
      kind: 'telegram',
      url: 'https://t.me/s/FinancialJuice',
    };
    const { health, items } = await pullSource(source, Date.parse('2026-10-25T15:06:00Z'), { cursor_id: '102' });
    assert.equal(health.ok, true);
    assert.equal(health.cursor_id, '105');
    assert.equal(items.length, 3, 'Debe recuperar el mensaje 105 de portada más los mensajes 103 y 104 vía ?before=105');
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('Caso 1c: HTTP 200 con 0 titulares se reporta como empty_feed (ok: false), nunca como fuente saludable', async () => {
  const origFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url) => ({
      ok: true,
      status: 200,
      url: String(url),
      headers: new Map([['content-type', 'text/html']]),
      text: async () => '<html><body><div>Sin titulares</div></body></html>',
    });
    const source = { id: 'stats-nz', name: 'Stats NZ', type: 'oficial', kind: 'html', url: 'https://www.stats.govt.nz/news/' };
    const { health, items } = await pullSource(source, Date.now(), null);
    assert.equal(items.length, 0);
    assert.equal(health.ok, false);
    assert.equal(health.status, 'empty_feed');
    assert.match(health.error, /0 titulares/i);
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('Caso 2: Noticias sin divisa o sin impacto alto aparecen en la cinta y generan alerta, mientras selectEvidence filtra solo el análisis MMT', () => {
  const db = openDb(':memory:');
  const now = Date.parse('2026-10-25T16:00:00Z');

  // 1. Noticia sin divisa, impacto 1, categoría "otro"
  const generalNews = {
    title: 'Appointment of Chief Risk Officer at central institution',
    body: 'Comunicado institucional administrativo sin divisa ni impacto macro.',
    source: 'RBA',
    source_id: 'rba',
    source_type: 'oficial',
    url: 'https://www.rba.gov.au/media-releases/2026/mr-26-99.html',
    published_at: new Date(now - 2 * 3600_000).toISOString(),
    currencies: [],
    impact: 1,
    category: 'otro',
    fingerprint: 'fp-general-no-ccy',
  };

  // 2. Noticia macro con divisa e impacto para Agente MMT
  const macroNews = {
    title: 'US CPI YOY ACTUAL 3.5% (FORECAST 3.1%, PREVIOUS 3.0%)',
    body: '',
    source: 'FinancialJuice',
    source_id: 'financialjuice',
    source_type: 'breaking',
    url: 'https://t.me/FinancialJuice/5001',
    published_at: new Date(now - 3600_000).toISOString(),
    currencies: ['USD'],
    impact: 5,
    category: 'dato_macro',
    actual: '3.5%',
    forecast: '3.1%',
    previous: '3.0%',
    fingerprint: 'fp-usd-cpi',
  };

  const r1 = insertNewsWithStatus(db, generalNews);
  const r2 = insertNewsWithStatus(db, macroNews);
  assert.equal(r1.inserted, true);
  assert.equal(r2.inserted, true);

  // Ambas aparecen en la cinta
  const tape = listNews(db, 50);
  assert.equal(tape.length, 2);
  assert.ok(tape.some((n) => n.fingerprint === 'fp-general-no-ccy'));

  // La noticia sin divisa y de impacto 1 genera su alerta correspondiente
  const alert1 = buildNewsAlert(r1.item);
  assert.equal(alert1.news_item_id, r1.id);
  assert.equal(alert1.currency, null);

  // Pero en la capa de análisis MMT (selectEvidence), solo entra la evidencia relevante con divisa
  const analysisEvidence = selectEvidence(tape, now);
  assert.equal(analysisEvidence.length, 1);
  assert.equal(analysisEvidence[0].fingerprint, 'fp-usd-cpi');
  db.close();
});

test('Caso 3: Fallo total de push devuelve 0 éxitos (accepted: 0, failed/retrying contabilizados)', async () => {
  const db = openDb(':memory:');
  saveDevice(db, {
    id: 'dev-fail-1',
    label: 'iPhone · app',
    subscription: { endpoint: 'https://web.push.apple.com/fake-token-1', keys: { p256dh: 'k', auth: 'a' } },
  });
  saveDevice(db, {
    id: 'dev-fail-2',
    label: 'Mac · Chrome',
    subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/fake-token-2', keys: { p256dh: 'k', auth: 'a' } },
  });

  const failingSender = async () => {
    const err = new Error('BadJwtToken');
    err.statusCode = 403;
    err.body = '{"reason":"BadJwtToken"}';
    throw err;
  };

  const res = await dispatchAlertsNow(
    [{ title: 'Noticia nueva de prueba', body: 'Fuente X', alert_type: 'titular', level: 'alto' }],
    { targetDb: db, sendFn: failingSender },
  );

  assert.equal(res.devices, 2);
  assert.equal(res.accepted, 0, 'Un fallo total de push JAMÁS debe devolver accepted > 0');
  assert.equal(res.failed, 2);
  assert.equal(res.displayed, 0);
  db.close();
});

test('Caso 4: Reinicio del servicio con notificaciones pendientes en push_queue, recuperación/reintento y ausencia de duplicados + ACK de dispositivo', async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'rn-push-restart-'));
  const dbFile = join(tmpDir, 'test.db');

  // Primera instancia antes del reinicio: falla temporalmente (503) y queda en estado 'retrying'
  {
    const db1 = openDb(dbFile);
    saveDevice(db1, {
      id: 'dev-1',
      label: 'Mac · Chrome',
      subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/token-persist', keys: { p256dh: 'k', auth: 'a' } },
    });

    const tempFailSender = async () => {
      const err = new Error('Service Unavailable');
      err.statusCode = 503;
      throw err;
    };

    const r1 = await dispatchAlertsNow(
      [{ title: 'Titular persistente ante reinicio', body: 'BoE', alert_type: 'titular', level: 'alto', news_item_id: 777 }],
      { targetDb: db1, sendFn: tempFailSender },
    );
    assert.equal(r1.accepted, 0);
    assert.equal(r1.retrying, 1);

    // Intentar encolar de nuevo la misma alerta para el mismo dispositivo NO duplica la fila en push_queue
    const alertsInDb = listAlerts(db1, 10);
    const dupEnqueued = enqueuePushForAlerts(db1, alertsInDb);
    assert.equal(dupEnqueued.length, 0, 'UNIQUE(alert_id, device_id) impide duplicar notificaciones en cola');

    // Adelantamos next_retry_at para simular que tras el reinicio ya venció el backoff
    db1.prepare("UPDATE push_queue SET next_retry_at = '2000-01-01T00:00:00.000Z'").run();
    db1.close();
  }

  // Segunda instancia tras reinicio del servicio: reabre SQLite y procesa la cola pendiente
  {
    const db2 = openDb(dbFile);
    let sentPayloads = [];
    const okSender = async (_sub, payloadJson) => {
      sentPayloads.push(JSON.parse(payloadJson));
      return { statusCode: 201 };
    };

    const qRes = await processPushQueue(db2, { sendFn: okSender });
    assert.equal(qRes.processed, 1);
    assert.equal(qRes.accepted, 1);
    assert.equal(sentPayloads.length, 1);
    assert.equal(sentPayloads[0].tag, 'rn-news-777');

    let summary = getPushQueueSummary(db2);
    assert.equal(summary.counts.accepted_by_push_service, 1);
    assert.equal(summary.counts.displayed_on_device, 0, 'Antes del ACK del Service Worker no se marca como mostrada en dispositivo');

    // El Service Worker confirma visualización tras showNotification
    const ackOk = markPushQueueDisplayed(db2, {
      queueId: sentPayloads[0].queueId,
      tag: sentPayloads[0].tag,
      deviceId: 'dev-1',
      displayedAt: '2026-10-25T16:10:00.000Z',
    });
    assert.equal(ackOk, true);

    summary = getPushQueueSummary(db2);
    assert.equal(summary.counts.displayed_on_device, 1);
    db2.close();
  }
});

test('Caso 5: Varias noticias seguidas conservan notificaciones separadas con tags únicos y sin truncado slice(0, 4)', async () => {
  const db = openDb(':memory:');
  saveDevice(db, {
    id: 'dev-multi',
    label: 'Mac · Chrome',
    subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/token-multi', keys: { p256dh: 'k', auth: 'a' } },
  });

  const sixAlerts = Array.from({ length: 6 }, (_, idx) => ({
    title: `Noticia consecutiva #${idx + 1}`,
    body: `Fuente #${idx + 1}`,
    alert_type: 'titular',
    level: 'medio',
    news_item_id: 1001 + idx,
  }));

  const delivered = [];
  const res = await dispatchAlertsNow(sixAlerts, {
    targetDb: db,
    sendFn: async (_sub, body) => {
      delivered.push(JSON.parse(body));
      return { statusCode: 201 };
    },
  });

  assert.equal(res.enqueued, 6, 'Las 6 noticias deben encolarse sin truncar a 4');
  assert.equal(res.accepted, 6, 'Las 6 notificaciones deben enviarse individualmente');
  assert.equal(delivered.length, 6);
  const uniqueTags = new Set(delivered.map((d) => d.tag));
  assert.equal(uniqueTags.size, 6, 'Cada noticia tiene su propio tag único rn-news-<id> para no sobrescribirse');
  assert.ok(!delivered.some((d) => d.tag === 'rn-more' || /alertas más/i.test(d.title)));
  db.close();
});

test('Caso 6: Ausencia de llamadas a Gemini, limpieza segura de settings.json preservando VAPID y funcionamiento de Agente MMT incluso si noticias se notifican de forma independiente', async () => {
  // 1. Verificar que scrubGeminiFromSettings elimina gemini/GEMINI_API_KEY pero conserva VAPID intacto
  const tmpDir = mkdtempSync(join(tmpdir(), 'rn-settings-scrub-'));
  const settingsFile = join(tmpDir, 'settings.json');
  writeFileSync(settingsFile, JSON.stringify({
    GEMINI_API_KEY: 'secret-legacy-key',
    gemini: { key: 'secret-gemini-key', model: 'gemini-3.8-flash' },
    vapid: { publicKey: 'VAPID_PUB_123', privateKey: 'VAPID_PRIV_456' },
  }, null, 2));

  const scrubRes = scrubGeminiFromSettings(settingsFile);
  assert.equal(scrubRes.scrubbed, true);
  assert.equal(scrubRes.vapidPreserved, true);
  const cleanedRaw = JSON.parse(readFileSync(settingsFile, 'utf8'));
  assert.equal('gemini' in cleanedRaw, false);
  assert.equal('GEMINI_API_KEY' in cleanedRaw, false);
  assert.equal(cleanedRaw.vapid.publicKey, 'VAPID_PUB_123');
  assert.equal(cleanedRaw.vapid.privateKey, 'VAPID_PRIV_456');

  // 2. Verificar refreshFeed end-to-end sin ninguna llamada a googleapis y con Agente MMT + sombra
  const origFetch = globalThis.fetch;
  const calledUrls = [];
  try {
    globalThis.fetch = async (url) => {
      const u = String(url);
      calledUrls.push(u);
      if (u.includes('generativelanguage.googleapis.com')) {
        throw new Error('PROHIBIDO: No debe realizarse ninguna llamada a Gemini');
      }
      if (u.includes('ff_calendar_thisweek.json')) {
        return { ok: true, status: 200, json: async () => [], text: async () => '[]', headers: new Map() };
      }
      return {
        ok: true,
        status: 200,
        url: u,
        headers: new Map([['content-type', 'application/rss+xml']]),
        text: async () => `<rss><channel><item><title>Monetary policy assessment: rate cut signal</title><link>${u}/item1</link><pubDate>${new Date().toUTCString()}</pubDate></item></channel></rss>`,
      };
    };

    const db = openDb(':memory:');
    let immediateNotifiedCount = 0;
    const syncRes = await refreshFeed(db, {
      classify: true,
      onNewAlerts: async (alerts) => {
        immediateNotifiedCount += alerts.length;
      },
    });

    assert.ok(syncRes.inserted > 0);
    assert.ok(immediateNotifiedCount > 0, 'Las alertas de noticias se disparan inmediatamente al registrarse');
    assert.ok(!calledUrls.some((u) => u.includes('googleapis.com')), 'Cero llamadas a Gemini');

    const eng = latestEngine(db, 'agente');
    assert.ok(eng);
    assert.equal(eng.label, 'Agente MMT');
    assert.equal(eng.rows[0].calibration.empirical, false);
    assert.equal(eng.rows[0].calibration.opVersion, OP_VERSION);
    assert.equal(eng.rows[0].shadow.version, SHADOW_VERSION);
    assert.equal(SHADOW_SPEC.empirical, false);

    const calLogs = db.prepare('SELECT * FROM calibration_log').all();
    assert.equal(calLogs.length, 8);
    assert.ok(calLogs.every((c) => c.gemini_score === null && c.gemini_model === null));
    db.close();
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('Migración SQLite: openDb elimina REFERENCES news_items(id) heredado en alerts para no bloquear alertas de news con PRAGMA foreign_keys=ON', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const tmpDir = mkdtempSync(join(tmpdir(), 'rn-fk-mig-'));
  const dbFile = join(tmpDir, 'legacy.db');
  const rawDb = new DatabaseSync(dbFile);
  rawDb.exec(`
    CREATE TABLE news_items (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL);
    INSERT INTO news_items (id, title) VALUES (1, 'old row');
    CREATE TABLE alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      level TEXT NOT NULL,
      alert_type TEXT NOT NULL,
      currency TEXT,
      news_item_id INTEGER REFERENCES news_items(id),
      is_read INTEGER NOT NULL DEFAULT 0,
      occurred_at TEXT NOT NULL
    );
    INSERT INTO alerts (id, title, body, level, alert_type, news_item_id, occurred_at)
      VALUES (89, 'Legacy alert', 'FJ', 'medio', 'dato_macro', 1, '2026-10-23T00:00:00.000Z');
  `);
  rawDb.close();

  const db = openDb(dbFile);
  db.exec("INSERT INTO news (id, title, fingerprint) VALUES (500, \x27seed\x27, \x27seed-fp\x27)");
  const res = insertNewsWithStatus(db, {
    title: 'New headline in news table',
    source: 'FinancialJuice',
    source_id: 'financialjuice',
    source_type: 'breaking',
    url: 'https://t.me/FinancialJuice/999999',
    published_at: '2026-10-25T18:00:00.000Z',
    currencies: ['USD'],
    impact: 3,
    category: 'dato_macro',
    fingerprint: 'fj-999999',
  });
  assert.equal(res.inserted, true);

  const savedAlert = insertAlert(db, buildNewsAlert(res.item));
  assert.ok(savedAlert.id > 89);
  assert.equal(savedAlert.news_item_id, res.item.id);
  db.close();
});
