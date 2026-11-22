/** Official SNB Bills results (t330u): the RSS channel is valid but empty;
 *  current issuances are published in the "Issued SNB Bills" PDF. */

export const SNB_BILLS_PAGE_URL = 'https://www.snb.ch/en/publications/financial-markets/snb_bills_res';
export const SNB_BILLS_RESULTS_PDF_URL =
  'https://www.snb.ch/public/asset/en/www-snb-ch/publications/financial-markets/snb_bills_res/publications0_en/snb_bills_res.n.pdf';

const ROW_RE =
  /(\d{2}\.\d{2}\.\d{4})\s+(CH\d{10,12})\s+(\S+)\s+([NA])\s+(\d{1,4})\s+(\d{2}\.\d{2}\.\d{4})\s+(\d{2}\.\d{2}\.\d{4})/;

function dmyToIso(dmy) {
  const [dd, mm, yyyy] = dmy.split('.');
  return `${yyyy}-${mm}-${dd}`;
}

function rowFromMatch(m, pageUrl) {
  const [, auction, isin, _denom, kind, term, payment, redemption] = m;
  const iso = dmyToIso(auction);
  const kindLabel = kind === 'A' ? 'Increase' : 'Issuance';
  return {
    key: `${iso}|${isin}`,
    item: {
      title: `${iso} - Issued SNB Bills (${isin}, ${kindLabel}, ${term}d)`,
      url: pageUrl,
      published_at: `${iso}T17:00:00.000Z`,
      body: `Auction ${iso} · ISIN ${isin} · ${kindLabel} · ${term} days · payment ${dmyToIso(payment)} · redemption ${dmyToIso(redemption)}`,
    },
  };
}

export function parseIssuedSnbBillsText(text, pageUrl = SNB_BILLS_PAGE_URL) {
  const seen = new Set();
  const rows = [];
  const push = (m) => {
    const { key, item } = rowFromMatch(m, pageUrl);
    if (seen.has(key)) return;
    seen.add(key);
    rows.push(item);
  };
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = line.match(ROW_RE);
    if (m) push(m);
  }
  if (rows.length === 0) {
    const globalRe = new RegExp(ROW_RE.source, 'g');
    let m;
    while ((m = globalRe.exec(String(text || '')))) push(m);
  }
  return rows;
}

function toU8(buf) {
  if (!buf) return new Uint8Array();
  if (buf instanceof Uint8Array && buf.constructor === Uint8Array) return buf;
  return Uint8Array.from(buf);
}

function looksLikePdf(buf) {
  if (!buf) return false;
  const u8 = toU8(buf);
  return u8.length >= 5 && u8[0] === 0x25 && u8[1] === 0x50 && u8[2] === 0x44 && u8[3] === 0x46; // %PDF
}

async function pdfToText(buf) {
  const data = toU8(buf);
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await getDocument({ data, disableWorker: true, isEvalSupported: false }).promise;
  const parts = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const lines = [];
    let curY = null;
    let cur = [];
    for (const it of content.items) {
      const y = it.transform ? it.transform[5] : 0;
      const str = it.str || '';
      if (curY != null && Math.abs(y - curY) > 2) {
        lines.push(cur.join(' '));
        cur = [];
      }
      curY = y;
      cur.push(str);
    }
    if (cur.length) lines.push(cur.join(' '));
    parts.push(lines.join('\n'));
  }
  return parts.join('\n');
}

export async function parseIssuedSnbBillsPdf(buf, pageUrl = SNB_BILLS_PAGE_URL) {
  if (!looksLikePdf(buf)) {
    const text = typeof buf === 'string' ? buf : Buffer.from(buf || '').toString('utf8');
    return parseIssuedSnbBillsText(text, pageUrl);
  }
  const text = await pdfToText(buf);
  return parseIssuedSnbBillsText(text, pageUrl);
}

export function isSnbBillsFallback(source) {
  return source?.id === 'snb-bills' || source?.fallbackKind === 'snb_bills_results';
}
