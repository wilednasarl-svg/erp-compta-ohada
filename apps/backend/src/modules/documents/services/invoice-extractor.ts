/**
 * `invoice-extractor` — comprehensive, deterministic (regex + HTML-table)
 * extractor that turns PaddleOCR-VL Markdown into a fully structured
 * invoice object: supplier + customer headers, references, totals (incl.
 * VAT-by-rate) and the line-item table.
 *
 * Pure, dependency-free, easy to unit-test. Tuned on the Ivorian
 * SYSCOHADA "facture normalisée électronique" (FNE) layout but degrades
 * gracefully: any field it cannot read is simply omitted.
 *
 * The lighter `metadata-extractor.ts` (6 canonical fields) stays the
 * contract used by the OCR pipeline's quick path; this module produces
 * the rich object stored alongside it in `extracted_metadata` (jsonb).
 */

export interface InvoiceParty {
  name?: string;
  ncc?: string;
  taxRegime?: string;
  taxCenter?: string;
  rccm?: string;
  address?: string;
  phone?: string;
  email?: string;
}

export interface InvoiceLine {
  ref?: string;
  designation?: string;
  unitPriceHt?: number;
  quantity?: number;
  unit?: string;
  vatRatePct?: number;
  discountPct?: number;
  amountHt?: number;
}

export interface InvoiceTotals {
  totalHt?: number;
  totalVat?: number;
  totalTtc?: number;
  otherTaxes?: number;
  totalToPay?: number;
}

export interface ExtractedInvoice {
  supplier: InvoiceParty;
  customer: InvoiceParty;
  invoiceNumber?: string;
  erpInvoiceNumber?: string;
  deliveryNote?: string;
  invoiceDate?: string;
  paymentMode?: string;
  sellerName?: string;
  pointOfSale?: string;
  currency?: string;
  totals: InvoiceTotals;
  lines: InvoiceLine[];
}

/** Parse a full invoice from PaddleOCR-VL Markdown. */
export function extractInvoice(markdown: string): ExtractedInvoice {
  const text = typeof markdown === 'string' ? markdown : '';
  const flat = flattenHtml(text);

  const result: ExtractedInvoice = {
    supplier: extractSupplier(text, flat),
    customer: extractCustomer(flat),
    totals: extractTotals(flat),
    lines: extractLines(text),
  };

  assignDefined(result, 'invoiceNumber', firstLabeled(flat, /Facture\s+de\s+vente\s+N[°º\.:]*[^\S\n]*([A-Z0-9][A-Z0-9_\-\/]{3,40})/i));
  assignDefined(result, 'erpInvoiceNumber', firstLabeled(flat, /N[°º]?\s*Facture\s+ERP\s*[:\-]?[^\S\n]*([A-Z0-9][A-Z0-9_\-\/]{2,40})/i));
  assignDefined(result, 'deliveryNote', firstLabeled(flat, /N[°º]?\s*BL\s*[:\-]?[^\S\n]*([A-Z0-9][A-Z0-9_\-\/]{2,40})/i));
  assignDefined(result, 'invoiceDate', parseDate(flat));
  assignDefined(result, 'paymentMode', firstLabeled(flat, /Mode\s+de\s+paiement\s*[:\-]?[^\S\n]*([^\n|]{2,40})/i));
  assignDefined(result, 'sellerName', firstLabeled(flat, /Nom\s+du\s+vendeur\s*[:\-]?[^\S\n]*([^\n|]{2,60})/i));
  assignDefined(result, 'pointOfSale', firstLabeled(flat, /Nom\s+de\s+PDV\s*[:\-]?[^\S\n]*([^\n|]{1,40})/i));
  assignDefined(result, 'currency', detectCurrency(flat));

  // Fall back to the first generic "N°" reference if no FNE number found.
  if (result.invoiceNumber === undefined) {
    const generic = firstWithDigit(flat, /N[°º][^\S\r\n]*([A-Z0-9][A-Z0-9_\-\/]{3,40})/gi);
    assignDefined(result, 'invoiceNumber', generic);
  }

  return result;
}

// ─── Header parties ─────────────────────────────────────────────────────

