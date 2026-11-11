export const CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD', 'NZD'];

export const BANK = {
  USD: 'Fed',
  EUR: 'BCE',
  GBP: 'BoE',
  JPY: 'BoJ',
  CHF: 'SNB',
  CAD: 'BoC',
  AUD: 'RBA',
  NZD: 'RBNZ',
};

export const PAIR_PRIORITY = ['EUR', 'GBP', 'AUD', 'NZD', 'USD', 'CAD', 'CHF', 'JPY'];

export const BIAS_LABEL = {
  alcista: 'Soporte',
  bajista: 'Presión',
  neutral: 'Neutral',
};

/** Score cutoff for Soporte / Presión labels. Not a Mosler constant — design parameter; historical calibration pending. */
export const BIAS_THRESHOLD = 12;

export const ENGINE_NAME = 'Agente MMT';

export const CHANNEL_LABEL = {
  DATA_REAL: 'Dato real',
  RELATIVE_PRICE: 'Precio relativo',
  POLICY_PRICE: 'Precio del dinero',
  FISCAL_NFA: 'NFA / fiscal',
  RISK_GEO: 'Riesgo',
  TRADE_EXTERNAL: 'Sector exterior',
  OPERATIONAL: 'Operacional',
};

export const WINDOWS = {
  breakingMs: 3 * 86400_000,
  agenciaMs: 3 * 86400_000,
  oficialMs: 30 * 86400_000,
  structuralMs: 72 * 3600_000,
  impulseMs: 3 * 3600_000,
  halfLifeBreakingH: 36,
  halfLifeOficialH: 240,
  fetchTimeoutMs: 15_000,
  refreshMs: 60_000,
  turboMs: 15_000,
  staleMs: 15 * 60_000,
};

export const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

const BURBUJA = process.env.RADARNEWS_BURBUJA_CHANNEL || 'BrujulaDeMercados';

/**
 * Institutional G8 sources. The count is `SOURCES.length` (35 after v5.1 Parte C).
 * Note on FinancialJuice: `https://www.financialjuice.com/home` is a client-side SPA requiring SignalR/user authentication
 * and does not expose a public RSS feed (`404`). The configured public channel `https://t.me/s/FinancialJuice` is an
 * automated Twitter-to-Telegram mirror that explicitly declares "no affiliation" with financialjuice.com.
 */
