import { createHash } from 'node:crypto';
import { CCY_KEYWORDS, CURRENCIES, SOURCES } from './config.js';

const INVERTED = /unemployment|jobless|claims|paro|desempleo/i;
const BREAKING = /\b(breaking|última hora|flash|urgent|alert)\b/i;
const GEO = /\b(war|attack|missile|sanction|invasion|strike|iran|israel|hormuz|taiwan|nato|geopol|tanker|naval mine|drone|civil defense|riyadh|jeddah|saudi|togliatti|oil hits|hostilit)/i;
const CB = /\b(fed|fomc|ecb|bce|boe|boj|snb|rbnz|rba|boc|powell|lagarde|bailey|ueda|ocr|rate decision|monetary policy)\b/i;
const MARKET = /\b(auction|tender|bill|repo|issuance|syndication|bond programme|prefu)\b/i;
const ANALYSIS = /\b(preview|preview:|wrap|recap|what to watch|análisis|outlook)\b/i;
const MACRO = /\b(cpi|pce|ppi|gdp|pmi|payroll|retail|housing|employment|jobless|trade balance|current account|ipc|pib)\b/i;

export const OFFICIAL_NOISE = /museum|banknote|award|prize|subcommittee|recruitment|vacancy|commemorat|exhibition|coin issue|carl menger|visit dunedin|cyber and ai|independent report|tsb to commission|assistant governor|member appointed|appointed as|notice of vesting|more about/i;
export const OFFICIAL_KEEP = /monetary policy|interest rate|inflation|ocr|fomc|financial stability|gdp|cpi|labour|labor|employment|intervention|bills|repo|profit distribution|prefu|bond programme|balance of payments|assessment|outlook|forecast|unemployment|pmi|trade|fiscal|budget|remarks|speech|minutes|beige book|rate decision|press conference|liquidity|reserves|swap lines|ocr/i;

const _canonicalUrlCache = new Map();
const _canonicalPathCache = new Map();
const _urlSpecCache = new Map();

export function canonicalUrl(url = '') {
  const key = String(url || '');
  if (_canonicalUrlCache.has(key)) return _canonicalUrlCache.get(key);
  let res;
  try {
    const u = new URL(key);
    u.hash = '';
    u.protocol = 'https:';
    u.hostname = u.hostname.replace(/^www\./i, '').toLowerCase();
    u.pathname = (u.pathname.replace(/\/+$/, '') || '/');
    u.search = '';
    res = u.href;
  } catch {
    res = key.replace(/^http:\/\//i, 'https://').replace(/\/+$/, '');
  }
  if (_canonicalUrlCache.size > 6000) _canonicalUrlCache.clear();
  _canonicalUrlCache.set(key, res);
  return res;
}

export function canonicalPath(url = '') {
  const key = String(url || '');
  if (_canonicalPathCache.has(key)) return _canonicalPathCache.get(key);
  let res;
  try {
    const u = new URL(canonicalUrl(key));
    const host = u.hostname.toLowerCase();
    if (host === 't.me' || host.endsWith('.t.me')) {
      const parts = u.pathname.split('/').filter(Boolean);
      const ch = parts[0] === 's' ? parts[1] : parts[0];
      res = ch ? `t.me/${ch.toLowerCase()}` : 't.me';
    } else {
      res = `${host}${u.pathname}`.toLowerCase();
    }
  } catch {
    res = key.toLowerCase();
  }
  if (_canonicalPathCache.size > 6000) _canonicalPathCache.clear();
  _canonicalPathCache.set(key, res);
  return res;
}

export function fingerprint(title, url = '') {
  const path = canonicalPath(url);
  if (/investinglive\.com\//.test(path) && path.split('/').filter(Boolean).length >= 3) {
    return createHash('sha1').update(path).digest('hex');
  }
  const t = (title || '').trim().toLowerCase().replace(/\s+/g, ' ');
  return createHash('sha1').update(`${t}|${path}`).digest('hex');
}

export function urlSpecificity(url = '') {
  const key = String(url || '');
  if (_urlSpecCache.has(key)) return _urlSpecCache.get(key);
  let res = 0;
  try {
    res = new URL(canonicalUrl(key)).pathname.split('/').filter(Boolean).length;
  } catch {
    res = 0;
  }
  if (_urlSpecCache.size > 6000) _urlSpecCache.clear();
  _urlSpecCache.set(key, res);
  return res;
}

export function isTelegramPermalink(url = '') {
  return /t\.me\/(?:s\/)?[^/]+\/\d+/i.test(String(url));
}

export function headlineFromUrl(url = '') {
  try {
    const path = new URL(url).pathname.split('/').filter(Boolean).pop() || '';
    let s = decodeURIComponent(path).replace(/\.[a-z0-9]+$/i, '');
    s = s.replace(/-vs-/gi, ' vs ');
    s = s.replace(/(\d+)-(\d+)(?=$|[^0-9])/g, '$1.$2');
    s = s.replace(/[-_]+/g, ' ');
    return s.replace(/\s+/g, ' ').trim();
  } catch {
    return '';
  }
}

export function publishedAtFromUrl(url = '') {
  const m = /(?:20)(\d{2})(\d{2})(\d{2})/.exec(String(url));
  if (!m) return null;
  const iso = `20${m[1]}-${m[2]}-${m[3]}T12:00:00Z`;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

const MONTHS = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
};

export function parseLooseDate(s) {
  const t = String(s || '').replace(/published on/i, '').trim();
  const en = /^(\d{1,2})\s+([A-Za-z]+)\s+(20\d{2})$/.exec(t);
  if (en && MONTHS[en[2].toLowerCase()] != null) {
    return new Date(Date.UTC(Number(en[3]), MONTHS[en[2].toLowerCase()], Number(en[1]), 12, 0, 0)).toISOString();
  }
  const dm = /^(\d{1,2})\.(\d{2})\.(20\d{2})$/.exec(t);
  if (dm) {
    return new Date(Date.UTC(Number(dm[3]), Number(dm[2]) - 1, Number(dm[1]), 12, 0, 0)).toISOString();
  }
  const iso = Date.parse(t);
  return Number.isFinite(iso) ? new Date(iso).toISOString() : null;
}

export function extractPublishedAt(html = '') {
  const time = /<time[^>]*datetime="([^"]+)"/i.exec(html);
  if (time) {
    const t = Date.parse(time[1]);
    if (Number.isFinite(t)) return new Date(t).toISOString();
  }
  const pub = /Published on\s+(\d{1,2}\s+[A-Za-z]+\s+20\d{2})/i.exec(html);
  if (pub) return parseLooseDate(pub[1]);
  const meta = /meta-info__item">\s*([^<]+?)\s*</i.exec(html);
  if (meta) return parseLooseDate(meta[1]);
  return null;
}

