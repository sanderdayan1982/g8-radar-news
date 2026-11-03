import { selectEvidence, evidenceContract } from './evidence.js';
import { randomUUID } from 'node:crypto';
import { SOURCES, WINDOWS, UA, ENGINE_NAME } from './config.js';
import { enrichRaw, isRelevant, parseRss, parseTelegram, parseHtmlList } from './enrich.js';
import {
  insertNewsWithStatus,
  recentNews,
  listNews,
  saveScores,
  latestEngine,
  insertAlert,
  listCalendar,
  upsertCalendar,
  persistCalendarLinks,
  persistNewsLinks,
  repairPersistedNews,
  getMeta,
  setMeta,
  saveCalibrationLog,
  markHistoricalEvaluationsIneligible,
  getSourceState,
  saveSourceState,
  enqueuePushForAlerts,
} from './db.js';
import { classifyAgent, attachRanks, rankingAlerts } from './classifyCurrencies.js';
import { classifyAgentShadow, evaluateExpandedCoverageExperiment, OP_VERSION, SHADOW_VERSION } from './shadowCalibration.js';
import { classifyCurrencyTransition, entryFixingDateForSignal, computeCodeHash } from './calibrationEval.js';
import { fetchCalendar, linkNewsToCalendar, duePrealerts } from './calendar.js';

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/xml, text/html, */*' },
    signal: AbortSignal.timeout(WINDOWS.fetchTimeoutMs),
    redirect: 'follow',
  });
  const text = await res.text();
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`);
    err.httpStatus = res.status;
    throw err;
  }
  return {
    text,
    finalUrl: res.url,
    httpStatus: res.status,
    contentType: res.headers.get('content-type') || '',
  };
}

function parseSource(source, text) {
  if (source.kind === 'telegram') return parseTelegram(text);
  if (source.kind === 'html') return parseHtmlList(text, source.url);
  return parseRss(text);
}

/**
 * Obtiene las publicaciones de una fuente seleccionada.
 * - Conserva TODAS las publicaciones válidas de la fuente para la cinta y notificaciones.
 * - Si la fuente es Telegram y existe un hueco respecto al último cursor (`cursor_id`),
 *   pagina hacia atrás mediante `?before=<minMsgId>` para recuperar mensajes perdidos.
 * - Nunca declara saludable (`ok: true`) una respuesta HTTP 200 con 0 titulares extraídos:
 *   la marca explícitamente como `status: 'empty_feed'`.
 */