export const SOURCES = [
  {
    id: 'financialjuice',
    name: 'FinancialJuice (Telegram · no afiliado)',
    type: 'breaking',
    kind: 'telegram',
    url: 'https://t.me/s/FinancialJuice',
    pollMs: 60_000,
    channel_note: 'Espejo público en Telegram (t.me/s/FinancialJuice, declara no afiliación); cobertura parcial e independiente de la sesión de pago de FinancialJuice.',
  },
  { id: 'fed', name: 'Fed', type: 'oficial', kind: 'rss', url: 'https://www.federalreserve.gov/feeds/press_all.xml', currency: 'USD', pollMs: 180_000 },
  { id: 'ecb', name: 'BCE', type: 'oficial', kind: 'rss', url: 'https://www.ecb.europa.eu/rss/press.html', currency: 'EUR', pollMs: 180_000 },
  { id: 'boe', name: 'BoE', type: 'oficial', kind: 'rss', url: 'https://www.bankofengland.co.uk/rss/news', currency: 'GBP', pollMs: 180_000 },
  { id: 'boj', name: 'BoJ', type: 'oficial', kind: 'rss', url: 'https://www.boj.or.jp/en/rss/whatsnew.xml', currency: 'JPY', pollMs: 180_000 },
  { id: 'boc', name: 'BoC', type: 'oficial', kind: 'rss', url: 'https://www.bankofcanada.ca/content_type/press-releases/feed/', currency: 'CAD', pollMs: 180_000 },
  { id: 'rba', name: 'RBA', type: 'oficial', kind: 'rss', url: 'https://www.rba.gov.au/rss/rss-cb-media-releases.xml', currency: 'AUD', pollMs: 180_000 },
  { id: 'rbnz', name: 'RBNZ', type: 'oficial', kind: 'rss', url: 'https://www.rbnz.govt.nz/feeds/news', currency: 'NZD', pollMs: 180_000 },
  {
    id: 'nz-treasury',
    name: 'NZ Treasury / NZDM',
    type: 'oficial',
    kind: 'rss',
    url: 'https://www.beehive.govt.nz/rss.xml',
    fallbackUrl: 'https://news.google.com/rss/search?q=site:treasury.govt.nz+OR+site:rbnz.govt.nz+OR+NZDM&hl=en-NZ&gl=NZ&ceid=NZ:en',
    currency: 'NZD',
    pollMs: 300_000,
    channel_note: 'Comunicados económicos y fiscales oficiales del Gobierno y Tesoro de Nueva Zelanda (beehive.govt.nz / treasury.govt.nz).',
  },
  {
    id: 'stats-nz',
    name: 'Stats NZ',
    type: 'oficial',
    kind: 'html',
    url: 'https://www.stats.govt.nz/news/',
    fallbackUrl: 'https://news.google.com/rss/search?q=site:stats.govt.nz&hl=en-NZ&gl=NZ&ceid=NZ:en',
    currency: 'NZD',
    pollMs: 300_000,
    channel_note: 'Comunicados oficiales de Stats NZ extraídos del bloque JSON PaginatedBlockPages en stats.govt.nz/news/.',
  },
  { id: 'snb-press', name: 'SNB · Comunicados', type: 'oficial', kind: 'rss', url: 'https://www.snb.ch/public/rss/en/pressrel', currency: 'CHF', pollMs: 180_000 },
  { id: 'snb-mopo', name: 'SNB · Política monetaria', type: 'oficial', kind: 'rss', url: 'https://www.snb.ch/public/rss/en/mopo', currency: 'CHF', pollMs: 180_000 },
  { id: 'snb-speeches', name: 'SNB · Discursos', type: 'oficial', kind: 'rss', url: 'https://www.snb.ch/public/rss/en/speeches', currency: 'CHF', pollMs: 300_000 },
  { id: 'snb-adhoc', name: 'SNB · Ad hoc', type: 'oficial', kind: 'rss', url: 'https://www.snb.ch/public/rss/en/adhoc', currency: 'CHF', pollMs: 180_000 },
  { id: 'snb-bills', name: 'SNB · Bills', type: 'oficial', kind: 'rss', url: 'https://www.snb.ch/public/rss/en/snbbbills', currency: 'CHF', pollMs: 300_000 },
  {
    id: 'snb-cycle',
    name: 'SNB · Ciclo',
    type: 'oficial',
    kind: 'rss',
    url: 'https://www.snb.ch/public/rss/en/buscycletrends',
    fallbackUrl: 'https://www.snb.ch/public/rss/en/quartbul',
    currency: 'CHF',
    pollMs: 300_000,
    channel_note: 'Señales de ciclo económico y Boletín Trimestral del SNB (buscycletrends / quartbul).',
  },
  { id: 'seco', name: 'SECO', type: 'oficial', kind: 'html', url: 'https://www.seco.admin.ch/en/press-releases', currency: 'CHF', pollMs: 300_000 },
  {
    id: 'bis',
    name: 'BIS',
    type: 'oficial',
    kind: 'rss',
    url: 'https://www.bis.org/doclist/all_pressrels.rss',
    fallbackUrl: 'https://www.bis.org/doclist/bis_fsi_publs.rss',
    pollMs: 300_000,
    channel_note: 'Comunicados y publicaciones oficiales del BIS (all_pressrels.rss / bis_fsi_publs.rss).',
  },
  { id: 'bis-speeches', name: 'BIS · Discursos', type: 'oficial', kind: 'rss', url: 'https://www.bis.org/doclist/cbspeeches.rss', pollMs: 300_000 },
  {
    id: 'us-treasury',
    name: 'US Treasury · Deuda y Subastas',
    type: 'oficial',
    kind: 'rss',
    url: 'https://news.google.com/rss/search?q=site:home.treasury.gov+OR+%22U.S.+Treasury%22+auction+OR+yields+OR+deficit+when:14d&hl=en-US&gl=US&ceid=US:en',
    currency: 'USD',
    pollMs: 300_000,
    channel_note: 'Comunicados fiscales, subastas y deuda del Tesoro de EE. UU. (home.treasury.gov).',
  },
  {
    id: 'us-bls-bea',
    name: 'BLS / BEA · Empleo e Inflación US',
    type: 'oficial',
    kind: 'rss',
    url: 'https://news.google.com/rss/search?q=site:bls.gov+OR+site:bea.gov+OR+%22Bureau+of+Labor+Statistics%22+CPI+OR+payrolls+OR+PCE+when:14d&hl=en-US&gl=US&ceid=US:en',
    currency: 'USD',
    pollMs: 300_000,
    channel_note: 'Publicaciones macroeconómicas de empleo, CPI, PCE y PIB de EE. UU. (bls.gov / bea.gov).',
  },
  {
    id: 'eurostat',
    name: 'Eurostat · Macro Eurozona',
    type: 'oficial',
    kind: 'rss',
    url: 'https://news.google.com/rss/search?q=site:ec.europa.eu/eurostat+OR+Eurostat+inflation+OR+GDP+OR+unemployment+when:14d&hl=en-US&gl=US&ceid=US:en',
    currency: 'EUR',
    pollMs: 300_000,
    channel_note: 'Estadísticas oficiales de inflación, PIB y empleo de la Eurozona (ec.europa.eu/eurostat).',
  },
  {
    id: 'uk-ons-hmt',
    name: 'HM Treasury / ONS · Reino Unido',
    type: 'oficial',
    kind: 'rss',
    url: 'https://news.google.com/rss/search?q=site:ons.gov.uk+OR+%22HM+Treasury%22+OR+%22Office+for+National+Statistics%22+UK+inflation+OR+gilts+OR+GDP+when:14d&hl=en-GB&gl=GB&ceid=GB:en',
    currency: 'GBP',
    pollMs: 300_000,
    channel_note: 'Datos macro y emisiones fiscales de ONS y HM Treasury del Reino Unido.',
  },
  {
    id: 'jp-mof',
    name: 'Japan MoF · Finanzas y Divisas',
    type: 'oficial',
    kind: 'rss',
    url: 'https://news.google.com/rss/search?q=site:mof.go.jp+OR+%22Ministry+of+Finance%22+Japan+yen+OR+JGB+OR+intervention+when:14d&hl=en-US&gl=US&ceid=US:en',
    currency: 'JPY',
    pollMs: 300_000,
    channel_note: 'Seguimiento oficial del Ministerio de Finanzas de Japón (MoF), JGBs y vigilancia cambiaria.',
  },
  {
    id: 'au-abs-treasury',
    name: 'ABS / Australian Treasury',
    type: 'oficial',
    kind: 'rss',
    url: 'https://news.google.com/rss/search?q=site:abs.gov.au+OR+site:treasury.gov.au+Australia+CPI+OR+inflation+OR+employment+when:14d&hl=en-AU&gl=AU&ceid=AU:en',
    currency: 'AUD',
    pollMs: 300_000,
    channel_note: 'Comunicados oficiales de inflación, empleo y cuentas públicas de Australia (abs.gov.au / treasury.gov.au).',
  },
  {
    id: 'nz-press',
    name: 'Prensa NZ · RBNZ',
    type: 'agencia',
    kind: 'rss',
    url: 'https://news.google.com/rss/search?q=RBNZ+OR+%22Reserve+Bank+of+New+Zealand%22+OR+%22Anna+Breman%22+OR+%22official+cash+rate%22+New+Zealand+when:3d&hl=en-NZ&gl=NZ&ceid=NZ:en',
    currency: 'NZD',
    pollMs: 300_000,
    channel_note: 'Consulta Google News (when:3d) sobre el RBNZ, Anna Breman y la official cash rate de Nueva Zelanda.',
  },
  {
    id: 'ch-press',
    name: 'Prensa CH · SNB',
    type: 'agencia',
    kind: 'rss',
    url: 'https://news.google.com/rss/search?q=SNB+OR+%22Swiss+National+Bank%22+OR+Schlegel+OR+Tschudin+OR+%22Swiss+franc%22+when:3d&hl=en-US&gl=CH&ceid=CH:en',
    currency: 'CHF',
    pollMs: 300_000,
    channel_note: 'Consulta Google News (when:3d) sobre el SNB, Schlegel, Tschudin y el franco suizo.',
  },
  {
    id: 'au-press',
    name: 'Prensa AU · RBA',
    type: 'agencia',
    kind: 'rss',
    url: 'https://news.google.com/rss/search?q=RBA+OR+%22Reserve+Bank+of+Australia%22+OR+Bullock+OR+Hauser+OR+%22cash+rate%22+Australia+when:3d&hl=en-AU&gl=AU&ceid=AU:en',
    currency: 'AUD',
    pollMs: 300_000,
    channel_note: 'Consulta Google News (when:3d) sobre el RBA, Bullock, Hauser y la cash rate de Australia.',
  },
  {
    id: 'rnz-business',
    name: 'RNZ · Negocios',
    type: 'agencia',
    kind: 'rss',
    url: 'https://www.rnz.co.nz/rss/business.xml',
    currency: 'NZD',
    pollMs: 180_000,
    channel_note: 'Titulares de negocios de Radio New Zealand (rnz.co.nz/rss/business.xml).',
  },
  {
    id: 'investinglive',
    name: 'InvestingLive',
    type: 'agencia',
    kind: 'telegram',
    url: 'https://t.me/s/InvestingLiveNews',
    pollMs: 60_000,
    channel_note: 'Canal público de Telegram t.me/s/InvestingLiveNews con enlaces a investinglive.com.',
  },
  {
    id: 'ft-economy',
    name: 'FT · Economía global',
    type: 'agencia',
    kind: 'rss',
    url: 'https://www.ft.com/global-economy?format=rss',
    pollMs: 180_000,
    channel_note: 'RSS público de titulares y entradillas; el texto completo en ft.com requiere suscripción.',
  },
  {
    id: 'ft-markets',
    name: 'FT · Mercados',
    type: 'agencia',
    kind: 'rss',
    url: 'https://www.ft.com/markets?format=rss',
    pollMs: 180_000,
    channel_note: 'RSS público de titulares y entradillas; el texto completo en ft.com requiere suscripción.',
  },
  {
    id: 'ft-currencies',
    name: 'FT · Divisas',
    type: 'agencia',
    kind: 'rss',
    url: 'https://www.ft.com/currencies?format=rss',
    pollMs: 180_000,
    channel_note: 'RSS público de titulares y entradillas; el texto completo en ft.com requiere suscripción.',
  },
  {
    id: 'negociostv',
    name: 'Negocios TV',
    type: 'agencia',
    kind: 'telegram',
    url: 'https://t.me/s/negociostv',
    pollMs: 90_000,
    channel_note: 'Canal público de Telegram t.me/s/negociostv.',
  },
  {
    id: 'burbuja-mercados',
    name: 'Brújula de Mercados',
    type: 'agencia',
    kind: 'telegram',
    url: `https://t.me/s/${BURBUJA}`,
    pollMs: 90_000,
    channel_note: `Canal público de Telegram t.me/s/${BURBUJA}.`,
  },
];