function extractSupplier(raw: string, flat: string): InvoiceParty {
  const party: InvoiceParty = {};
  // Supplier name = first non-blank, non-label line of the document.
  const firstLine = flat
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 1 && !/^[\d\s\/\-.,|]+$/.test(l) && !/^(NCC|RCCM|Adresse|Mail|N°|Date)/i.test(l));
  assignDefined(party, 'name', firstLine);

  // First NCC occurrence belongs to the supplier header (the customer's
  // NCC appears later, in the client block).
  const nccs = allLabeled(flat, /NCC\s*[:\-]?[^\S\n]*([A-Z0-9]{4,20})/gi);
  if (nccs[0] !== undefined) party.ncc = nccs[0];

  assignDefined(party, 'taxRegime', firstLabeled(flat, /R[ée]gime\s+d['’]?imposition\s*[:\-]?[^\S\n]*([A-Za-z]{2,20})/i));
  assignDefined(party, 'taxCenter', firstLabeled(flat, /Centre\s+des\s+imp[ôo]ts\s*[:\-]?[^\S\n]*([^\n|]{2,80})/i));
  assignDefined(party, 'rccm', firstLabeled(flat, /RCCM\s*[:\-]?[^\S\n]*([A-Z0-9][A-Z0-9_\-\/ ]{2,40})/i));
  assignDefined(party, 'address', firstLabeled(flat, /Adresse\s*[:\-]?[^\S\n]*([^\n|]{4,80})/i));
  assignDefined(party, 'phone', firstLabeled(flat, /N[°º]?\s*T[ée]l\s*[:\-]?[^\S\n]*([+\d][\d\s]{6,20})/i));
  assignDefined(party, 'email', firstLabeled(raw, /([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/));
  return party;
}

function extractCustomer(flat: string): InvoiceParty {
  const party: InvoiceParty = {};
  // The client block follows a "Client" header.
  const clientIdx = flat.search(/\bClient\b/i);
  const scope = clientIdx >= 0 ? flat.slice(clientIdx) : flat;

  assignDefined(party, 'name', firstLabeled(scope, /Nom\s*[:\-]?[^\S\n]*([^\n|]{2,60})/i));
  // Customer NCC = the NCC that appears within the client block.
  const customerNcc = firstLabeled(scope, /NCC\s*[:\-]?[^\S\n]*([A-Z0-9]{4,20})/i);
  assignDefined(party, 'ncc', customerNcc);
  assignDefined(party, 'address', firstLabeled(scope, /Adresse\s*[:\-]?[^\S\n]*([^\n|]{4,80})/i));
  assignDefined(party, 'taxRegime', firstLabeled(scope, /R[ée]gime\s+d['’]?imposition\s*[:\-]?[^\S\n]*([A-Za-z]{2,20})/i));
  return party;
}

// ─── Totals ─────────────────────────────────────────────────────────────

function extractTotals(flat: string): InvoiceTotals {
  const totals: InvoiceTotals = {};
  assignNumber(totals, 'totalHt', maxAmount(flat, /(?:Total\s*HT|Montant\s*HT|Total\s*hors\s*taxes?)/i));
  assignNumber(totals, 'totalVat', maxAmount(flat, /(?:Total\s*TVA|Montant\s*TVA|\bTVA\b)/i));
  assignNumber(totals, 'totalTtc', maxAmount(flat, /(?:Total\s*TTC|Montant\s*TTC)/i));
  assignNumber(totals, 'otherTaxes', firstAmountAfter(flat, /Autres\s+taxes/i));
  assignNumber(totals, 'totalToPay', maxAmount(flat, /(?:Total\s*[àa]\s*payer|Net\s*[àa]\s*payer)/i));
  return totals;
}

// ─── Line items ─────────────────────────────────────────────────────────

/**
 * Parse the items table. Strategy: take the first HTML `<table>`, build a
 * row/cell matrix, locate the header row (contains "Désignation"), map the
 * column positions, then read each subsequent row that is a real item
 * (has a designation + a numeric "Montant HT") and not a totals row.
 */
function extractLines(raw: string): InvoiceLine[] {
  const tables = parseHtmlTables(raw);
  for (const rows of tables) {
    const headerIdx = rows.findIndex((r) => r.some((c) => /D[ée]signation/i.test(c)));
    if (headerIdx < 0) continue;
    const header = rows[headerIdx].map((c) => c.toLowerCase());
    const col = (re: RegExp): number => header.findIndex((c) => re.test(c));
    const idx = {
      ref: col(/r[ée]f/),
      designation: col(/d[ée]signation/),
      pu: col(/p\.?\s*u|prix/),
      qty: col(/qt[ée]/),
      unit: col(/unit[ée]/),
      taxes: col(/taxes/),
      rem: col(/rem/),
      montant: col(/montant/),
    };

    const lines: InvoiceLine[] = [];
    for (let i = headerIdx + 1; i < rows.length; i++) {
      const cells = rows[i];
      // Totals rows use colspan → far fewer <td> than the header. Real
      // item rows have ~one cell per column. (Don't key off a "TVA" cell
      // — line items legitimately carry "TVA (18)" in the Taxes column.)
      const firstNonEmpty = (cells.find((c) => c.trim().length > 0) ?? '').trim();
      if (cells.length < header.length - 1) continue;
      if (/^(TOTAL|AUTRES\s+TAXES|SOUS-TOTAL|NET\b)/i.test(firstNonEmpty)) continue;
      const designation = at(cells, idx.designation);
      const montant = parseNumber(at(cells, idx.montant));
      if ((designation === undefined || designation.length === 0) && montant === null) continue;

      const line: InvoiceLine = {};
      assignDefined(line, 'ref', cleanCell(at(cells, idx.ref)));
      assignDefined(line, 'designation', cleanCell(designation));
      assignNumber(line, 'unitPriceHt', parseNumber(at(cells, idx.pu)));
      assignNumber(line, 'quantity', parseNumber(at(cells, idx.qty)));
      assignDefined(line, 'unit', cleanCell(at(cells, idx.unit)));
      assignNumber(line, 'vatRatePct', parsePercentInside(at(cells, idx.taxes)));
      assignNumber(line, 'discountPct', parseNumber(at(cells, idx.rem)));
      assignNumber(line, 'amountHt', montant);
      if (Object.keys(line).length > 0) lines.push(line);
    }
    if (lines.length > 0) return lines;
  }
  return [];
}

// ─── HTML / text helpers ─────────────────────────────────────────────────

/** Flatten HTML tables/blocks to pipe-delimited rows + newlines. */
function flattenHtml(text: string): string {
  return text
    .replace(/<\/?(?:tr|table|thead|tbody|div|p|br)[^>]*>/gi, '\n')
    .replace(/<\/?td[^>]*>/gi, ' | ')
    .replace(/<[^>]+>/g, ' ');
}

/** Extract `<table>` blocks as row→cell matrices (cells stripped of tags). */
function parseHtmlTables(raw: string): string[][][] {
  const tables: string[][][] = [];
  const tableRe = /<table[^>]*>([\s\S]*?)<\/table>/gi;
  let tm: RegExpExecArray | null;
  while ((tm = tableRe.exec(raw)) !== null) {
    const rows: string[][] = [];
    const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let rm: RegExpExecArray | null;
    while ((rm = rowRe.exec(tm[1])) !== null) {
      const cells: string[] = [];
      const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
      let cm: RegExpExecArray | null;
      while ((cm = cellRe.exec(rm[1])) !== null) {
        cells.push(cm[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
      }
      if (cells.length > 0) rows.push(cells);
    }
    if (rows.length > 0) tables.push(rows);
  }
  return tables;
}

function at(cells: string[], i: number): string | undefined {
  return i >= 0 && i < cells.length ? cells[i] : undefined;
}

function cleanCell(v: string | undefined): string | undefined {
  if (v === undefined) return undefined;
  const t = v.trim();
  return t.length > 0 ? t : undefined;
}

const AMOUNT = '[0-9][0-9\\s\\.,]*[0-9]|[0-9]';
const GAP = '(?:\\s*\\([^)]*\\))?[ \\t:|\\-]*';

/** Largest amount among all matches of `label` + amount (totals are biggest). */
function maxAmount(text: string, label: RegExp): number | null {
  const re = new RegExp(`${label.source}${GAP}(${AMOUNT})`, label.flags.includes('m') ? 'gim' : 'gi');
  let best: number | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const v = parseNumber(m[1]);
    if (v !== null && (best === null || v > best)) best = v;
  }
  return best;
}

function firstAmountAfter(text: string, label: RegExp): number | null {
  const re = new RegExp(`${label.source}${GAP}(${AMOUNT})`, 'i');
  const m = re.exec(text);
  return m ? parseNumber(m[1]) : null;
}

function firstLabeled(text: string, re: RegExp): string | undefined {
  const m = re.exec(text);
  const v = m?.[1]?.trim().replace(/^[:\-\s]+|[:\-\s]+$/g, '');
  // Reject empties and punctuation-only captures (an empty labelled field
  // whose value bled into the separator, e.g. "Nom du vendeur :").
  return v !== undefined && v.length > 0 && /[A-Za-z0-9]/.test(v) ? v : undefined;
}

function allLabeled(text: string, re: RegExp): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const v = m[1]?.trim();
    if (v) out.push(v);
  }
  return out;
}

function firstWithDigit(text: string, re: RegExp): string | undefined {
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const v = m[1]?.trim();
    if (v && /\d/.test(v) && !/^\d{1,3}$/.test(v)) return v;
  }
  return undefined;
}

function parsePercentInside(v: string | undefined): number | null {
  if (v === undefined) return null;
  const m = /\(?\s*([0-9]{1,2}(?:[.,][0-9]+)?)\s*%?\s*\)?/.exec(v);
  return m ? parseNumber(m[1]) : null;
}

function detectCurrency(text: string): string | undefined {
  if (/\b(?:F\s*CFA|FCFA|XOF)\b/i.test(text)) return 'XOF';
  if (/€|\bEUR\b/.test(text)) return 'EUR';
  if (/\$|\bUSD\b/.test(text)) return 'USD';
  return undefined;
}

/** Parse a French/English formatted number to a JS number (or null). */
function parseNumber(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const cleaned0 = raw.replace(/\s+/g, '');
  if (cleaned0.length === 0 || !/[0-9]/.test(cleaned0)) return null;
  let cleaned = cleaned0;
  const hasComma = cleaned.includes(',');
  const hasDot = cleaned.includes('.');
  if (hasComma && hasDot) {
    cleaned = cleaned.lastIndexOf(',') > cleaned.lastIndexOf('.')
      ? cleaned.replace(/\./g, '').replace(',', '.')
      : cleaned.replace(/,/g, '');
  } else if (hasComma) {
    cleaned = cleaned.replace(/\./g, '').replace(',', '.');
  } else if (hasDot) {
    const m = /^(\d+)\.(\d{3})$/.exec(cleaned);
    if (m) cleaned = m[1] + m[2]; // a lone ".ddd" group is a thousands sep
  }
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

const FRENCH_MONTHS: Record<string, string> = {
  janvier: '01', fevrier: '02', février: '02', mars: '03', avril: '04', mai: '05',
  juin: '06', juillet: '07', aout: '08', août: '08', septembre: '09', octobre: '10',
  novembre: '11', decembre: '12', décembre: '12',
};

function parseDate(text: string): string | undefined {
  const numeric = /\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b/.exec(text);
  if (numeric) {
    const d = numeric[1].padStart(2, '0');
    const mo = numeric[2].padStart(2, '0');
    let y = numeric[3];
    if (y.length === 2) y = `20${y}`;
    if (plausible(+y, +mo, +d)) return `${y}-${mo}-${d}`;
  }
  const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(text);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const fr = /\b(\d{1,2})\s+([A-Za-zà-ÿ]+)\s+(\d{4})\b/.exec(text);
  if (fr) {
    const mo = FRENCH_MONTHS[fr[2].toLowerCase()];
    if (mo) {
      const d = fr[1].padStart(2, '0');
      if (plausible(+fr[3], +mo, +d)) return `${fr[3]}-${mo}-${d}`;
    }
  }
  return undefined;
}

function plausible(y: number, m: number, d: number): boolean {
  return y >= 1900 && y <= 2999 && m >= 1 && m <= 12 && d >= 1 && d <= 31;
}

function assignDefined<T, K extends keyof T>(obj: T, key: K, value: T[K] | undefined): void {
  if (value !== undefined) obj[key] = value;
}

function assignNumber<T, K extends keyof T>(obj: T, key: K, value: number | null): void {
  if (value !== null) obj[key] = value as T[K];
}