export async function pullSource(source, now = Date.now(), prevState = null) {
  const attemptAt = new Date(now).toISOString();
  const health = {
    id: source.id,
    source_id: source.id,
    source: source.name,
    name: source.name,
    url: source.url,
    type: source.type,
    kind: source.kind,
    poll_ms: source.pollMs || 60_000,
    channel_note: source.channel_note || null,
    ok: false,
    status: 'error',
    http_status: null,
    fetched: 0,
    relevant: 0,
    inserted: 0,
    updated: 0,
    pending_count: 0,
    cursor_id: prevState?.cursor_id || null,
    last_attempt_at: attemptAt,
    last_success_at: prevState?.last_success_at || null,
    last_news_published_at: prevState?.last_news_published_at || null,
    last_captured_at: prevState?.last_captured_at || null,
    last_delay_sec: prevState?.last_delay_sec ?? null,
    error: null,
  };

  try {
    const { text, finalUrl, httpStatus } = await fetchText(source.url);
    health.http_status = httpStatus;
    if (source.kind === 'telegram' && /Telegram: Contact @/.test(text) && !/tgme_widget_message_text/.test(text)) {
      throw new Error('Canal sin vista pública t.me/s/…; comprueba RADARNEWS_BURBUJA_CHANNEL.');
    }

    let raw = parseSource(source, text);
    if (raw.length === 0 && source.fallbackUrl) {
      try {
        const fb = await fetchText(source.fallbackUrl);
        if (fb.text) {
          const fbItems = parseSource({ ...source, url: source.fallbackUrl }, fb.text);
          if (fbItems.length > 0) {
            raw = fbItems;
            health.http_status = fb.httpStatus;
          }
        }
      } catch {
        // Si el fallback falla, mantener el resultado de la URL principal
      }
    }
    let nextCursorId = prevState?.cursor_id || null;

    // Recuperación mediante cursores/paginación en canales públicos de Telegram (`?before=<msgId>`)
    if (source.kind === 'telegram' && raw.length > 0) {
      const msgIds = raw.map((r) => r.telegram_msg_id).filter(Number.isFinite);
      if (msgIds.length > 0) {
        const maxId = Math.max(...msgIds);
        let minId = Math.min(...msgIds);
        const prevCursorNum = Number(prevState?.cursor_id);
        nextCursorId = Number.isFinite(prevCursorNum) ? String(Math.max(prevCursorNum, maxId)) : String(maxId);

        if (Number.isFinite(prevCursorNum) && minId > prevCursorNum + 1) {
          const maxBackfillPages = 3;
          for (let page = 0; page < maxBackfillPages && minId > prevCursorNum + 1; page++) {
            try {
              const sep = source.url.includes('?') ? '&' : '?';
              const pageRes = await fetchText(`${source.url}${sep}before=${minId}`);
              const olderRaw = parseTelegram(pageRes.text);
              if (!olderRaw.length) break;
              const olderIds = olderRaw.map((r) => r.telegram_msg_id).filter(Number.isFinite);
              const filteredOlder = olderRaw.filter((r) => !r.telegram_msg_id || r.telegram_msg_id > prevCursorNum);
              raw.push(...filteredOlder);
              if (!olderIds.length) break;
              const nextMin = Math.min(...olderIds);
              if (nextMin >= minId) break;
              minId = nextMin;
            } catch {
              break;
            }
          }
        }
      }
    }

    // Rehidratar elementos pendientes de ciclos anteriores si existían
    const pendingFromPrev = Array.isArray(prevState?.pending_items) ? prevState.pending_items : [];
    const enrichedCurrent = raw.map((r) => enrichRaw({ ...r, url: r.url || finalUrl }, source));
    const combinedByFp = new Map();
    for (const item of [...pendingFromPrev, ...enrichedCurrent]) {
      if (item?.title && item?.fingerprint) {
        combinedByFp.set(item.fingerprint, item);
      }
    }
    const items = [...combinedByFp.values()].sort(
      (a, b) => Date.parse(a.published_at || 0) - Date.parse(b.published_at || 0),
    );

    if (!nextCursorId && items.length > 0) {
      nextCursorId = items[items.length - 1].fingerprint;
    }

    health.fetched = enrichedCurrent.length;
    health.relevant = items.filter(isRelevant).length;
    health.cursor_id = nextCursorId;

    if (enrichedCurrent.length === 0) {
      health.ok = false;
      health.status = 'empty_feed';
      health.error = `HTTP ${httpStatus} con 0 titulares extraídos (cobertura vacía o estructura sin ítems)`;
      return { health, items: [] };
    }

    health.ok = true;
    health.status = 'ok';
    health.last_success_at = attemptAt;
    const latestPub = items.reduce((acc, it) => {
      if (!it.published_at) return acc;
      return !acc || Date.parse(it.published_at) > Date.parse(acc) ? it.published_at : acc;
    }, null);
    if (latestPub) {
      health.last_news_published_at = latestPub;
      const delaySec = Math.max(0, Math.round((now - Date.parse(latestPub)) / 1000));
      if (Number.isFinite(delaySec)) health.last_delay_sec = delaySec;
    }
    return { health, items };
  } catch (err) {
    health.ok = false;
    health.status = 'error';
    health.http_status = err.httpStatus || null;
    health.error = String(err.message || err).slice(0, 240);
    return { health, items: Array.isArray(prevState?.pending_items) ? prevState.pending_items : [] };
  }
}

export function buildNewsAlert(item) {
  const ccyPrefix = item.currencies?.length ? `[${item.currencies.join('/')}] ` : '';
  const actualSuffix = item.actual ? ` · Act ${item.actual}${item.forecast ? ` (Est ${item.forecast})` : ''}` : '';
  return {
    title: `${ccyPrefix}${item.title}`.slice(0, 180),
    body: `${item.source}${actualSuffix}`,
    level: item.impact >= 5 ? 'critico' : item.impact >= 4 ? 'alto' : 'medio',
    alert_type: item.category === 'dato_macro' ? 'dato_macro' : item.category === 'geopolitica' ? 'breaking' : 'titular',
    currency: (item.currencies || [])[0] || null,
    news_item_id: item.id,
    occurred_at: new Date().toISOString(),
  };
}

