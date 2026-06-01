/**
 * Sérialisation CSV pure (sans I/O) du détail des créances ouvertes.
 *
 * Format adapté à Excel francophone : séparateur `;`, fin de ligne CRLF,
 * BOM UTF-8 optionnel pour préserver les accents à l'ouverture. Échappement
 * RFC 4180 : tout champ contenant `;`, `"`, `\n` ou `\r` est entre guillemets,
 * les guillemets internes étant doublés.
 */

export interface ReceivableCsvRow {
  readonly partnerCode: string;
  readonly partnerLabel: string;
  readonly invoiceNumber: string;
  readonly dueDate: string;
  readonly amount: string;
  readonly overdueDays: string;
  readonly bucket: string;
}

const HEADERS: ReadonlyArray<{ key: keyof ReceivableCsvRow; label: string }> = [
  { key: 'partnerCode', label: 'Compte tiers' },
  { key: 'partnerLabel', label: 'Tiers' },
  { key: 'invoiceNumber', label: 'Pièce / Facture' },
  { key: 'dueDate', label: 'Échéance' },
  { key: 'amount', label: 'Montant' },
  { key: 'overdueDays', label: 'Jours de retard' },
  { key: 'bucket', label: 'Tranche' },
];

const SEP = ';';
const EOL = '\r\n';

/** Échappe un champ CSV selon RFC 4180 (séparateur `;`). */
export function escapeCsvField(value: string): string {
  if (/[";\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Construit le contenu CSV du détail des créances. `withBom` ajoute le BOM
 * UTF-8 (recommandé pour Excel). La première ligne est l'en-tête.
 */
export function buildReceivablesCsv(
  rows: ReadonlyArray<ReceivableCsvRow>,
  options: { readonly withBom?: boolean } = {},
): string {
  const headerLine = HEADERS.map((h) => escapeCsvField(h.label)).join(SEP);
  const dataLines = rows.map((row) =>
    HEADERS.map((h) => escapeCsvField(row[h.key] ?? '')).join(SEP),
  );
  const body = [headerLine, ...dataLines].join(EOL) + EOL;
  return options.withBom ? `﻿${body}` : body;
}
