# RadarNews — Especificación del producto

> Terminal de noticias financieras personal que monitoriza fuentes de bancos centrales, agencias y análisis para clasificar la fuerza narrativa de 8 divisas en tiempo real, con marco Mosler / MMT.

## 1. Visión

Un terminal privado (estilo Bloomberg simplificado, pensado para una mesa macro) que:

1. **Agrega** todos los titulares publicados por las 35 fuentes seleccionadas (canales de breaking, feeds oficiales de bancos centrales y fuentes de análisis).
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

### 3.5.1 Prensa NZD, CHF y AUD (v5.1 Parte C)

Mismo patrón que los Tesoros por Google News RSS (`news.google.com/rss/search`), tipo `agencia`, frescura 3 días (`when:3d` en la consulta y ventana de 72 h del tipo agencia). Consultas en inglés, tal cual:

| id | Divisa | Consulta |
|---|---|---|
| `nz-press` | NZD | `RBNZ OR "Reserve Bank of New Zealand" OR "Anna Breman" OR "official cash rate" New Zealand when:3d` |
| `ch-press` | CHF | `SNB OR "Swiss National Bank" OR Schlegel OR Tschudin OR "Swiss franc" when:3d` |
| `au-press` | AUD | `RBA OR "Reserve Bank of Australia" OR Bullock OR Hauser OR "cash rate" Australia when:3d` |

Edición Google News: NZ `hl=en-NZ&gl=NZ&ceid=NZ:en`, AU `hl=en-AU&gl=AU&ceid=AU:en`, CH `hl=en-US&gl=CH&ceid=CH:en` (inglés, edición suiza; el resto del patrón es el de los Tesoros).

**RNZ negocios (añadida).** `rnz-business`, tipo `agencia`, divisa NZD, `https://www.rnz.co.nz/rss/business.xml`. El índice oficial `https://www.rnz.co.nz/rss` enlaza `/rss/business.xml`. Comprobado el 10-nov-2026 a las 20:18 UTC: HTTP 200, `content-type: application/xml`, 14 ítems parseados, todos con `published_at` dentro de 7 días. El más reciente es `2026-11-10T20:01:37Z` (`Wed, 11 Nov 2026 09:01:37 +1300`, antigüedad 0,29 h). Titulares de esa ventana: «Emergency services strike could affect 'tens of thousands' of travellers - Auckland Airport» (`2026-11-10T18:48:42Z`, coincide con Auckland) y «Retail spending subdued ahead of holiday season» (`2026-11-09T23:26:02Z`).

**swissinfo economía (omitida).** No responde HTTP 200 con un titular. El 10-nov-2026: `https://www.swissinfo.ch/eng/topic/economy/feed/`, `https://www.swissinfo.ch/eng/economy/rss` (redirige a `/eng/economy/feed/`), `https://www.swissinfo.ch/eng/feed/` y los feeds de tema en alemán, francés y español responden HTTP 410 con «No feed available». La ruta antigua `https://www.swissinfo.ch/service/eng/rssxml/economy/rss.xml` responde HTTP 400. `https://www.swissinfo.ch/eng/economy.rss` responde HTTP 404. La página `https://www.swissinfo.ch/eng/topic/economy/` (HTTP 200) no publica `application/rss+xml`. No se añade.

Ninguna fuente de la lista del §3.7 entra en esta parte.

### 3.6 Calendario

| Fuente | Canal |
|--------|-------|
| **ForexFactory** | `nfs.faireconomy.media/ff_calendar_thisweek.json` — semana en curso, 8 divisas, cada hora vía el ciclo de 5 min. |

### 3.7 Descartadas (no reintentar)

DeItaone, FirstSquawk, ZeroHedge (fake), Reuters vía Google News, WSJ congelado, Bloomberg.com (ToS), Truth Social directo (sin credenciales; llega por FJ), MarketWatch, FXStreet, Investing.com, Cinco Días.

### 3.8 Polymarket geopolítico y Washington (v5.1 Parte D)

