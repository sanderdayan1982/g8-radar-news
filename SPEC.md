# RadarNews — Especificación del producto

> Terminal de noticias financieras personal que monitoriza fuentes de bancos centrales, agencias y análisis para clasificar la fuerza narrativa de 8 divisas en tiempo real, con marco Mosler / MMT.

## 1. Visión

Un terminal privado (estilo Bloomberg simplificado, pensado para una mesa macro) que:

1. **Agrega** todos los titulares publicados por las 25 fuentes seleccionadas (canales de breaking, feeds oficiales de bancos centrales y fuentes de análisis).
2. **Conserva en la cinta y notifica cada noticia nueva** sin descartes por impacto o divisa en la recepción; los filtros de relevancia macro/MMT se aplican únicamente a la capa de análisis.
3. **Clasifica** la fuerza narrativa de cada divisa de −100 a +100 con el motor determinista único **Agente MMT**, **según noticias, no precios**, bajo Soft Currency Economics (Mosler / MMT).
4. **Sigue el calendario económico de la semana** y avisa de los datos de alto impacto.
5. **Alerta** al usuario de cada noticia nueva dentro de la app y mediante cola persistente Web Push — **nunca por email**.

El usuario no ve gráficos de precios como señal. Ve la cinta, el ranking, el calendario y entiende *por qué* se mueve cada divisa. Lenguaje de mesa: **Soporte / Presión / Neutral / N/D**. Prohibido “long”, “short”, “sesgo largo/corto”, “vía libre operativa”, “compra”, “vende”, “subirá”, “bajará” en cualquier texto generado.

## 2. Universo de divisas

8 divisas, sin excepciones:

| Divisa | Banco central | Keywords base |
|--------|---------------|---------------|
| USD | Fed | dollar, fed, fomc, powell, treasury, payrolls |
| EUR | BCE | euro, ecb, lagarde, eurozone, germany… |
| GBP | BoE | pound, sterling, boe, bailey, uk |
| JPY | BoJ | yen, boj, ueda, japan |
| CHF | SNB | franc, snb, swiss |
| CAD | BoC | loonie, boc, canada |
| AUD | RBA | aussie, rba, australia |
| NZD | RBNZ | kiwi, rbnz, new zealand |

Una divisa **sin titulares propios** no se rankea (`rank: null`, etiqueta **N/D · Sin evidencia**). No hereda narrativa de otra región.

## 3. Fuentes de noticias

Las fuentes que ya estaban en producción **no se quitan**.

### 3.1 Núcleo de breaking — activo

| Fuente | Tipo | Canal | Estado |
|--------|------|-------|--------|
| **FinancialJuice** | breaking | Telegram público `t.me/s/FinancialJuice` | Activo. Datos ACTUAL/FORECAST/PREVIOUS, agencia, geopolítica y **posts de Trump en Truth Social** (vía FJ; no hay API pública de Truth Social). Ventana: 3 días. |

### 3.2 Oficiales G3/G8 ya activos

| Fuente | URL |
|--------|-----|
| **Fed** | federalreserve.gov/feeds/press_all.xml |
| **BCE** | ecb.europa.eu/rss/press.html |
| **BoE** | bankofengland.co.uk/rss/news |
| **BoJ** | boj.or.jp/en/rss/whatsnew.xml |
| **BoC** | bankofcanada.ca/content_type/press-releases/feed/ |
| **RBA** | rba.gov.au/rss/rss-cb-media-releases.xml |

### 3.3 Oficiales NZD (añadidos)

| # | Fuente | Para qué | Canal |
|---|--------|----------|-------|
| 1 | **RBNZ news** | OCR, MPS, FSR, MPC | https://www.rbnz.govt.nz/feeds/news |
| 2 | **Treasury / NZDM** | Emisión, PREFU, tenders (IRMA/NFA) | https://www.treasury.govt.nz/feeds/news |
| 3 | **Stats NZ** | CPI, labour, GDP | https://www.stats.govt.nz/news/ |

