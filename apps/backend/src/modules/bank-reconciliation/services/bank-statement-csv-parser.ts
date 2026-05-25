/**
 * Module 15 — parser CSV pour relevés bancaires.
 *
 * Pure function : prend un buffer / string CSV et retourne les lignes
 * normalisées. Aucun accès DB, aucun side-effect → testable trivialement.
 *
 * Format attendu (wave 1) :
 *   date_operation,date_valeur,libelle,reference,debit,credit
 *   2026-03-15,2026-03-16,VIREMENT ACME SARL,VIR123,,1500000.00
 *
 * Conventions :
 *   - Séparateur : virgule par défaut ; détection auto tab + point-virgule.
 *   - Décimales  : `.` ou `,` (les deux acceptés).
 *   - Montants   : `debit`/`credit` séparés OU `amount` signé unique.
 */

export interface ParsedBankLine {
  readonly lineOrder: number;
  readonly operationDate: string;
  readonly valueDate: string | null;
  readonly label: string;
  readonly bankReference: string | null;
  readonly amount: string;
}

export interface ParseBankCsvResult {
  readonly lines: ReadonlyArray<ParsedBankLine>;
  readonly detectedSeparator: ',' | ';' | '\t';
}

export class BankCsvParseError extends Error {
  constructor(
    message: string,
    readonly rowIndex: number,
  ) {
    super(message);
    this.name = 'BankCsvParseError';
  }
}

const DATE_COLS = ['date_operation', 'operation_date', 'date', 'date_op'] as const;
const VALUE_DATE_COLS = ['date_valeur', 'value_date', 'valeur'] as const;
const LABEL_COLS = ['libelle', 'label', 'description', 'libellé'] as const;
const REF_COLS = ['reference', 'référence', 'ref', 'piece'] as const;
const DEBIT_COLS = ['debit', 'débit'] as const;
const CREDIT_COLS = ['credit', 'crédit'] as const;
const AMOUNT_COLS = ['amount', 'montant', 'montant_signe'] as const;

export function parseBankCsv(content: string): ParseBankCsvResult {
  const text = content.replace(/\r\n/g, '\n').replace(/^﻿/, '');
  const rows = text
    .split('\n')
    .map((r) => r.trimEnd())
    .filter((r) => r.length > 0);

  if (rows.length === 0) {
    return { lines: [], detectedSeparator: ',' };
  }

  const separator = detectSeparator(rows[0]);
  const header = splitRow(rows[0], separator).map((c) => c.trim().toLowerCase());

  const colIdx = (candidates: ReadonlyArray<string>): number => {
    for (const c of candidates) {
      const i = header.indexOf(c);
      if (i !== -1) return i;
    }
    return -1;
  };

  const idxOpDate = colIdx(DATE_COLS);
  const idxValueDate = colIdx(VALUE_DATE_COLS);
  const idxLabel = colIdx(LABEL_COLS);
  const idxRef = colIdx(REF_COLS);
  const idxDebit = colIdx(DEBIT_COLS);
  const idxCredit = colIdx(CREDIT_COLS);
  const idxAmount = colIdx(AMOUNT_COLS);

  if (idxOpDate === -1) {
    throw new BankCsvParseError(
      `Missing required column. Expected one of: ${DATE_COLS.join(', ')}`,
      0,
    );
  }
  if (idxLabel === -1) {
    throw new BankCsvParseError(
      `Missing required column. Expected one of: ${LABEL_COLS.join(', ')}`,
      0,
    );
  }
  const hasAmountSplit = idxDebit !== -1 && idxCredit !== -1;
  const hasAmountSingle = idxAmount !== -1;
  if (!hasAmountSplit && !hasAmountSingle) {
    throw new BankCsvParseError(
      `Missing amount column(s). Expected '${AMOUNT_COLS[0]}' OR ('${DEBIT_COLS[0]}' + '${CREDIT_COLS[0]}').`,
      0,
    );
  }

  const lines: ParsedBankLine[] = [];
  for (let i = 1; i < rows.length; i++) {
    const fields = splitRow(rows[i], separator);
    if (fields.every((f) => f.trim().length === 0)) continue;

    const operationDate = normalizeDate(fields[idxOpDate]?.trim() ?? '', i);
    const valueDate =
      idxValueDate !== -1 && fields[idxValueDate]?.trim()
        ? normalizeDate(fields[idxValueDate].trim(), i)
        : null;
    const label = (fields[idxLabel] ?? '').trim();
    if (label.length === 0) {
      throw new BankCsvParseError(`Empty label at row ${i + 1}`, i);
    }
    const bankReference = idxRef !== -1 ? (fields[idxRef] ?? '').trim() || null : null;

    let amount: string;
    if (hasAmountSingle) {
      amount = normalizeAmount(fields[idxAmount]?.trim() ?? '', i);
    } else {
      const debitStr = fields[idxDebit]?.trim() ?? '';
      const creditStr = fields[idxCredit]?.trim() ?? '';
      const debit = debitStr ? Number(normalizeAmount(debitStr, i)) : 0;
      const credit = creditStr ? Number(normalizeAmount(creditStr, i)) : 0;
      if (debit > 0 && credit > 0) {
        throw new BankCsvParseError(
          `Row ${i + 1} has both debit and credit — exactly one is required.`,
          i,
        );
      }
      const signed = credit - debit;
      if (signed === 0) {
        throw new BankCsvParseError(`Row ${i + 1} has zero amount — not allowed.`, i);
      }
      amount = signed.toFixed(2);
    }

    if (Number(amount) === 0) {
      throw new BankCsvParseError(`Row ${i + 1} has zero amount — not allowed.`, i);
    }

    lines.push({
      lineOrder: lines.length + 1,
      operationDate,
      valueDate,
      label,
      bankReference,
      amount,
    });
  }

  return { lines, detectedSeparator: separator };
}

function detectSeparator(headerRow: string): ',' | ';' | '\t' {
  const counts = {
    comma: headerRow.split(',').length - 1,
    semicolon: headerRow.split(';').length - 1,
    tab: headerRow.split('\t').length - 1,
  };
  if (counts.tab >= counts.comma && counts.tab >= counts.semicolon && counts.tab > 0) return '\t';
  if (counts.semicolon > counts.comma) return ';';
  return ',';
}

function splitRow(row: string, separator: ',' | ';' | '\t'): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < row.length; i++) {
    const ch = row[i];
    if (ch === '"') {
      if (inQuotes && row[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === separator && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

function normalizeDate(raw: string, rowIndex: number): string {
  const trimmed = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const dmy = /^(\d{2})[\/\-.](\d{2})[\/\-.](\d{4})$/.exec(trimmed);
  if (dmy) {
    const [, d, m, y] = dmy;
    return `${y}-${m}-${d}`;
  }
  throw new BankCsvParseError(`Invalid date '${raw}' at row ${rowIndex + 1}`, rowIndex);
}

function normalizeAmount(raw: string, rowIndex: number): string {
  const cleaned = raw.replace(/\s/g, '').replace(',', '.');
  if (!/^-?\+?\d+(\.\d+)?$/.test(cleaned.replace('+', ''))) {
    throw new BankCsvParseError(`Invalid amount '${raw}' at row ${rowIndex + 1}`, rowIndex);
  }
  const n = Number(cleaned.replace('+', ''));
  if (!Number.isFinite(n)) {
    throw new BankCsvParseError(`Invalid amount '${raw}' at row ${rowIndex + 1}`, rowIndex);
  }
  return n.toFixed(2);
}