const initializedDbs = new WeakSet();

export async function refreshFeed(db, { classify = true, onNewAlerts = null } = {}) {
  const started = new Date().toISOString();
  const nowMs = Date.now();

  const pulled = await Promise.all(
    SOURCES.map((s) => {
      const prevState = getSourceState(db, s.id);
      return pullSource(s, nowMs, prevState);
    }),
  );

  const health = pulled.map((p) => p.health);

  let calendarSync = null;
  try {
    const cal = await fetchCalendar();
    upsertCalendar(db, cal.events, cal.week_start);
    calendarSync = { events: cal.events.length, ok: true };
  } catch (err) {
    calendarSync = { events: 0, ok: false, error: String(err.message || err) };
  }

  if (!initializedDbs.has(db)) {
    repairPersistedNews(db);
    markHistoricalEvaluationsIneligible(db);
    initializedDbs.add(db);
  }
  let events = listCalendar(db);

  // Fase 1: Recepción íntegra de noticias y notificación inmediata (independiente de la clasificación MMT)
  let inserted = 0;
  let updated = 0;
  const alerts = [];
  const immediateNewsAlerts = [];

  db.exec('BEGIN');
  try {
    for (let i = 0; i < SOURCES.length; i++) {
      const source = SOURCES[i];
      const p = pulled[i];
      const h = p.health;
      const sourceItems = p.items || [];
      const prevState = getSourceState(db, source.id);

      linkNewsToCalendar(sourceItems, events);

      let sourceInserted = 0;
      let sourceUpdated = 0;
      const remainingPending = [];

      for (const item of sourceItems) {
        try {
          const res = insertNewsWithStatus(db, item);
          if (res.inserted) {
            inserted += 1;
            sourceInserted += 1;
            const savedAlert = insertAlert(db, buildNewsAlert(res.item));
            if (!savedAlert.alreadyExisted) {
              alerts.push(savedAlert);
              immediateNewsAlerts.push(savedAlert);
            }
          } else if (res.updated) {
            updated += 1;
            sourceUpdated += 1;
          }
        } catch (err) {
          remainingPending.push(item);
          h.error = h.error || String(err.message || err).slice(0, 200);
        }
      }

      h.inserted = sourceInserted;
      h.updated = sourceUpdated;
      h.pending_count = remainingPending.length;
      const capturedAt = (sourceInserted > 0 || sourceUpdated > 0) ? new Date().toISOString() : (prevState?.last_captured_at || h.last_success_at || null);
      h.last_captured_at = capturedAt;

      saveSourceState(db, {
        source_id: source.id,
        name: source.name,
        url: source.url,
        type: source.type,
        kind: source.kind,
        poll_ms: source.pollMs || 60_000,
        cursor_id: h.cursor_id,
        pending_items: remainingPending,
        last_attempt_at: h.last_attempt_at,
        last_success_at: h.last_success_at,
        last_news_published_at: h.last_news_published_at,
        last_captured_at: capturedAt,
        last_fetched_count: h.fetched,
        last_new_count: sourceInserted,
        consecutive_empty: h.status === 'empty_feed' ? ((prevState?.consecutive_empty || 0) + 1) : 0,
        last_http_status: h.http_status,
        status: h.status,
        last_error: h.error,
        last_delay_sec: h.last_delay_sec,
        channel_note: source.channel_note || null,
      });
    }

    for (const e of duePrealerts(events)) {
      const savedPrealert = insertAlert(db, {
        title: `Agenda 15 min · ${e.currency} ${e.title}`,
        body: `Est ${e.forecast || '—'} · Prev ${e.previous || '—'}`,
        level: 'alto',
        alert_type: 'calendario',
        currency: e.currency,
      });
      db.prepare('UPDATE calendar SET prealerted=1 WHERE id=?').run(e.id);
      alerts.push(savedPrealert);
      immediateNewsAlerts.push(savedPrealert);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  // Encolar y despachar notificaciones de noticias INMEDIATAMENTE al registrarlas,
  // antes e independientemente del cálculo de puntuaciones MMT.
  if (immediateNewsAlerts.length > 0) {
    enqueuePushForAlerts(db, immediateNewsAlerts);
    if (typeof onNewAlerts === 'function') {
      try {
        await onNewAlerts(immediateNewsAlerts);
      } catch {
        // Un fallo en el transporte de notificaciones nunca bloquea la recepción ni el ciclo
      }
    }
  }

  events = listCalendar(db);
  const stored = listNews(db, 250);
  linkNewsToCalendar(stored, events);
  persistCalendarLinks(db, events);
  persistNewsLinks(db, stored);

  // Fase 2: Clasificación determinista Agente MMT (aislada para no afectar recepción ni alertas de noticias)
  let classificationError = null;
  if (classify) {
    try {
      const horizon = new Date(Date.now() - WINDOWS.oficialMs).toISOString();
      const cycleNow = Date.now();
      const allEligibleWindowNews = selectEvidence(recentNews(db, horizon), cycleNow, Number.MAX_SAFE_INTEGER);
      const news = selectEvidence(allEligibleWindowNews, cycleNow);
      const contract = evidenceContract(news, cycleNow);
      const snapshot = new Date().toISOString();
      const activeCodeHash = computeCodeHash();
      const prevAgent = latestEngine(db, 'agente');
      const prevContractHash = prevAgent?.rows?.[0]?.calibration?.evidenceSet || null;
      const isNewContract = contract.evidenceSet !== prevContractHash;

      const agentContract = {
        ...contract,
        engine: 'agente',
        engineLabel: ENGINE_NAME,
        opVersion: OP_VERSION,
        codeHash: activeCodeHash,
        generatedAt: snapshot,
        evaluatedAt: contract.asOf,
        reused: false,
        interpretationMode: 'deterministic_rules',
        decayRecalculated: true,
        decayRecalculatedAt: contract.asOf,
      };

      // Invariant 1: Operational and Shadow Agent evaluate the EXACT same contracted `news`.
      const shadowRows = classifyAgentShadow(news, cycleNow);
      const shadowByCcy = new Map(shadowRows.map((s) => [s.currency, s]));
      // Expanded coverage is evaluated as a separate experiment with its own contract.
      const expandedExp = evaluateExpandedCoverageExperiment(allEligibleWindowNews, cycleNow);

      const agentRows = attachRanks(classifyAgent(news, cycleNow)).map((r) => {
        const sh = shadowByCcy.get(r.currency);
        return {
          ...r,
          calibration: agentContract,
          shadow: sh ? {
            ...sh,
            evidenceSet: contract.evidenceSet,
            codeHash: activeCodeHash,
            deltaFromOp: sh.score - r.score,
          } : null,
        };
      });
      const prevRowsByCcy = new Map((prevAgent?.rows || []).map((r) => [r.currency, r]));
      const scoresChanged = !prevAgent?.rows?.length || agentRows.some((r) => {
        const p = prevRowsByCcy.get(r.currency);
        return !p || p.score !== r.score || p.bias !== r.bias || p.rank !== r.rank || p.structural !== r.structural || p.impulse !== r.impulse;
      });
      const prevSnapMs = Date.parse(prevAgent?.snapshot_at || '');
      const snapAgeExceeded = !Number.isFinite(prevSnapMs) || (cycleNow - prevSnapMs >= 15 * 60_000);
      if (isNewContract || scoresChanged || snapAgeExceeded) {
        saveScores(db, 'agente', agentRows, randomUUID(), snapshot, '');
      }
      const rankAlerts = rankingAlerts(prevAgent?.rows, agentRows, ENGINE_NAME).map((a) => insertAlert(db, a)).filter((a) => !a.alreadyExisted);
      if (rankAlerts.length > 0) {
        alerts.push(...rankAlerts);
        enqueuePushForAlerts(db, rankAlerts);
        if (typeof onNewAlerts === 'function') {
          try { await onNewAlerts(rankAlerts); } catch { /* ignore */ }
        }
      }

      const prevTransitionStates = getMeta(db, 'currency_transition_states_v4', {}) || {};
      const nextTransitionStates = { ...prevTransitionStates };
      const latestMktRow = db.prepare('SELECT reference_date FROM market_snapshots WHERE reference_date IS NOT NULL ORDER BY reference_date DESC LIMIT 1').get();
      const latestFixingInDb = latestMktRow?.reference_date || null;
      const fixingAnchor = entryFixingDateForSignal(snapshot);

      const calEntries = agentRows.map((r) => {
        const sh = r.shadow;
        const ccyNewsItems = news.filter((n) => (n.currencies || []).includes(r.currency));
        const allEligibleCcyItems = allEligibleWindowNews.filter((n) => (n.currencies || []).includes(r.currency));
        const transition = classifyCurrencyTransition(prevTransitionStates[r.currency], ccyNewsItems, allEligibleCcyItems, contract.asOf);
        nextTransitionStates[r.currency] = transition.nextState;

        const opScore = r.noEvidence ? null : r.score;
        const shScore = sh?.noEvidence ? null : (sh?.score ?? null);

        const ccyNews = ccyNewsItems.map((n) => ({
          fingerprint: n.fingerprint,
          title: n.title,
          published_at: n.published_at,
          source: n.source || null,
          source_type: n.source_type || null,
          release_meta: n.release_meta || null,
        }));

        const priorFixingDate = (latestFixingInDb && fixingAnchor?.entry_fixing_date && latestFixingInDb < fixingAnchor.entry_fixing_date)
          ? latestFixingInDb
          : null;

        return {
          snapshot_at: snapshot,
          evidence_set: contract.evidenceSet,
          as_of: contract.asOf,
          currency: r.currency,
          op_version: OP_VERSION,
          shadow_version: sh?.version || SHADOW_VERSION,
          code_hash: activeCodeHash,
          is_new_contract: isNewContract,
          currency_evidence_hash: transition.currencyEvidenceHash,
          is_new_currency_event: transition.isNewEvent,
          transition_type: transition.transitionType,
          eligible_for_calibration: 1,
          ineligible_reason: null,
          op_agent_score: opScore,
          op_agent_bias: r.noEvidence ? 'no_evidence' : r.bias,
          shadow_agent_score: shScore,
          shadow_agent_bias: sh?.noEvidence ? 'no_evidence' : (sh?.bias ?? null),
          gemini_score: null,
          gemini_bias: null,
          gemini_model: null,
          gemini_evaluated_at: null,
          gemini_reused: 0,
          discrepancy_op_vs_gemini: null,
          discrepancy_shadow_vs_gemini: null,
          ecb_base_date: fixingAnchor?.entry_fixing_date || null,
          prior_fixing_date: priorFixingDate,
          entry_fixing_date: fixingAnchor?.entry_fixing_date || null,
          expected_t1_date: fixingAnchor?.expected_t1_date || null,
          expected_t3_date: fixingAnchor?.expected_t3_date || null,
          citations: ccyNews,
          details: {
            engineMode: 'single_engine_agente_mmt',
            empirical: false,
            entryPolicyVersion: 'ecb-next-reference-day-v2',
            sameEvidenceAsOp: true,
            perCurrencyEvidence: contract.perCurrency?.[r.currency] ?? 0,
            transitionType: transition.transitionType,
            transitionCounts: transition.transitionCounts,
            newEventFingerprints: transition.newEventFingerprints,
            revisionFingerprints: transition.revisionFingerprints,
            addedEvidenceCount: transition.addedCount,
            removedEvidenceCount: transition.removedCount,
            shadowChannelSums: sh?.channelSums || {},
            shadowRegime: sh?.regime || null,
            shadowClusters: sh?.clusters || [],
            agentDecayRecalculatedAt: contract.asOf,
            expandedCoverageExperiment: {
              experimentVersion: expandedExp.experimentVersion,
              contract: expandedExp.contract,
              result: expandedExp.byCurrency[r.currency] || null,
            },
          },
        };
      });
      const hasMeaningfulTransition = calEntries.some(
        (e) => e.transition_type !== 'unchanged_decay_only' && e.transition_type !== 'no_evidence',
      );
      if (isNewContract || hasMeaningfulTransition || !prevAgent) {
        saveCalibrationLog(db, calEntries);
      }
      setMeta(db, 'currency_transition_states_v4', nextTransitionStates);
    } catch (err) {
      classificationError = String(err.message || err);
    }
  }

  return {
    started_at: started,
    finished_at: new Date().toISOString(),
    inserted,
    updated,
    alerts: alerts.length,
    health,
    calendar_sync: calendarSync,
    classification_error: classificationError,
    news_count: listNews(db, 1).length,
    new_alerts: alerts,
  };
}