export const PRESERVED_SOURCE_IDS = [
  'financialjuice', 'fed', 'ecb', 'boe', 'boj', 'boc', 'rba',
  'investinglive', 'ft-economy', 'ft-markets', 'ft-currencies',
];

/**
 * Temas Polymarket de geopolítica y Washington (v5.1 Parte D).
 * Tabla fija, sin dirección: solo palabras del título y divisas expuestas.
 */
export const POLYMARKET_GEO_THEMES = [
  {
    theme: 'IRAN_ORIENTE_MEDIO',
    keywords: ['iran', 'iranian', 'israel', 'israeli', 'hormuz', 'houthi', 'gaza', 'saudi', 'strike on'],
    currencies: ['USD', 'CHF', 'JPY', 'CAD', 'EUR', 'XAU'],
  },
  {
    theme: 'RUSIA_UCRANIA',
    // «ceasefire» no está: un alto el fuego de otro conflicto no es este tema.
    keywords: ['russia', 'ukraine', 'putin', 'zelensky', 'nato'],
    currencies: ['EUR', 'CHF', 'GBP', 'XAU'],
  },
  {
    theme: 'ARANCELES_COMERCIO',
    keywords: ['tariff', 'trade deal', 'trade war', 'usmca', 'section 232', 'section 301'],
    currencies: ['CAD', 'AUD', 'NZD', 'EUR', 'JPY', 'CHF'],
  },
  {
    theme: 'WASHINGTON',
    keywords: ['shutdown', 'veto', 'executive order', 'debt ceiling', 'impeach', 'supreme court', 'fed chair', 'congress passes', 'signs into law'],
    currencies: ['USD', 'XAU'],
  },
  {
    theme: 'CHINA_TAIWAN',
    keywords: ['china', 'chinese', 'taiwan', 'beijing', 'xi jinping'],
    currencies: ['AUD', 'NZD', 'JPY', 'USD'],
  },
];