Filtro: fuera cyber, TSB, reclutamiento, visitas regionales. Dentro: OCR, MPS, tenders, CPI, employment, PREFU.

### 3.4 Oficiales CHF (añadidos)

| # | Fuente | Para qué | Canal |
|---|--------|----------|-------|
| 1 | **SNB** comunicados / mopo / discursos / ad hoc | El banco | https://www.snb.ch/public/rss/en/pressrel · `/mopo` · `/speeches` · `/adhoc` |
| 2 | **SNB Bills** | Canal operacional Mosler | https://www.snb.ch/public/rss/en/snbbbills |
| 3 | **SNB ciclo** | Economía real | https://www.snb.ch/public/rss/en/buscycletrends |
| 4 | **SECO** | PIB, mercado laboral, previsiones | https://www.seco.admin.ch/en/press-releases |
| 5 | **BIS** press + discursos de bancos centrales | Contexto G8 / CHF | bis.org/doclist/all_pressrels.rss · cbspeeches.rss |

Filtro: fuera premios (Carl Menger), reclutamiento, divulgación. Dentro: assessment, BOP, profit distribution, speeches de política.

### 3.5 Agencias y análisis

| Fuente | Canal |
|--------|-------|
| **InvestingLive** | `t.me/s/InvestingLiveNews` |
| **Financial Times** | RSS global-economy, markets, currencies |
| **Negocios TV** | `t.me/s/negociostv` (solo G8/macro/geo; se descarta política doméstica ES sin divisa) |
| **Brújula de Mercados** | Telegram público `t.me/s/BrujulaDeMercados` (confirmado). Slug override: `RADARNEWS_BURBUJA_CHANNEL`. |

### 3.6 Calendario

| Fuente | Canal |
|--------|-------|
| **ForexFactory** | `nfs.faireconomy.media/ff_calendar_thisweek.json` — semana en curso, 8 divisas, cada hora vía el ciclo de 5 min. |

### 3.7 Descartadas (no reintentar)

DeItaone, FirstSquawk, ZeroHedge (fake), Reuters vía Google News, WSJ congelado, Bloomberg.com (ToS), Truth Social directo (sin credenciales; llega por FJ), MarketWatch, FXStreet, Investing.com, Cinco Días.

## 4. Pipeline de ingesta (`refreshFeed`)

1. Descarga en paralelo, timeout 15 s.
2. Parsea RSS / Telegram público / HTML de comunicados.
3. Frescura: 3 días breaking/agencias, 30 días oficiales.
4. Relevancia: oficiales solo política monetaria/mercado; breaking si divisa, dato o BREAKING real.
5. Enriquece: divisas, impacto 1–5, categoría, ACTUAL/FORECAST/PREVIOUS, z-score heurístico.
6. Enlaza calendario ±18 h por **familia y lugar** (PMI manufacturing ≠ services; French ≠ German). El `actual` se guarda por `id` de evento y **sobrevive** a un refresh de ForexFactory vacío o a un reinicio.
7. Deduplica por fingerprint canónico: HTTP=HTTPS; Telegram canal = mensaje (`t.me/canal/id` gana); InvestingLive por path del artículo. Un aviso de defensa civil no asigna USD/JPY/CHF; Hormuz/ataque sí.
8. Cuenta por ciclo: `pulled` (titulares descargados) e `inserted` (nuevos frente a la ventana previa).
9. Alertas de titulares nuevos (≤12 h) impacto ≥4 (o geo ≥3). Una publicación de datos = una alerta por divisa y 15 min.
10. Informe de salud por fuente **sin maquillaje**: un fallo se publica como fallo (`error`, `empty_feed`); en la función serverless, la copia de la última sincronización se etiqueta `cached`. Se conservan `last_success_at` y `consecutive_failures`.