Gamma público (`https://gamma-api.polymarket.com`), sin clave y sin coste. No es una fuente de titulares: no entra en las 35 ni en la salud. No hay FedWatch ni probabilidades de bancos centrales. Cadencia 30 min, con la misma espera creciente que el calendario. Si Gamma falla, el bloque sale `STALE` con la hora del último éxito y sin datos inventados.

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
10. Informe de salud por fuente **sin maquillaje**: un fallo se publica como fallo (`error`, `empty_feed`); en la función serverless, una consulta que no responde y que Actions leyó bien dentro de 15 minutos se etiqueta `cached`, y una consulta que sí responde se etiqueta `live`. Se conservan `last_success_at` y `consecutive_failures`.

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
- `silence` (v5.1 Parte C, umbral congelado ≥ 12 h hábiles): en USD, EUR, GBP, JPY, CHF, CAD, AUD y NZD, `silence: true` cuando `hours_since_last_business` ≥ 12 (el valor ya redondeado a un decimal) o cuando no hay ningún titular (`hours_since_last_business` null). Con 11,9 h queda en `false`. Un hueco de fin de semana no cuenta: el sábado y el domingo UTC se excluyen igual que en `hours_since_last_business`. XAU no lleva el campo. La bandera no bloquea, no cambia `lock_level` y no sube el nivel por sí sola; el cruce con un evento activo es la Parte E y no está aplicado.

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
`iris_g8_feed.json` y `/api/health` publican `health`: `sources_active` (vivas + copia de la última sincronización), `sources_live`, `sources_cached`, `sources_total`, `sources_empty`, `sources_error`, `agenda_events_count` y `status`: `CLEAN` si no hay errores ni fuentes vacías, `DEGRADED` si al menos el 80 % están activas, `CRITICAL` por debajo y `UNKNOWN` sin fuentes. `sources_total` es el número de fuentes configuradas: 35 desde la Parte C (31 anteriores, más `nz-press`, `ch-press`, `au-press` y `rnz-business`). Las reglas CLEAN / DEGRADED / CRITICAL no cambian: `cached` cuenta como activa. `public/data/radar_status.json` es el latido de cada ciclo y no lleva el estado por fuente.

### Base en vivo (v5.1 Parte C-bis)

`netlify/functions/radar_live.mjs` usa como base la última publicación de Actions en GitHub Raw (`main`, `public/data/radar_news_full.json`; los titulares, `public/data/radar_store.json`). El JSON empaquetado en el despliegue solo entra si esa descarga falla. `/api/iris-feed`, `/api/health` y `/api/radar-full` publican `base_source` (`actions_raw` o `bundle`) y `base_published_at` (`generated_at` de ese archivo, o `last_sync.finished_at` si no hay `generated_at`).

Cadencia, por fuente, leída solo de `status` y `last_success_at` en `radar_news_full.json`: está dentro de su cadencia si `status === 'ok'` y `last_success_at` tiene como máximo 15 minutos (el instante de 15:00 incluido; 15:01 ya no). Una consulta que responde sale `live`. Si falla o agota el tiempo y la fuente está en cadencia, sale `cached` y los titulares son los de esa publicación. Si Actions no la tiene en `ok`, o `last_success_at` pasa de 15 minutos, sale `error`. Una respuesta HTTP con cero titulares sigue en `empty_feed`. Si la fuente tiene URL de reserva y las dos agotan el tiempo, el colector deja `empty_feed` sin código HTTP: la función lo cuenta como fallo, no como feed vacío. La ventana por fuente no cambia: 700 ms cuando la base trae titulares y 3800 ms si llega vacía. `sources_live` cuenta las filas `live`. `sources_ok` cuenta esas mismas filas.

## Contrato Polymarket geopolítico (v5.1 Parte D)

Tabla fija en `src/config.js`, sin dirección. La palabra clave se busca en el título del evento, sin distinguir mayúsculas, desde el inicio de una palabra (`\b` + palabra). Así «nato» no entra dentro de «senator». Las de varias palabras («trade deal», «strike on», «section 232») también empiezan en un límite de palabra. La tabla añade «iranian» e «israeli» en `IRAN_ORIENTE_MEDIO` y «chinese» en `CHINA_TAIWAN`. Constantes congeladas el 10-nov-2026: volumen total ≥ 250.000 USD, liquidez ≥ 25.000 USD, máximo 5 por tema por volumen, historia 8 días. Los umbrales de |Δ24h| (10 puntos y 5 puntos) son de la Parte E y este bloque no asigna nivel, puesto ni dirección.

