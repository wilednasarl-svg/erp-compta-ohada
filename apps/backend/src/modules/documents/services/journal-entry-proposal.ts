/**
 * `journal-entry-proposal` — turns an `ExtractedInvoice` into a proposed
 * SYSCOHADA journal entry (purchase / achat from the buyer's side).
 *
 * Imputation (confirmed by the handwritten coding on the sample FNE):
 *   - Débit  charge/immo (60x/61x/2x)   = Total HT
 *   - Débit  4452 (TVA déductible)       = Total TVA
 *   - Crédit 401 (fournisseur)           = Total TTC
 *
 * Pure function — produces the `CreateEntryDto` shape the journals module
 * accepts, plus a `balanced` flag and `warnings` so the UI can surface
 * what the user must confirm (notably the charge account, which depends
 * on the nature of the goods and cannot be inferred reliably).
 */

import type { ExtractedInvoice } from './invoice-extractor';

export interface ProposedEntryLine {
  accountCode: string;
  debit: number;
  credit: number;
  description?: string | null;
}

export interface ProposedEntry {
  journalCode: string;
  entryDate: string | null;
  description: string;
  reference: string | null;
  lines: ProposedEntryLine[];
  balanced: boolean;
  warnings: string[];
}

export interface ProposalOptions {
  /** Purchases journal code. Default "AC". */
  journalCode?: string;
  /** Charge/asset account for the HT amount. Default "601000" (achats). */
  chargeAccount?: string;
  /** Deductible VAT account. Default "445200" (TVA récupérable). */
  vatAccount?: string;
  /** Supplier account. Default "401000". */
  supplierAccount?: string;
  /**
   * Date d'écriture (ISO `YYYY-MM-DD`) saisie/corrigée par l'utilisateur —
   * prioritaire sur la date OCR (souvent mal lue sur un scan/manuscrit).
   */
  entryDate?: string;
  /**
   * Montants saisis/corrigés par l'utilisateur — prioritaires sur l'OCR.
   * Permet une écriture équilibrée même quand l'image est illisible.
   */
  amounts?: {
    totalHt?: number;
    totalVat?: number;
    totalTtc?: number;
  };
}

const DEFAULTS = {
  journalCode: 'AC',
  chargeAccount: '601000',
  vatAccount: '445200',
  supplierAccount: '401000',
} as const;

const CENTS = 100;
const round2 = (n: number): number => Math.round(n * CENTS) / CENTS;

/** Build a purchase-entry proposal from an extracted invoice. */
export function buildPurchaseEntryProposal(
  invoice: ExtractedInvoice,
  options: ProposalOptions = {},
): ProposedEntry {
  const opts = { ...DEFAULTS, ...stripUndefined(options) };
  const warnings: string[] = [];
  const t = invoice.totals;

  // Les montants saisis par l'utilisateur (options.amounts) priment sur l'OCR
  // — `??` ne bascule que sur undefined, donc un 0 explicite (ex. TVA nulle
  // sur un loyer) est respecté.
  const ov = options.amounts;
  // Resolve the three amounts, filling a single missing one from the
  // accounting identity TTC = HT + TVA when exactly one is absent.
  let { totalHt, totalVat, totalTtc } = resolveAmounts(
    ov?.totalHt ?? t.totalHt,
    ov?.totalVat ?? t.totalVat,
    ov?.totalTtc ?? t.totalTtc,
    warnings,
  );

  const reference = invoice.invoiceNumber ?? invoice.erpInvoiceNumber ?? null;
  const supplierName = invoice.supplier.name ?? 'Fournisseur';
  const description = `Achat ${supplierName}${reference ? ` — ${reference}` : ''}`.slice(0, 500);

  const lineLabel = invoice.lines[0]?.designation ?? supplierName;
  const lines: ProposedEntryLine[] = [];

  if (totalHt !== null && totalHt > 0) {
    lines.push({ accountCode: opts.chargeAccount, debit: round2(totalHt), credit: 0, description: lineLabel });
  } else {
    warnings.push('Total HT introuvable — ligne de charge à compléter manuellement.');
  }

  if (totalVat !== null && totalVat > 0) {
    lines.push({ accountCode: opts.vatAccount, debit: round2(totalVat), credit: 0, description: 'TVA déductible' });
  }

  if (totalTtc !== null && totalTtc > 0) {
    lines.push({ accountCode: opts.supplierAccount, debit: 0, credit: round2(totalTtc), description: supplierName });
  } else {
    warnings.push('Total TTC introuvable — ligne fournisseur à compléter manuellement.');
  }

  warnings.push(
    `Compte de charge ${opts.chargeAccount} proposé par défaut — à confirmer selon la nature de l'achat.`,
  );

  const debit = round2(lines.reduce((s, l) => s + l.debit, 0));
  const credit = round2(lines.reduce((s, l) => s + l.credit, 0));
  const balanced = lines.length >= 2 && debit === credit && debit > 0;
  if (!balanced) {
    warnings.push(`Écriture non équilibrée (débit ${debit} ≠ crédit ${credit}) — vérifier les montants.`);
  }

  return {
    journalCode: opts.journalCode,
    entryDate: options.entryDate ?? invoice.invoiceDate ?? null,
    description,
    reference,
    lines,
    balanced,
    warnings,
  };
}

function resolveAmounts(
  ht: number | undefined,
  vat: number | undefined,
  ttc: number | undefined,
  warnings: string[],
): { totalHt: number | null; totalVat: number | null; totalTtc: number | null } {
  let h = ht ?? null;
  let v = vat ?? null;
  let c = ttc ?? null;
  if (h !== null && v !== null && c === null) {
    c = round2(h + v);
    warnings.push('Total TTC déduit de HT + TVA.');
  } else if (h !== null && c !== null && v === null) {
    v = round2(c - h);
  } else if (v !== null && c !== null && h === null) {
    h = round2(c - v);
  }
  return { totalHt: h, totalVat: v, totalTtc: c };
}

function stripUndefined<T extends object>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const k of Object.keys(obj) as (keyof T)[]) {
    if (obj[k] !== undefined) out[k] = obj[k];
  }
  return out;
}
