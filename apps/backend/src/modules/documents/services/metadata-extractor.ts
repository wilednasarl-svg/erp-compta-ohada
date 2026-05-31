/**
 * `metadata-extractor` — pure, regex-based extractor for invoice
 * metadata from OCR text. Wave 2 keeps the implementation deliberately
 * simple:
 *
 *   - No external dependencies (no NLP, no LLM).
 *   - Pure function: takes a string, returns a partial structured
 *     object. Easy to unit-test with fixed sample texts.
 *
 * Wave 3 may swap this for an LLM-backed extractor; the
 * `ExtractedInvoiceMetadata` shape is the contract both ends agree on,
 * so the swap is local.
 */

export interface ExtractedInvoiceMetadata {
  /** ISO-8601 date string (YYYY-MM-DD) parsed from the invoice. */
  invoiceDate: string;
  /** Total HT (pre-tax) amount in major currency units. */
  totalAmountHt: number;
  /** Total TTC amount in major currency units (e.g. 12345.67). */
  totalAmountTtc: number;
  /** VAT (TVA) amount in major currency units. */
  tvaAmount: number;
  /** Supplier / partner name as it appears on the doc header. */
  partnerName: string;
  /** Invoice number / reference. */
  invoiceNumber: string;
}

/**
 * Extract invoice metadata from raw OCR text. Returns a partial object
 * — fields that could not be parsed are omitted (not present rather
 * than null) so consumers can use `Object.keys(metadata).length > 0`
 * to decide whether anything useful was extracted.
 */
export function extractInvoiceMetadata(text: string): Partial<ExtractedInvoiceMetadata> {
  if (typeof text !== 'string' || text.trim().length === 0) {
    return {};
  }

  const out: Partial<ExtractedInvoiceMetadata> = {};

  // PaddleOCR-VL renders tables as HTML (`<table><td>…`). Flatten HTML
  // into pipe-delimited rows + newlines so the same regexes that handle
  // Tesseract flat text and Markdown tables also handle the VLM output.
  const cleaned = normalizeOcrText(text);

  const invoiceDate = parseInvoiceDate(cleaned);
  if (invoiceDate !== null) out.invoiceDate = invoiceDate;

  const totalHt = parseAmount(cleaned, /(?:Total\s*HT|Montant\s*HT|Base\s*HT|Total\s*hors\s*taxes?)/i);
  if (totalHt !== null) out.totalAmountHt = totalHt;

  const totalTtc = parseAmount(cleaned, /(?:Total\s*TTC|Montant\s*TTC|Net\s*à\s*payer)/i);
  if (totalTtc !== null) out.totalAmountTtc = totalTtc;

  const tva = parseAmount(cleaned, /(?:Total\s*TVA|TVA(?:\s*\([^)]*\))?|Montant\s*TVA)/i);
  if (tva !== null) out.tvaAmount = tva;

  const partnerName = parsePartnerName(cleaned);
  if (partnerName !== null) out.partnerName = partnerName;

  const invoiceNumber = parseInvoiceNumber(cleaned);
  if (invoiceNumber !== null) out.invoiceNumber = invoiceNumber;

  return out;
}

/**
 * Flatten an OCR document into plain text the field parsers can read.
 * PaddleOCR-VL emits HTML tables and `<div><img …></div>` blocks; we
 * convert table/row boundaries to newlines, cell boundaries to ` | `,
 * and strip every other tag (so attribute URLs never leak digits).
 * Plain text / Markdown input is unaffected (no tags → no-op).
 */
function normalizeOcrText(text: string): string {
  return text
    .replace(/<\/?(?:tr|table|thead|tbody|div|p|br)[^>]*>/gi, '\n')
    .replace(/<\/?td[^>]*>/gi, ' | ')
    .replace(/<[^>]+>/g, ' ');
}

// ─── Helpers ──────────────────────────────────────────────────────────

/**
 * Common French / English invoice date formats:
 *   - DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY
 *   - YYYY-MM-DD (ISO)
 *   - "le 24 mai 2026"
 *
 * Returns ISO `YYYY-MM-DD` or null.
 */