| theme | Palabras clave | Divisas expuestas |
|---|---|---|
| `IRAN_ORIENTE_MEDIO` | iran, iranian, israel, israeli, hormuz, houthi, gaza, saudi, strike on | USD, CHF, JPY, CAD, EUR, XAU |
| `RUSIA_UCRANIA` | russia, ukraine, putin, zelensky, ceasefire, nato | EUR, CHF, GBP, XAU |
| `ARANCELES_COMERCIO` | tariff, trade deal, trade war, usmca, section 232, section 301 | CAD, AUD, NZD, EUR, JPY, CHF |
| `WASHINGTON` | shutdown, veto, executive order, debt ceiling, impeach, supreme court, fed chair, congress passes, signs into law | USD, XAU |
| `CHINA_TAIWAN` | china, chinese, taiwan, beijing, xi jinping | AUD, NZD, JPY, USD |

Entran eventos abiertos (`closed` false, no archivados, `active` distinto de false) que pasan el volumen y la liquidez del evento. Cada evento publica una fila: el mercado abierto de mayor volumen, su pregunta y la probabilidad Yes en escala 0–100 (dos decimales). `d24h_pp` es esa probabilidad menos la de la instantánea más cercana a hace 24 h, dentro de ±1 h (el borde cuenta; si hay dos a la misma distancia, la más antigua). Si esa instantánea no existe, o no trae ese mercado, `d24h_pp` es `null`. Un evento puede salir en cada tema cuyo título encaje. `volume` y `liquidity` de la fila son los totales del evento. `currencies` es la lista fija del tema, en el orden de la tabla. `url` es `https://polymarket.com/event/{slug}`, o `null` si no hay slug.

Se excluyen, aunque una palabra clave encaje: deportes, cripto, entretenimiento y bancos centrales. La etiqueta Gamma `fed-rates` no excluye sola, porque también marca la nominación de Fed Chair, que la tabla deja en `WASHINGTON`. Sí se excluye un título de decisión de tipos (`fed rate`, `fomc`, `fedwatch`, y el resto de la lista en `POLYMARKET_GEO_EXCLUSIONS`). Si una página de Gamma falla, no se publica un recorrido a medias: el bloque queda `STALE`.

`status` es `OK` cuando la última lectura de Gamma tuvo éxito (como mucho hace 30 min) y `STALE` cuando falló. `updated_at` es siempre la hora de ese último éxito, o `null` si todavía no hubo ninguno. Historia: `public/data/polymarket_geo_history.json` (`schema: polymarket-geo-history/v1`), instantáneas de 8 días. El ciclo de Actions la incluye en el commit de datos y conserva el candado `[skip netlify]`. La espera tras un fallo es la del calendario: 15 min, se duplica, tope 6 h, guardada en disco para que el siguiente proceso del bucle la respete.

El bloque `polymarket_geo` es `{status, updated_at, markets:[{theme, event_title, question, prob, d24h_pp, volume, liquidity, end_date, url, currencies}]}`. Se añade a `iris_g8_feed.json` y a `radar_news_full.json`. El esquema sigue en `iris-g8-feed/v2-mmt-v4.0` hasta la Parte F. `llm_calls` sigue en 0. La función live lee la historia en GitHub Raw (`public/data/polymarket_geo_history.json`) y, si esa descarga falla, la copia empaquetada.

## Alertas y acceso (decisión de la mesa, 8-nov-2026)
Push desactivado en el despliegue serverless: las alertas se ven dentro de la app (pestaña Alertas y contador). La app y sus datos son públicos.

## Contrato de evidencia MMT v1
El Agente MMT recibe una muestra de hasta 80 noticias, seleccionada por turnos entre las ocho divisas, con 72 horas para breaking/agencias y 30 días oficiales. Se excluyen fechas inválidas/futuras. Cada ciclo conserva huella de la muestra, fecha de corte y recuento por divisa. El Agente conserva contribuciones por noticia, antes y después de antigüedad/topes.
La escala es descriptiva MMT/Mosler; no es probabilidad ni está calibrada históricamente. ±12 y la media equiponderada son parámetros de diseño, no pesos ajustados por divisa. Se requiere evaluación fuera de muestra antes de afirmar calibración predictiva.
Los cruces y la matriz excluyen divisas N/D.
<!-- ENZO 2026-11-04: redeploy para publicar functions (sin cambios de contenido) -->