Frecuencia: GitHub retrasa o salta los cron de 5 min, así que un disparador horario (más uno de respaldo a la media hora) arranca un trabajo de ~57 min que sincroniza con su propio reloj: cada 5 min y cada 60 s si hay un evento High a ±15 min (`scripts/sync_loop.sh`). La concurrencia impide dos bucles a la vez. Cada bucle que termina sin errores lanza el siguiente (`workflow_dispatch`), porque GitHub dejó de disparar los cron durante 4 h el 8-nov-2026; los cron quedan como reinicio si la cadena se rompe. `public/data/radar_status.json` se publica en cada ejecución (`last_check_at`) para que la antigüedad sea visible. El feed completo se publica si hay titulares nuevos, si cambia el calendario (consenso/dato real) o si cambia el estado de una fuente.

## 5. Clasificación — Mosler / Soft Currency Economics

**Marco interpretativo declarado:** un único motor determinista Agente MMT interpreta las noticias con reglas Mosler / Soft Currency Economics. Los scores describen evidencia narrativa; no son probabilidades ni rentabilidad validada. `empirical: false`. El motor operativo y las hipótesis en sombra mantienen sus versiones y parámetros anteriores a esta revisión.

Canales: `DATA_REAL`, `RELATIVE_PRICE`, `POLICY_PRICE`, `FISCAL_NFA`, `RISK_GEO`, `TRADE_EXTERNAL`, `OPERATIONAL`. No se ejecuta Gemini ni existe consenso entre motores.

Reglas Mosler:

1. Solo titulares aportados. Prohibido arrastre regional.
2. **CPI alto + economía débil/insostenible no es soporte** (canal precio relativo; techo 0 en ese catalizador).
3. El overnight es el **precio** del dinero. Un hike en cost-push **no suma**.
4. El déficit no financia gasto; la emisión drena reservas (IRMA). Déficit/downgrade de un **emisor soberano** (USD, JPY, GBP, CAD, AUD, NZD, CHF) **no es presión automática**. El **EUR es usuario de moneda** (v4.0): la tensión de déficit periférico activa B12 EUR_FRAG y sí puede presionar.
5. Interés sobre pasivos públicos = ingreso del no-gobierno.
6. Sin evidencia ⇒ score 0, N/D, `rank: null`. No alerta de régimen.
7. Evidencia débil ⇒ −40…+40. Máx. 3 drivers, < 60 caracteres, español.
8. `bias` interno: alcista > 12, bajista < −12 (umbral de etiqueta, no constante Mosler); UI: Soporte / Presión / Neutral / N/D / En conflicto.
9. Structural = 72 h (oficiales hasta 30 d, vida media 36 h / 10 d). Impulse = 3 h; **sin prints en la ventana se muestra n/d, no 0**.
10. Refugio severo: USD/JPY/CHF soporte; AUD/NZD/CAD presión.

Los empates comparten rango; una divisa sin evidencia no recibe posición. El orden alfabético de los empates es únicamente de presentación.

## 6. Interfaz

Grafito, Inter + JetBrains Mono. Verde/rojo solo dirección. PWA: Mac Dock, iPhone/iPad Home Screen. Push VAPID a **todos** los dispositivos a la vez, badge de no leídas. HTTPS público con sesión de acceso; no se necesita VPN. El servidor escucha únicamente en localhost detrás del proxy HTTPS.

La cinta usa la **fecha de publicación del comunicado** (RSS, URL o `meta-info` de SECO), no la de captura. Un FOMC del 16-sep o un forecast SECO del 17-sep no se rejuvenece al reescrapear el 24-oct. Tooltip: publicado vs capturado cuando diferencian > 2 h.

Cruces sin cotización muestran **sin precio**. La coincidencia precio-narrativa se llama **Alineado con spot**, no “Flujo confirmado”.

Si la cobertura de actuals en vivo cae por debajo del 50 % (≥ 4 eventos con consenso), la UI muestra **datos degradados**: fuentes operativas ≠ integridad de la información.

## 7. Alertas

Solo in-app + push. Sin correo. Breaking, dato, agenda −15 min High, cambio de ranking/régimen **con evidencia**. Cada noticia nueva elegible genera entregas independientes por dispositivo. Cola persistente con reintentos; HTTP 2xx del proveedor significa aceptación, no visualización. La visualización se registra mediante recibo firmado del service worker; el sonido depende del sistema operativo.

