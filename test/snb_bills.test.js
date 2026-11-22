import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SOURCES } from '../src/config.js';
import {
  parseIssuedSnbBillsText,
  parseIssuedSnbBillsPdf,
  SNB_BILLS_RESULTS_PDF_URL,
  SNB_BILLS_PAGE_URL,
} from '../src/snbBills.js';

const excerpt = readFileSync(new URL('./fixtures/snb_bills_res_excerpt.txt', import.meta.url), 'utf8');

test('el PDF oficial de Issued SNB Bills se parsea a titulares con fecha, ISIN y plazo', () => {
  const rows = parseIssuedSnbBillsText(excerpt);
  assert.ok(rows.length >= 4, `esperaba ≥4 filas, obtuve ${rows.length}`);
  assert.equal(rows[0].title, '2026-11-19 - Issued SNB Bills (CH1478193274, Issuance, 28d)');
  assert.equal(rows[0].url, SNB_BILLS_PAGE_URL);
  assert.equal(rows[0].published_at, '2026-11-19T17:00:00.000Z');
  assert.match(rows[0].body, /redemption 2026-12-21/);
  assert.equal(rows[1].title, '2026-11-19 - Issued SNB Bills (CH1478193282, Issuance, 168d)');
  const isins = new Set(rows.map((r) => r.title));
  assert.equal(isins.size, rows.length);
});

test('un canal RSS vacío no es el único camino: el texto oficial sin <item> sigue dando titulares', () => {
  const rssEmpty = `<?xml version="1.0"?><rss version="2.0"><channel><title>SNB Bills</title></channel></rss>`;
  assert.equal(parseIssuedSnbBillsText(rssEmpty).length, 0);
  assert.ok(parseIssuedSnbBillsText(excerpt).length > 0);
});

test('snb-bills apunta al PDF oficial de resultados como fallback', () => {
  const src = SOURCES.find((s) => s.id === 'snb-bills');
  assert.ok(src, 'falta snb-bills');
  assert.equal(src.url, 'https://www.snb.ch/public/rss/en/snbbbills');
  assert.equal(src.fallbackUrl, SNB_BILLS_RESULTS_PDF_URL);
  assert.equal(src.fallbackKind, 'snb_bills_results');
});

test('un buffer que no es PDF se lee como texto', async () => {
  const rows = await parseIssuedSnbBillsPdf(Buffer.from(excerpt, 'utf8'));
  assert.equal(rows[0].published_at, '2026-11-19T17:00:00.000Z');
});

test('un PDF mínimo (Helvética) extrae la subasta', async () => {
  const buf = readFileSync(new URL('./fixtures/snb_bills_min.pdf', import.meta.url));
  const rows = await parseIssuedSnbBillsPdf(buf);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, '2026-11-19 - Issued SNB Bills (CH1478193274, Issuance, 28d)');
});