function parseInvoiceDate(text: string): string | null {
  // Prefer a date adjacent to a "Date" / "Facture du" label when present.
  const labeled =
    text.match(
      /(?:Date(?:\s*(?:de\s*)?(?:facture|d['’]émission))?|Facture\s+du|Le)\s*[:\-]?\s*(\d{1,2}[\/\-.](?:\d{1,2}|[A-Za-zéûà]+)[\/\-.]\d{2,4})/i,
    ) ??
    text.match(
      /(?:Date(?:\s*(?:de\s*)?(?:facture|d['’]émission))?|Facture\s+du|Le)\s*[:\-]?\s*(\d{4}-\d{2}-\d{2})/i,
    );
  const candidate = labeled?.[1] ?? findFirstStandaloneDate(text);
  if (candidate === undefined || candidate === null) return null;

  return normalizeDate(candidate);
}

function findFirstStandaloneDate(text: string): string | null {
  const isoMatch = text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (isoMatch !== null) return isoMatch[1];
  const numericMatch = text.match(/\b(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})\b/);
  if (numericMatch !== null) return numericMatch[1];
  return null;
}

const FRENCH_MONTHS: Record<string, string> = {
  janvier: '01',
  janv: '01',
  fevrier: '02',
  février: '02',
  fevr: '02',
  mars: '03',
  avril: '04',
  avr: '04',
  mai: '05',
  juin: '06',
  juillet: '07',
  juil: '07',
  aout: '08',
  août: '08',
  septembre: '09',
  sept: '09',
  octobre: '10',
  oct: '10',
  novembre: '11',
  nov: '11',
  decembre: '12',
  décembre: '12',
  dec: '12',
};

function normalizeDate(raw: string): string | null {
  // Already ISO?
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (isoMatch !== null) {
    return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  }

  // DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY (numeric).
  const numeric = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/.exec(raw);
  if (numeric !== null) {
    const day = numeric[1].padStart(2, '0');
    const month = numeric[2].padStart(2, '0');
    let year = numeric[3];
    if (year.length === 2) {
      // 2-digit year — assume 2000s.
      year = `20${year}`;
    }
    if (!isPlausibleDate(Number(year), Number(month), Number(day))) return null;
    return `${year}-${month}-${day}`;
  }

  // DD month YYYY (mixed: "24 mai 2026" — month name + spaces, not the
  // delimited form). Handled separately because the regex above only
  // accepts `[\/\-.]` separators.
  const french = /^(\d{1,2})[\s\-.]+([A-Za-zà-ÿ]+)[\s\-.]+(\d{2,4})$/.exec(raw);
  if (french !== null) {
    const day = french[1].padStart(2, '0');
    const monthKey = french[2].toLowerCase();
    const month = FRENCH_MONTHS[monthKey];
    if (month === undefined) return null;
    let year = french[3];
    if (year.length === 2) year = `20${year}`;
    if (!isPlausibleDate(Number(year), Number(month), Number(day))) return null;
    return `${year}-${month}-${day}`;
  }

  return null;
}

function isPlausibleDate(year: number, month: number, day: number): boolean {
  if (year < 1900 || year > 2999) return false;
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  return true;
}

/**
 * Parse an amount adjacent to a labeled key (e.g. "Total TTC: 1 234,56").
 *
 * Accepts French (`1 234,56` / `1.234,56`) and English (`1,234.56`)
 * thousand-separator conventions. Returns a `number` or null.
 */
function parseAmount(text: string, labelPattern: RegExp): number | null {
  // Build a flexible regex: label, optional colon / dash / spaces, then
  // the amount (digits + . , spaces) and optionally a currency suffix.
  const labelSource = labelPattern.source;
  // Gap between the label and the amount. Tolerant of the shapes
  // PaddleOCR-VL emits as Markdown tables / labelled rows:
  //   - an optional parenthetical rate right after the label
  //     ("Total TVA (18%)"), skipped so it is not mistaken for the value,
  //   - then any run of horizontal separators (spaces, tabs, `:`, `-`,
  //     and the `|` markdown-table cell delimiter). No newline, so the
  //     amount must sit on the same line as its label.
  const gap = '(?:\\s*\\([^)]*\\))?[ \\t:|\\-]*';
  const composite = new RegExp(
    `${labelSource}${gap}([0-9][0-9\\s\\.,]*[0-9])(?:\\s*(?:F\\s*CFA|FCFA|XOF|EUR|€|\\$|USD))?`,
    'gi',
  );
  // A label can appear several times (line-item rate "TVA (18)", the
  // totals row "TVA", a summary row). The figure we want is the total,
  // which is the LARGEST amount among the label's matches — so scan all
  // occurrences and keep the max rather than the first.
  let best: number | null = null;
  let match: RegExpExecArray | null;
  while ((match = composite.exec(text)) !== null) {
    const value = parseNumericString(match[1].replace(/\s+/g, ''));
    if (value !== null && (best === null || value > best)) {
      best = value;
    }
  }
  return best;
}

function parseNumericString(raw: string): number | null {
  if (raw.length === 0) return null;
  let cleaned = raw;
  const hasComma = cleaned.includes(',');
  const hasDot = cleaned.includes('.');
  if (hasComma && hasDot) {
    // Heuristic: the LAST occurrence of `.` or `,` is the decimal sep.
    const lastComma = cleaned.lastIndexOf(',');
    const lastDot = cleaned.lastIndexOf('.');
    if (lastComma > lastDot) {
      // French: `1.234,56` → drop dots, replace comma.
      cleaned = cleaned.replace(/\./g, '').replace(',', '.');
    } else {
      // English: `1,234.56` → drop commas.
      cleaned = cleaned.replace(/,/g, '');
    }
  } else if (hasComma) {
    // Comma-only — French decimal convention.
    cleaned = cleaned.replace(/\./g, '').replace(',', '.');
  } else if (hasDot) {
    // Dot-only — ambiguous (could be thousand sep). If exactly one dot
    // and exactly 3 digits after, treat as thousand sep; otherwise
    // decimal sep.
    const dotMatch = /^(\d+)\.(\d+)$/.exec(cleaned);
    if (dotMatch !== null && dotMatch[2].length === 3 && dotMatch[1].length <= 3) {
      cleaned = dotMatch[1] + dotMatch[2];
    }
    // else leave as-is (decimal sep).
  }
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  return value;
}

/**
 * Parse the supplier / partner name. Prefer an explicit "De :" /
 * "From :" label; fall back to the first non-blank line of the doc.
 */
function parsePartnerName(text: string): string | null {
  const labeled = text.match(/(?:^|\n)\s*(?:De|From|Fournisseur|Vendor)\s*[:\-]\s*(.+)/i);
  if (labeled !== null) {
    const candidate = labeled[1].split(/\r?\n/)[0].trim();
    if (candidate.length > 0 && candidate.length <= 200) {
      return candidate;
    }
  }
  // Fallback: first non-blank line whose length is plausible.
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    // Skip lines that are obviously not a name (e.g. all digits, all
    // punctuation, or a date).
    if (/^[\d\s\/\-.,]+$/.test(trimmed)) continue;
    if (trimmed.length > 200) continue;
    return trimmed;
  }
  return null;
}

/**
 * Parse the invoice number from common patterns:
 *   "Facture N° FAC-2026-001", "Invoice # INV-12345", "N° 12345"
 */
function parseInvoiceNumber(text: string): string | null {
  // Require an explicit separator (N°, #, :) between the label and
  // the captured value so a plain sentence like "no invoice fields"
  // does not falsely match "fields" as the number.
  const patterns = [
    /(?:Facture|Invoice)\s*N[°º\.][^\S\r\n]*([A-Z0-9][A-Z0-9_\-\/]{2,40})/gi,
    /(?:Facture|Invoice)\s*#[^\S\r\n]*([A-Z0-9][A-Z0-9_\-\/]{2,40})/gi,
    /(?:Facture|Invoice)\s*(?:No|N°|Numero|Numéro)\s*[:\-]?\s*([A-Z0-9][A-Z0-9_\-\/]{2,40})/gi,
    /N[°º][^\S\r\n]*([A-Z0-9][A-Z0-9_\-\/]{2,40})/gi,
    /(?:Ref(?:erence|érence)?)\s*[:\-]\s*([A-Z0-9][A-Z0-9_\-\/]{2,40})/gi,
  ];
  // Scan patterns in priority order; within a pattern, scan all matches.
  // A real invoice number always contains a digit — that single rule
  // rejects false positives where a label keyword overlaps a word
  // (e.g. "No" inside "NORMALISÉE", or "N°Facture" capturing "Facture").
  for (const re of patterns) {
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
      const candidate = match[1].trim();
      if (!/\d/.test(candidate)) continue; // must contain a digit
      if (/^\d{1,3}$/.test(candidate)) continue; // too short — likely a date fragment
      return candidate;
    }
  }
  return null;
}