## 8. Despliegue

**Producción actual (serverless, coste cero):** Netlify sirve `public/` y la función `radar_live`; GitHub Actions ejecuta `scripts/sync_feeds.mjs` y publica los JSON con `[skip netlify]`. Antes de publicar, el workflow pasa las pruebas del motor y de los contratos; si fallan, no se publica (fallo cerrado) y `radar_status.json` deja de avanzar. `/api/refresh` está limitado a una actualización forzada por minuto.

**Limitaciones conocidas del modo serverless:** no hay envío Web Push (solo existe en el servidor Node descrito abajo); no hay sesión de acceso (el repositorio y los datos son públicos).

**Despliegue alternativo (servidor propio, no activo):**

Node.js 22+ con `node:sqlite`, systemd, SQLite WAL. Código `/opt/radarnews/app`, datos `/var/lib/radarnews`. HTTPS público existente y login de aplicación. Conservar `settings.json` (VAPID), base de datos y claves de sesión. Copia consistente antes de desplegar; procedimiento en DEPLOY.md. Los cuatro dispositivos se registran por separado.

## 9. Decisiones inquebrantables

1. Narrativa, no precios como señal.
2. Solo fuentes vivas.
3. Sin medios populares.
4. Alertas estrictas; email prohibido.
5. Deduplicación.
6. UI en español; titulares en idioma original.
7. Mosler: CPI+debilidad ≠ soporte.
8. Sin lenguaje de ejecución (“long”, “short”, “sesgo largo/corto”, “vía libre operativa”, “compra”, “vende”, “subirá”, “bajará”).


## Contrato de retención (v5.1 Parte A)

La memoria y la presentación van separadas. Constantes congeladas el 10-nov-2026: 72 h para breaking y agencia, 45 días para fuentes oficiales, tope de memoria 5.000, tope del feed IRIS 3.000.

- `public/data/radar_store.json` (`schema: radar-store/v1`) guarda todos los titulares deduplicados dentro de su ventana. `scripts/sync_feeds.mjs` lo reutiliza como `existingItems`. La cinta `news` de `radar_news_full.json` sigue en 300 y no es memoria: usarla recortaba la ventana real a unas 12 h.
- Si la memoria supera 5.000, salen primero los breaking más antiguos y después el resto de no oficiales. Un oficial dentro de su ventana no se elimina; si los oficiales solos superan el tope, la lista puede pasarse de 5.000. El feed IRIS (`items`) publica la misma ventana con tope 3.000 y la misma regla.
- `coverage` en el feed, por divisa y en este orden (USD, EUR, GBP, JPY, CHF, CAD, AUD, NZD, XAU): `count_72h`, `count_official_45d` (oficiales de los 45 días; un oficial de las últimas 72 h cuenta en los dos), `last_item_at`, `hours_since_last` (horas naturales, un decimal) y `hours_since_last_business` (sin sábados ni domingos UTC; los festivos sí cuentan). Las horas del JSON comprometido se refrescan cuando el ciclo reescribe el feed; la función live las recalcula en cada petición.

## Contrato de candados (v5.1 Parte B)

Cada evento High o de banco central de la agenda recibe `lock_class` y `lock_level`. Las clases se evalúan en este orden y gana la primera que encaja, sin distinguir mayúsculas. Constantes congeladas el 10-nov-2026: ventana activa 48 h, POST-EVENTO 24 h, retirar limitadas 2 h antes de un DISCURSO.