/** Umbrales congelados el 10-nov-2026 (PRE-REG). El |Δ24h| de nivel es la Parte E y no se aplica aquí. */
export const POLYMARKET_MIN_VOLUME_USD = 250_000;
export const POLYMARKET_MIN_LIQUIDITY_USD = 25_000;
export const POLYMARKET_MAX_PER_THEME = 5;
export const POLYMARKET_HISTORY_DAYS = 8;
export const POLYMARKET_D24H_MS = 24 * 60 * 60 * 1000;
export const POLYMARKET_D24H_WINDOW_MS = 60 * 60 * 1000;
export const POLYMARKET_CADENCE_MS = 30 * 60 * 1000;
/** Misma espera creciente que el calendario en src/calendar.js. */
export const POLYMARKET_BACKOFF_START_MS = 15 * 60 * 1000;
export const POLYMARKET_BACKOFF_MAX_MS = 6 * 60 * 60 * 1000;

/**
 * Mercados que se descartan aunque el título encaje en un tema.
 * `fed-rates` y `fed-chair` no están: en Gamma también marcan la nominación de Fed Chair (WASHINGTON).
 */
export const POLYMARKET_GEO_EXCLUSIONS = {
  sportsTags: ['sports', 'sport', 'nba', 'nfl', 'mlb', 'nhl', 'soccer', 'football', 'basketball', 'ufc', 'mma', 'esports', 'f1', 'formula-1', 'tennis', 'golf', 'cricket', 'ucl', 'super-bowl', 'premier-league', 'nba-finals', 'nfl-gameday'],
  sportsPhrases: ['super bowl', 'world series', 'champions league', 'premier league', 'nba finals', 'stanley cup'],
  cryptoTags: ['crypto', 'bitcoin', 'ethereum', 'solana', 'dogecoin', 'nft', 'nfts', 'defi'],
  cryptoPhrases: ['bitcoin', 'ethereum', 'dogecoin', 'solana', 'crypto'],
  entertainmentTags: ['entertainment', 'pop-culture', 'popculture', 'movies', 'movie', 'music', 'celebrities', 'celebrity', 'oscars', 'oscar', 'tv', 'video-games'],
  entertainmentPhrases: ['oscar', 'grammy', 'box office', 'netflix'],
  centralBankTags: ['fomc', 'federal-reserve', 'central-bank', 'central-banks', 'interest-rates', 'monetary-policy'],
  centralBankPhrases: ['fed rate', 'rate cut', 'rate hike', 'fomc', 'federal funds', 'interest rate', 'policy rate', 'basis point', 'monetary policy', 'central bank', 'fed decision', 'fedwatch', 'bank of england', 'bank of japan', 'bank of canada', 'reserve bank'],
};

export const CCY_KEYWORDS = {
  USD: /\b(usd|u\.s\.a?|united states|dollar|greenback|fed\b|fomc|powell|treasury|payrolls?|nonfarm|cpi|pce|ism|jackson hole)\b/i,
  EUR: /\b(eur\b|euro\b|eurozone|euro area|ecb|bce|lagarde|germany|bund|france|italy)\b/i,
  GBP: /\b(gbp|sterling|pound|boe|bank of england|bailey|uk\b|britain|gilt)\b/i,
  JPY: /\b(jpy|yen\b|boj|bank of japan|ueda|japan(?!ese knot))\b/i,
  CHF: /\b(chf|franc|snb|swiss|switzerland|seco|bfs|zurich|bern)\b/i,
  CAD: /\b(cad|loonie|boc|bank of canada|canada|macklem|oil sands)\b/i,
  AUD: /\b(aud|aussie|rba|australia|bullock)\b/i,
  NZD: /\b(nzd|kiwi|rbnz|new zealand|ocr|wellington|stats nz)\b/i,
};

export const DATA_DIR = process.env.RADARNEWS_DATA_DIR || '/var/lib/radarnews';
export const HOST = process.env.HOST || '127.0.0.1';
export const PORT = Number(process.env.PORT || 4700);
