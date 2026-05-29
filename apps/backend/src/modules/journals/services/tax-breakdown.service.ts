import { Injectable } from '@nestjs/common';

import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import { JournalEntryLineRepository } from '../repositories/journal-entry-line.repository';

/**
 * `TaxBreakdownService` — ventilation TVA par code taxe
 * (projet-ferme-zlh1). S'appuie sur `journal_entry_lines.tax_code`
 * (Migration 0110). Agrège, sur une période, les montants des lignes
 * d'écritures validées portant un code taxe, regroupés par code.
 *
 * Usage : recoupement de la déclaration TVA — vérifier que les bases et
 * montants ventilés par code (ex. "18", "09", "exo") correspondent à ce
 * qui a été déclaré. Vue brute volontairement neutre : on ne présume pas
 * du sens (collectée vs déductible) — c'est le code taxe et le compte
 * qui le portent ; on expose débit, crédit et net par code.
 */
@Injectable()
export class TaxBreakdownService {
  constructor(private readonly lineRepo: JournalEntryLineRepository) {}

  async getBreakdown(
    organizationId: TenantId,
    options: TaxBreakdownOptions = {},
  ): Promise<TaxBreakdownReport> {
    assertTenantId(organizationId);

    const { from, to } = resolveRange(options);
    const rows = await this.lineRepo.aggregateByTaxCode(organizationId, { from, to });

    let totalDebit = 0;
    let totalCredit = 0;
    let totalLines = 0;

    const codes = rows.map((r) => {
      const debit = Number(r.totalDebit) || 0;
      const credit = Number(r.totalCredit) || 0;
      totalDebit += debit;
      totalCredit += credit;
      totalLines += r.lineCount;
      return {
        taxCode: r.taxCode,
        totalDebit: round2(debit),
        totalCredit: round2(credit),
        net: round2(debit - credit),
        lineCount: r.lineCount,
      };
    });

    return {
      from,
      to,
      codes,
      totals: {
        totalDebit: round2(totalDebit),
        totalCredit: round2(totalCredit),
        net: round2(totalDebit - totalCredit),
        lineCount: totalLines,
      },
    };
  }
}

// ─── Types publics ──────────────────────────────────────────────────

export interface TaxBreakdownOptions {
  /** Bornes ISO `YYYY-MM-DD` (incluses). Défaut : année civile en cours. */
  readonly from?: string;
  readonly to?: string;
}

export interface TaxCodeRow {
  readonly taxCode: string;
  readonly totalDebit: string;
  readonly totalCredit: string;
  readonly net: string;
  readonly lineCount: number;
}

export interface TaxBreakdownReport {
  readonly from: string;
  readonly to: string;
  readonly codes: ReadonlyArray<TaxCodeRow>;
  readonly totals: {
    readonly totalDebit: string;
    readonly totalCredit: string;
    readonly net: string;
    readonly lineCount: number;
  };
}

// ─── Helpers ────────────────────────────────────────────────────────

function round2(n: number): string {
  return (Math.round(n * 100) / 100).toFixed(2);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Résout les bornes de période : valide les entrées `YYYY-MM-DD`, sinon
 * retombe sur l'année civile en cours (1er janvier → aujourd'hui).
 */
function resolveRange(options: TaxBreakdownOptions): { from: string; to: string } {
  const today = new Date().toISOString().slice(0, 10);
  const year = today.slice(0, 4);
  const from =
    options.from !== undefined && ISO_DATE.test(options.from.trim())
      ? options.from.trim()
      : `${year}-01-01`;
  const to =
    options.to !== undefined && ISO_DATE.test(options.to.trim()) ? options.to.trim() : today;
  return { from, to };
}