| lock_class | Regla sobre el título | lock_level | Ventana activa |
|---|---|---|---|
| `DECISION_BC` | federal funds rate, fomc statement, official bank rate, bank rate votes, main refinancing rate, deposit facility rate, monetary policy statement, official cash rate, cash rate, overnight rate, policy rate, rate statement, rate decision, monetary policy assessment, press conference | `TOTAL` | 0 < horas ≤ 48 |
| `PRESUPUESTO` | budget, fiscal statement, spending review, fiscal update, prefu | `TOTAL` | 0 < horas ≤ 48 |
| `DISCURSO` | `\bspeaks\b`, testifies, testimony. High o Medium bloquean; Low o sin impacto no | High o Medium: `NO_AMPLIAR` (`retirar_limitadas: true` si horas ≤ 2). Low o sin impacto: clase `DISCURSO`, nivel `NINGUNO`, `retirar_limitadas: false` | 0 < horas ≤ 48, y solo si el impacto es High o Medium |
| `TIER1_DATO` | cpi, hicp, inflation rate, non-farm, nonfarm, employment change, unemployment rate, gdp, retail sales, pce (solo impacto High) | `TIER1` | 0 < horas ≤ 48 |
| `OTRO_HIGH` | cualquier otro evento High | `AVISO` | 0 < horas ≤ 48 |

Un `DISCURSO` de impacto Low, o sin impacto, sigue en la agenda con `lock_class: "DISCURSO"` y no entra en el `lock_level` de la divisa. `DECISION_BC` y `PRESUPUESTO` no dependen del impacto. Severidad: `TOTAL` > `TIER1` > `NO_AMPLIAR` > `AVISO` > `NINGUNO`. Fuera de la ventana el nivel es `NINGUNO` y la clase reconocida se conserva. Cuando el evento ya ocurrió, el candado termina y `✓ POST-EVENTO` muestra Act/Est/Prev durante 24 h. Un actual puede seguir en la lista de agenda hasta 48 h después (retención del 4-nov); entre 24 h y 48 h el evento sigue en la lista con Act/Est/Prev y `window_status` null. Por divisa, `lock_level` es el evento activo más severo y `lock_events` lista `lock_class`, `title`, `time` y `hours_until`. `TIER1` no decide solo: CIRO lo cruza con el posicionamiento que aporta ARGOS.

El esquema del feed sigue en `iris-g8-feed/v2-mmt-v4.0`. `agenda_window` añade `lock_class`, `lock_level` y `retirar_limitadas`. `window_status` de un evento activo pasa a ser el nivel (`TOTAL`, `TIER1`, `NO_AMPLIAR`, `AVISO`); dentro de las 24 h posteriores es `✓ POST-EVENTO`; el resto queda en null. En el ranking, `calendar_lock` de un candado activo pasa a ser ese nivel, y se añaden `lock_level`, `lock_class`, `lock_events` y `retirar_limitadas`. La sincronización y `netlify/functions/radar_live.mjs` usan el mismo `buildAgendaWindow`.

## Contrato de salud IRIS
`iris_g8_feed.json` y `/api/health` publican `health`: `sources_active` (vivas + copia de la última sincronización), `sources_live`, `sources_cached`, `sources_total`, `sources_empty`, `sources_error`, `agenda_events_count` y `status`: `CLEAN` si no hay errores ni fuentes vacías, `DEGRADED` si al menos el 80 % están activas, `CRITICAL` por debajo y `UNKNOWN` sin fuentes. `public/data/radar_status.json` es el latido de cada ciclo.

## Alertas y acceso (decisión de la mesa, 8-nov-2026)
Push desactivado en el despliegue serverless: las alertas se ven dentro de la app (pestaña Alertas y contador). La app y sus datos son públicos.

## Contrato de evidencia MMT v1
El Agente MMT recibe una muestra de hasta 80 noticias, seleccionada por turnos entre las ocho divisas, con 72 horas para breaking/agencias y 30 días oficiales. Se excluyen fechas inválidas/futuras. Cada ciclo conserva huella de la muestra, fecha de corte y recuento por divisa. El Agente conserva contribuciones por noticia, antes y después de antigüedad/topes.
La escala es descriptiva MMT/Mosler; no es probabilidad ni está calibrada históricamente. ±12 y la media equiponderada son parámetros de diseño, no pesos ajustados por divisa. Se requiere evaluación fuera de muestra antes de afirmar calibración predictiva.
Los cruces y la matriz excluyen divisas N/D.
<!-- ENZO 2026-11-04: redeploy para publicar functions (sin cambios de contenido) -->