/** Prefer the date encoded in the URL when the feed stamps scrape-time as pubDate. */
export function preferPublishedAt(url = '', feedIso = null) {
  const fromUrl = publishedAtFromUrl(url);
  const feed = feedIso ? Date.parse(feedIso) : NaN;
  if (fromUrl && Number.isFinite(feed) && feed - Date.parse(fromUrl) > 12 * 3600_000) return fromUrl;
  if (Number.isFinite(feed)) return new Date(feed).toISOString();
  return fromUrl;
}

const DELAYED_FEED = /this is a delayed news feed[\s\S]*$/i;
const FJ_TAIL = /\s*\|\s*FJ\s*$/i;

export function cleanHeadline(title = '', url = '', source = '') {
  let t = String(title || '').replace(/\s+/g, ' ').trim();
  t = t.replace(DELAYED_FEED, '').trim();
  t = t.replace(FJ_TAIL, '').trim();
  const urlInTitle = t.match(/https?:\/\/[^\s]+/i)?.[0];
  if (urlInTitle) {
    const isMediaShortlink = /(?:youtu\.be|youtube\.com|t\.me|twitter\.com|x\.com|bit\.ly)\//i.test(urlInTitle);
    const fromSlug = isMediaShortlink ? '' : headlineFromUrl(urlInTitle);
    const withoutUrl = t.replace(urlInTitle, '').trim();
    if (withoutUrl.length >= 16) t = withoutUrl; // H8: keep the real message text, not the URL slug
    else if (fromSlug && fromSlug.length >= 16) t = fromSlug;
    else t = withoutUrl;
  }
  const withoutHashtags = t.replace(/(?:\s+#[^\s#]+)+\s*$/g, '').trim();
  if (withoutHashtags.length >= 12) t = withoutHashtags;
  if (/^https?:\/\//i.test(t)) {
    const fromSlug = headlineFromUrl(t);
    if (fromSlug) t = fromSlug;
  }
  if ((!t || t.length < 8) && /^https?:\/\//i.test(url) && /investinglive\.com/i.test(url)) {
    t = headlineFromUrl(url) || t;
  }
  if (/investinglive/i.test(source) && /^https?:\/\//i.test(t)) t = headlineFromUrl(t) || t;
  t = t.replace(/\s+/g, ' ').trim();
  if (t) t = t[0].toUpperCase() + t.slice(1);
  return t.slice(0, 280);
}

export function articleUrlFromText(text = '', fallback = '') {
  const urls = String(text || '').match(/https?:\/\/[^\s<>"]+/gi) || [];
  const article = urls.find((u) => /investinglive\.com\//i.test(u) && !/t\.me\//i.test(u));
  if (article) return article.replace(/[),.;]+$/, '');
  const msg = urls.find((u) => /t\.me\/(?:s\/)?[^/]+\/\d+/i.test(u));
  if (msg) return msg;
  return fallback;
}

export function parseNumber(v) {
  const m = /-?\d+(?:\.\d+)?/.exec(String(v ?? '').replace(/,/g, ''));
  return m ? Number(m[0]) : null;
}

export function parseMacro(text) {
  const t = String(text || '');
  const vsExpected = /(\-?\d[\d.,]*%?)\s+vs\s+(\-?\d[\d.,]*%?)\s+expected/i.exec(t);
  const actual = /ACTUAL[:\s]+(-?\d[\d.,]*%?)/i.exec(t)?.[1]
    || vsExpected?.[1]
    || /(\-?\d[\d.,]*%?)\s+vs\s+/i.exec(t)?.[1]
    || null;
  const forecast = /FORECAST[:\s]+(-?\d[\d.,]*%?)/i.exec(t)?.[1]
    || vsExpected?.[2]
    || /expected\s+(-?\d[\d.,]*%?)/i.exec(t)?.[1]
    || /vs\s+(-?\d[\d.,]*%?)/i.exec(t)?.[1]
    || null;
  const previous = /PREVIOUS[:\s]+(-?\d[\d.,]*%?)/i.exec(t)?.[1]
    || /\(previous\s+(-?\d[\d.,]*%?)\)/i.exec(t)?.[1]
    || null;
  return { actual, forecast, previous };
}

export function surpriseZ(item) {
  const a = parseNumber(item.actual);
  const f = parseNumber(item.forecast);
  if (a == null || f == null) return { z: null, absZ: null };
  const sigma = Math.max(0.15, Math.abs(f) * 0.04 || 0.2);
  let z = (a - f) / sigma;
  if (INVERTED.test(item.title || '')) z = -z;
  return { z: Math.round(z * 10) / 10, absZ: Math.abs(z) };
}

export const HISTORICAL_COMMEMORATION = /\b(memorial|monument|martyrs['’]?|cemetery|museum|commemorat(?:e|ed|es|ion|ing)|wreath|remembrance|anniversary)\b/i;
const ACTIVE_HOSTILITY = /\b(missile|invasion|strike|airstrike|shelling|bomb(?:ing|s|ed)?|hormuz closed|drone|terror(?:ist)?|attack(?:s|ed|ing)?|explosi(?:on|ve)|blast|shoot(?:ing|s)?|gunm[ae]n|killed|casualt(?:y|ies)|wounded|injured|hostage|sabotage|ambush|raid|clash(?:es)?|evacuat(?:e|ed|ion)|lockdown|assault|armed)\b/i;

export function isHistoricalCommemoration(text = '') {
  const s = String(text || '');
  return HISTORICAL_COMMEMORATION.test(s) && !ACTIVE_HOSTILITY.test(s);
}

export function detectCurrencies(text, sourceCurrency = null) {
  const blob = String(text || '');
  const found = CURRENCIES.filter((c) => CCY_KEYWORDS[c].test(blob));
  if (sourceCurrency && !found.includes(sourceCurrency)) found.push(sourceCurrency);
  return [...new Set(found)];
}

const ACTIVE_GEO_EVENT = /\b(explosion|blast|shoot(?:ing|s)?|open fire|gunm[ae]n|terror(?:ist)?|bomb(?:ing|s|ed)?|hostage|casualt(?:y|ies)|airstrike|shelling|assault|ambush)\b/i;

export function categorize(text) {
  const t = String(text || '');
  // H6: a central-bank headline (FOMC, BoC, ...) stays central bank unless it describes active hostilities
  if (CB.test(t) && !ACTIVE_HOSTILITY.test(t) && !ACTIVE_GEO_EVENT.test(t)) return 'banco_central';
  if ((GEO.test(t) || ACTIVE_GEO_EVENT.test(t)) && !isHistoricalCommemoration(t)) return 'geopolitica';
  if (CB.test(t)) return 'banco_central';
  if (MACRO.test(t)) return 'dato_macro';
  if (MARKET.test(t)) return 'mercado';
  if (ANALYSIS.test(t)) return 'analisis';
  return 'otro';
}

export function impactOf(item) {
  const t = `${item.title || ''} ${item.body || ''}`;
  if (item.calendar_impact === 'High' || (BREAKING.test(t) && item.currencies?.length)) return item.category === 'geopolitica' ? 5 : 4;
  if (item.category === 'dato_macro' && item.actual) return 4;
  if (item.category === 'banco_central') return 3;
  if (item.category === 'geopolitica') return 3;
  if (item.source_type === 'oficial') return 2;
  return 1;
}

export function isOfficialNoise(title) {
  const t = String(title || '');
  if (OFFICIAL_KEEP.test(t)) return false;
  return OFFICIAL_NOISE.test(t);
}

export function isRelevant(item) {
  if (isGarbageTitle(item.title)) return false;
  if (item.source_type === 'oficial') {
    if (isOfficialNoise(item.title)) return false;
    return OFFICIAL_KEEP.test(item.title);
  }
  const t = `${item.title || ''} ${item.body || ''}`;
  if (item.id?.startsWith?.('negociostv') || /negocios tv/i.test(item.source || '')) {
    if (!item.currencies?.length && !MACRO.test(t) && !CB.test(t) && !GEO.test(t)) return false;
    if (/\b(psoe|vox|sánchez|abascal|feijóo|españa(?!ola))\b/i.test(t) && !item.currencies?.length) return false;
  }
  return item.currencies?.length > 0 || MACRO.test(t) || BREAKING.test(t) || GEO.test(t) || CB.test(t);
}

export function decodeEntities(s) {
  return String(s || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (m, n) => { const c = Number(n); return c > 0 && c <= 0x10FFFF ? String.fromCodePoint(c) : m; })
    .replace(/&#x([0-9a-f]+);/gi, (m, h) => { const c = parseInt(h, 16); return c > 0 && c <= 0x10FFFF ? String.fromCodePoint(c) : m; })
    .replace(/\s+/g, ' ')
    .trim();
}

function tagText(block, tag) {
  const re = new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([^<]*))</${tag}>`, 'i');
  const m = re.exec(block);
  return decodeEntities((m?.[1] || m?.[2] || '').trim());
}

export function parseRss(xml) {
  const items = [];
  const chunks = String(xml).match(/<item[\s\S]*?<\/item>/gi) || String(xml).match(/<rdf:li[\s\S]*?<\/rdf:li>/gi) || [];
  for (const block of chunks) {
    const title = tagText(block, 'title');
    const url = (tagText(block, 'link')
      || /<link[^>]*href="([^"]+)"/i.exec(block)?.[1]
      || tagText(block, 'guid')
      || '').trim();
    const dateRaw = tagText(block, 'pubDate')
      || tagText(block, 'dc:date')
      || tagText(block, 'updated')
      || /^(\d{4}-\d{2}-\d{2})\b/.exec(title)?.[1]
      || '';
    const body = tagText(block, 'description');
    if (!title) continue;
    const published = Date.parse(dateRaw);
    const feedIso = Number.isFinite(published) ? new Date(published).toISOString() : null;
    const published_at = preferPublishedAt(url, feedIso);
    if (!published_at) continue;
    items.push({ title: title.trim(), url, body, published_at });
  }
  return items;
}

export function parseTelegram(html) {
  const items = [];
  const seen = new Set();
  const msgs = String(html || '').split('tgme_widget_message_wrap');
  for (const block of msgs.slice(1)) {
    const text = decodeEntities(/tgme_widget_message_text[^>]*>([\s\S]*?)<\/div>/i.exec(block)?.[1] || '');
    const when = /datetime="([^"]+)"/i.exec(block)?.[1];
    const hrefs = [...block.matchAll(/href="(https:\/\/t\.me\/[^"]+)"/gi)].map((m) => m[1]);
    const msgUrl = hrefs.find((u) => /t\.me\/(?:s\/)?[^/]+\/\d+/i.test(u)) || '';
    if (!text || !msgUrl) continue;
    const msgIdMatch = /\/(\d+)(?:\?|$)/.exec(msgUrl) || /data-post="[^/]+\/(\d+)"/i.exec(block);
    const telegram_msg_id = msgIdMatch ? Number(msgIdMatch[1]) : null;
    const article = articleUrlFromText(text, msgUrl);
    const rawLine = text.split('\n')[0].slice(0, 400);
    const title = cleanHeadline(rawLine, article, '');
    const key = `${telegram_msg_id || ''}:${title.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const published = Date.parse(when);
    items.push({
      title,
      body: text.slice(rawLine.length).trim(),
      url: article || msgUrl,
      telegram_msg_id,
      published_at: Number.isFinite(published) ? new Date(published).toISOString() : new Date().toISOString(),
    });
  }
  return items;
}

function skipHtmlTitle(title) {
  return !title || title.length < 24 || title.length > 220
    || /^(home|menu|skip|subscribe|contact|rss|linkedin|twitter|facebook|more about)/i.test(title)
    || /notice of vesting/i.test(title);
}

export function parseHtmlList(html, baseUrl) {
  const items = [];
  const seen = new Set();
  const origin = new URL(baseUrl).origin;
  const byTitle = new Map();
  const push = (title, href) => {
    title = decodeEntities(title).replace(/^More about\s*[«"]?/i, '').replace(/[»"]$/, '').trim();
    if (skipHtmlTitle(title) || seen.has(title)) {
      if (href && byTitle.has(title) && byTitle.get(title) === baseUrl) {
        try {
          const url = new URL(href, baseUrl).href;
          if (url.startsWith(origin) && url !== baseUrl) {
            const row = items.find((x) => x.title === title);
            if (row) row.url = url;
            byTitle.set(title, url);
          }
        } catch { /* ignore */ }
      }
      return;
    }
    let url = baseUrl;
    if (href) {
      try { url = new URL(href, baseUrl).href; } catch { return; }
      if (!url.startsWith(origin)) return;
    }
    seen.add(title);
    byTitle.set(title, url);
    items.push({
      title,
      url,
      body: '',
      published_at: preferPublishedAt(url, new Date(Date.now() - 6 * 3600_000).toISOString()),
    });
  };
  const labeled = [
    ...String(html || '').matchAll(/href="([^"]+)"[^>]*aria-label="More about\s*«([^»]+)»/gi),
    ...String(html || '').matchAll(/aria-label="More about\s*«([^»]+)»"[^>]*href="([^"]+)"/gi),
  ];
  for (const m of String(html || '').matchAll(/data-value="([^"]{200,})"/gi)) {
    if (!m[1].includes('PaginatedBlockPages')) continue;
    try {
      const decoded = m[1]
        .replace(/&quot;/g, '"')
        .replace(/&#039;/g, "'")
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>');
      const parsed = JSON.parse(decoded);
      if (Array.isArray(parsed?.PaginatedBlockPages)) {
        for (const p of parsed.PaginatedBlockPages) {
          const title = decodeEntities(p.Title || '');
          const href = p.PageLink || p.Link || '';
          if (!title || !href || seen.has(title)) continue;
          let url = baseUrl;
          try { url = new URL(href, baseUrl).href; } catch { continue; }
          seen.add(title);
          byTitle.set(title, url);
          const rawDate = String(p.PageDate || p.IsPublished || '').trim().replace(' ', 'T');
          const parsedMs = rawDate ? Date.parse(rawDate.endsWith('Z') ? rawDate : `${rawDate}Z`) : NaN;
          const published_at = Number.isFinite(parsedMs)
            ? new Date(parsedMs).toISOString()
            : preferPublishedAt(url, new Date(Date.now() - 6 * 3600_000).toISOString());
          items.push({
            title,
            url,
            body: decodeEntities(p.MetaDescription || p.FeaturedText || ''),
            published_at,
          });
        }
      }
    } catch { /* ignore malformed data-value */ }
  }
  for (const m of labeled) {
    if (m[1].startsWith('http') || m[1].startsWith('/')) push(m[2], m[1]);
    else push(m[1], m[2]);
  }
  const heads = String(html || '').matchAll(/<h[1-4][^>]*>\s*(?:<a[^>]+href="([^"]+)"[^>]*>)?([^<]{20,180})/gi);
  for (const m of heads) push(m[2], m[1]);
  if (items.length < 4) {
    const re = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    let m;
    while ((m = re.exec(html))) {
      push(m[2], m[1]);
      if (items.length >= 200) break;
    }
  }
  const dated = String(html || '').matchAll(/meta-info__item">\s*([^<]+?)\s*<\/span>[\s\S]{0,1600}?<h3[^>]*>([^<]+)<\/h3>/gi);
  for (const m of dated) {
    const iso = parseLooseDate(m[1]);
    const title = decodeEntities(m[2]).replace(/\s+/g, ' ').trim();
    const row = items.find((x) => x.title === title);
    if (row && iso) row.published_at = iso;
  }
  return items;
}

const GEO_HAVEN = /\b(war|missile|invasion|strike|airstrike|shelling|nuclear|hormuz|attack|tanker|naval mine|explosion|blast|shoot(?:ing|s)?|open fire|gunm[ae]n|bomb(?:ing|s|ed)?|terror(?:ist)?|hostage|casualt(?:y|ies)|assault|ambush|drone)\b/i;

function geoCurrencies(text, found) {
  if (found.length) return found;
  if (isHistoricalCommemoration(text) || !GEO_HAVEN.test(text)) return found;
  const out = ['USD', 'JPY', 'CHF'];
  if (/\b(oil|crude|hormuz|tanker|iran)\b/i.test(text)) out.push('CAD');
  return out;
}

export function isGarbageTitle(title) {
  const t = String(title || '').trim();
  if (!t || t.length > 22) return false;
  if (/^[A-Za-z0-9_-]{6,16}(?:\s+[A-Za-z0-9_-]{2,8}){0,2}$/.test(t) && !/[aeiou]{2}/i.test(t)) return true;
  return false;
}

const PERIOD_RE = /\b(q[1-4](?:\s*20\d{2})?|20\d{2}\s*q[1-4]|(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:\s*20\d{2})?|week\s+\d{1,2}|w\d{1,2})\b/i;

function normalizePeriodToken(raw = '') {
  const s = String(raw || '').trim().toUpperCase().replace(/\s+/g, '');
  if (!s) return null;
  const mQ = /^(?:(20\d{2})(Q[1-4])|(Q[1-4])(20\d{2})?)$/.exec(s);
  if (mQ) return mQ[2] ? `${mQ[2]}_${mQ[1]}` : (mQ[4] ? `${mQ[3]}_${mQ[4]}` : mQ[3]);
  const mM = /^(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*(20\d{2})?$/.exec(s);
  if (mM) return mM[2] ? `${mM[1]}_${mM[2]}` : mM[1];
  return s;
}

function detectCountryFromText(text = '', source = '', currencies = []) {
  if (/\b(german|germany|de\b|destatis)\b/i.test(text)) return 'DE';
  if (/\b(french|france)\b/i.test(text)) return 'FR';
  if (/\b(italian|italy)\b/i.test(text)) return 'IT';
  if (/\b(spanish|spain)\b/i.test(text)) return 'ES';
  if (/\b(eurozone|euro area|ez\b|ecb|bce)\b/i.test(text)) return 'EZ';
  if (/\b(uk\b|british|britain|ons\b|boe\b)\b/i.test(text)) return 'UK';
  if (/\b(us\b|u\.s\.|united states|fed\b|fomc|ism\b|nfp)\b/i.test(text)) return 'US';
  if (/\b(canadian|canada|boc\b)\b/i.test(text)) return 'CA';
  if (/\b(japanese|japan|boj\b|tokyo)\b/i.test(text)) return 'JP';
  if (/\b(australian|australia|rba\b)\b/i.test(text)) return 'AU';
  if (/\b(new zealand|nz\b|rbnz)\b/i.test(text)) return 'NZ';
  if (/\b(swiss|switzerland|seco|snb|kof)\b/i.test(text) || /seco|snb/i.test(source || '')) return 'CH';
  if (Array.isArray(currencies) && currencies.length === 1) return currencies[0];
  return null;
}

export function extractReleaseIdentity(item = {}) {
  const titleText = String(item.title || '').trim();
  const calText = String(item.calendar_title || '').trim();
  const country = detectCountryFromText(titleText, item.source, item.currencies)
    || detectCountryFromText(calText, item.source, item.currencies);

  const primaryText = titleText || calText;
  let indicator = 'GENERAL';
  if (/\b(pmi|ism)\b/i.test(primaryText)) indicator = 'PMI';
  else if (/\bretail sales\b/i.test(primaryText)) indicator = 'RETAIL_SALES';
  else if (/\b(cpi|ipc|teuerung|inflation)\b/i.test(primaryText)) indicator = 'CPI';
  else if (/\bpce\b/i.test(primaryText)) indicator = 'PCE';
  else if (/\bppi\b/i.test(primaryText)) indicator = 'PPI';
  else if (/\b(gdp|pib|economic forecast|growth)\b/i.test(primaryText)) indicator = 'GDP';
  else if (/\b(jobless claims|initial claims|continuing claims)\b/i.test(primaryText)) indicator = 'CLAIMS';
  else if (/\b(nonfarm|payrolls?|nfp|employment|unemployment|labour|labor)\b/i.test(primaryText)) indicator = 'LABOUR';
  else if (/\b(trade balance|current account|exports|imports)\b/i.test(primaryText)) indicator = 'TRADE';
  else if (/\bchain store sales\b/i.test(primaryText)) indicator = 'CHAIN_SALES';
  else if (/\bconsumer confidence\b/i.test(primaryText)) indicator = 'CONSUMER_CONFIDENCE';
  else if (/\b(fomc|rate decision|monetary policy|ocr)\b/i.test(primaryText)) indicator = 'MONETARY_POLICY';

  let component = 'HEADLINE';
  if (indicator === 'PMI') {
    if (/\bcomposite\b/i.test(primaryText)) component = 'COMPOSITE';
    else if (/\b(manufacturing|mfg|factory)\b/i.test(primaryText)) component = 'MFG';
    else if (/\b(services|serv)\b/i.test(primaryText)) component = 'SERVICES';
  } else {
    const isCore = /\b(core|ex-fuel|ex auto|excluding|trimmed|median)\b/i.test(primaryText);
    const isYoY = /\b(y\/y|yoy|year-on-year|annual)\b/i.test(primaryText);
    const isMoM = /\b(m\/m|mom|month-on-month|monthly)\b/i.test(primaryText);
    const isQoQ = /\b(q\/q|qoq|quarter-on-quarter)\b/i.test(primaryText);
    if (isCore && isYoY) component = 'CORE_YOY';
    else if (isCore && isMoM) component = 'CORE_MOM';
    else if (isCore) component = 'CORE';
    else if (isYoY) component = 'YOY';
    else if (isMoM) component = 'MOM';
    else if (isQoQ) component = 'QOQ';
    else if (/\bcontinuing\b/i.test(primaryText)) component = 'CONTINUING';
    else if (/\binitial\b/i.test(primaryText)) component = 'INITIAL';
  }

  // Strip comparison tails like "from 54.1 in September" or "vs 51.9 in September" before extracting reference period
  const periodTarget = primaryText.replace(/\b(?:from|vs\.?|versus|compared with)\s+[\d.,]+%?\s+in\s+[a-z]+\b/gi, '');
  let explicitPeriod = normalizePeriodToken(PERIOD_RE.exec(periodTarget)?.[1] || '');
  if (!explicitPeriod && indicator === 'GDP') {
    const yr = /\b(20\d{2})\b/.exec(periodTarget);
    if (yr) explicitPeriod = yr[1];
  }
  const pubDate = String(item.published_at || '').slice(0, 10) || null;
  const period = explicitPeriod || pubDate || 'UNKNOWN';

  return {
    country: country || 'GLOBAL',
    indicator,
    component,
    period,
    explicitPeriod,
  };
}

const SOURCE_CANONICAL_PATHS = new Set(SOURCES.map((s) => canonicalPath(s.url)));
const _listingUrlCache = new Map();

function isListingPageUrl(url = '') {
  const key = String(url || '');
  if (_listingUrlCache.has(key)) return _listingUrlCache.get(key);
  let res = false;
  if (!isTelegramPermalink(key)) {
    const p = canonicalPath(key);
    if (SOURCE_CANONICAL_PATHS.has(p)) {
      res = true;
    } else {
      res = /(?:\/home(?:\.html)?|\/index(?:\.html)?|\/news(?:\.html)?|\/press(?:-releases|rel)?(?:\.html)?|\/releases(?:\.html)?)$/i.test(p) || urlSpecificity(key) <= 1;
    }
  }
  if (_listingUrlCache.size > 6000) _listingUrlCache.clear();
  _listingUrlCache.set(key, res);
  return res;
}

export function isSameReleaseDuplicate(a, b) {
  if (!a || !b) return false;
  const metaA = a.release_meta || (a.release_meta = extractReleaseIdentity(a));
  const metaB = b.release_meta || (b.release_meta = extractReleaseIdentity(b));

  // Never merge publications with different explicit reference periods (e.g., Sep vs Oct, Q2 vs Q3)
  if (metaA.explicitPeriod && metaB.explicitPeriod && metaA.explicitPeriod !== metaB.explicitPeriod) {
    return false;
  }
  // Never merge different countries, indicators, or components
  if (metaA.country !== metaB.country || metaA.indicator !== metaB.indicator || metaA.component !== metaB.component) {
    return false;
  }

  const fpA = (a.fingerprint && a._fpTitle === a.title && a._fpUrl === a.url)
    ? a.fingerprint
    : (a._fpTitle = a.title, a._fpUrl = a.url, a.fingerprint = fingerprint(a.title, a.url));
  const fpB = (b.fingerprint && b._fpTitle === b.title && b._fpUrl === b.url)
    ? b.fingerprint
    : (b._fpTitle = b.title, b._fpUrl = b.url, b.fingerprint = fingerprint(b.title, b.url));
  const titleA = a._normTitle !== undefined ? a._normTitle : (a._normTitle = (a.title || '').trim().toLowerCase().replace(/\s+/g, ' '));
  const titleB = b._normTitle !== undefined ? b._normTitle : (b._normTitle = (b.title || '').trim().toLowerCase().replace(/\s+/g, ' '));
  const hasBothActuals = metaA.country !== 'GLOBAL' && metaA.indicator !== 'GENERAL' && a.actual != null && b.actual != null;

  if (fpA !== fpB && titleA !== titleB && !hasBothActuals) {
    return false;
  }

  const tA = Date.parse(a.published_at);
  const tB = Date.parse(b.published_at);
  const dt = (Number.isFinite(tA) && Number.isFinite(tB)) ? Math.abs(tA - tB) : 0;
  const listingInvolved = isListingPageUrl(a.url) || isListingPageUrl(b.url);

  // If one has an explicit period and the other does not, only allow merging if they are from the same release day (<= 24h) or involve a listing page
  if (metaA.explicitPeriod !== metaB.explicitPeriod && (metaA.explicitPeriod || metaB.explicitPeriod)) {
    if (!listingInvolved && dt > 24 * 3600_000) return false;
  }

  if (fpA === fpB) {
    if (!metaA.explicitPeriod && !metaB.explicitPeriod && dt > 5 * 86_400_000 && !listingInvolved) return false;
    return true;
  }

  const srcA = (a.source || a.source_id || '').trim().toLowerCase();
  const srcB = (b.source || b.source_id || '').trim().toLowerCase();

  // Same source & identical normalized title
  if (titleA && titleA === titleB && srcA === srcB) {
    if (listingInvolved) return true;
    if (metaA.explicitPeriod && metaA.explicitPeriod === metaB.explicitPeriod && dt <= 14 * 86_400_000) return true;
    if (dt <= 3 * 86_400_000) return true;
    return false;
  }

  // Same-day cross-source release duplicate: identical (country, indicator, component) with same actual print within 18h
  const numActualA = parseNumber(a.actual);
  const numActualB = parseNumber(b.actual);
  if (
    metaA.country !== 'GLOBAL' &&
    metaA.indicator !== 'GENERAL' &&
    numActualA != null &&
    numActualB != null &&
    numActualA === numActualB &&
    dt <= 18 * 3600_000
  ) {
    return true;
  }

  // Cross-source verbatim macro print of the exact same release within 24 hours
  if (
    titleA.length >= 25 &&
    titleA === titleB &&
    a.actual != null &&
    b.actual != null &&
    String(a.actual).trim() === String(b.actual).trim() &&
    String(a.forecast ?? '').trim() === String(b.forecast ?? '').trim() &&
    dt <= 24 * 3600_000
  ) {
    return true;
  }

  return false;
}

export function enrichRaw(raw, source) {
  const sourceName = source.name.replace(/\s*\(Telegram\s*·[^)]*\)/i, '').replace(/ ·.*/, '').replace(/ \/ NZDM/, '');
  const tgFallback = isTelegramPermalink(raw.url) ? raw.url : '';
  const article = articleUrlFromText(`${raw.title} ${raw.body || ''}`, tgFallback || (source.kind === 'telegram' ? '' : (raw.url || source.url)));
  const title = cleanHeadline(raw.title, article, sourceName);
  const text = `${title} ${raw.body || ''}`;
  const macro = parseMacro(text);
  let currencies = detectCurrencies(text, source.currency || null);
  const category = categorize(text);
  if (category === 'geopolitica') currencies = geoCurrencies(text, currencies);
  const published_at = preferPublishedAt(article, raw.published_at) || new Date().toISOString();
  const item = {
    title,
    body: raw.body || '',
    source: sourceName,
    source_id: source.id,
    source_type: source.type,
    url: article,
    published_at,
    currencies,
    category,
    actual: macro.actual,
    forecast: macro.forecast,
    previous: macro.previous,
    calendar_title: null,
    fingerprint: fingerprint(title, article),
    telegram_msg_id: raw.telegram_msg_id || null,
  };
  item.release_meta = extractReleaseIdentity(item);
  const z = surpriseZ(item);
  item.z = z.z;
  item.absZ = z.absZ;
  item.impact = impactOf(item);
  return item;
}

export function normalizeStoredNews(row) {
  const title = cleanHeadline(row.title, row.url, row.source);
  const permalink = isTelegramPermalink(row.url) ? row.url : articleUrlFromText(`${row.title} ${row.body || ''} ${row.url || ''}`, row.url);
  const url = permalink;
  const text = `${title} ${row.body || ''}`;
  const macro = parseMacro(text);
  let currencies = Array.isArray(row.currencies) ? row.currencies : [];
  let category = row.category || categorize(text);
  if (isHistoricalCommemoration(text) && category === 'geopolitica') {
    category = categorize(text);
    const srcObj = sourceById(row.source_id);
    currencies = detectCurrencies(text, srcObj?.currency || null);
  }
  if (category === 'geopolitica') currencies = geoCurrencies(text, currencies);
  const actual = row.actual || macro.actual;
  const forecast = row.forecast || macro.forecast;
  const previous = row.previous || macro.previous;
  const published_at = preferPublishedAt(url, row.published_at) || row.published_at;
  const out = {
    ...row,
    title,
    url,
    currencies,
    category,
    actual,
    forecast,
    previous,
    published_at,
  };
  out.release_meta = extractReleaseIdentity(out);
  return out;
}

function mergeNewsRow(prev, r) {
  const metaPrev = prev.release_meta || extractReleaseIdentity(prev);
  const metaCurr = r.release_meta || extractReleaseIdentity(r);
  const prevSpec = urlSpecificity(prev.url);
  const rSpec = urlSpecificity(r.url);
  const keep = rSpec > prevSpec
    ? { ...prev, ...r, url: r.url, title: (prev.title || '').length >= (r.title || '').length ? prev.title : r.title }
    : { ...r, ...prev, url: prev.url };
  if (r.actual && !keep.actual) keep.actual = r.actual;
  if (r.forecast && !keep.forecast) keep.forecast = r.forecast;
  if (r.previous && !keep.previous) keep.previous = r.previous;
  const tPrev = Date.parse(prev.published_at);
  const tCurr = Date.parse(r.published_at);
  if (Number.isFinite(tPrev) && Number.isFinite(tCurr)) {
    keep.published_at = tPrev <= tCurr ? prev.published_at : r.published_at;
  } else if (Number.isFinite(tPrev)) {
    keep.published_at = prev.published_at;
  } else if (Number.isFinite(tCurr)) {
    keep.published_at = r.published_at;
  }
  const mergedMeta = extractReleaseIdentity(keep);
  const explicitPeriod = mergedMeta.explicitPeriod || metaPrev.explicitPeriod || metaCurr.explicitPeriod || null;
  keep.release_meta = {
    ...mergedMeta,
    explicitPeriod,
    period: explicitPeriod || mergedMeta.period,
  };
  return keep;
}

export function dedupeNews(rows) {
  const out = [];
  for (const raw of rows || []) {
    const r = raw.release_meta ? raw : { ...raw, release_meta: extractReleaseIdentity(raw) };
    const idx = out.findIndex((existing) => isSameReleaseDuplicate(existing, r));
    if (idx >= 0) {
      out[idx] = mergeNewsRow(out[idx], r);
    } else {
      out.push(r);
    }
  }
  return out;
}

export function sourceById(id) {
  return SOURCES.find((s) => s.id === id);
}

export { INVERTED };
