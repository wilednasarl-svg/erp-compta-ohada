import { Injectable } from '@nestjs/common';

import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import { OrganizationAccountRepository } from '../../accounting-plan/repositories/organization-account.repository';
import {
  ReportsRepository,
  type GeneralLedgerRow,
  type TrialBalanceRow,
} from '../repositories/reports.repository';
import {
  ACTIF_SECTION_LABELS,
  PASSIF_SECTION_LABELS,
  PL_CHARGE_SECTIONS,
  PL_PRODUIT_SECTIONS,
  classifyForBilan,
  type BalanceSheetActifKey,
  type BalanceSheetPassifKey,
} from './ohada-classifier';

export interface TrialBalanceQuery {
  readonly fromDate: string;
  readonly toDate: string;
  readonly accountClass?: number;
  readonly accountCodeFrom?: string;
  readonly accountCodeTo?: string;
  readonly hideEmpty?: boolean;
}

export interface TrialBalanceReport {
  readonly fromDate: string;
  readonly toDate: string;
  readonly rows: readonly TrialBalanceRow[];
  readonly totals: {
    readonly openingDebit: string;
    readonly openingCredit: string;
    readonly periodDebit: string;
    readonly periodCredit: string;
    readonly endingDebit: string;
    readonly endingCredit: string;
  };
}

export interface GeneralLedgerQuery {
  readonly accountId: string;
  readonly fromDate: string;
  readonly toDate: string;
}

export interface GeneralLedgerEntry extends GeneralLedgerRow {
  /** Cumulative debit-credit balance up to and including this line. */
  readonly runningBalance: string;
}

export interface ProfitLossLine {
  readonly code: string;
  readonly label: string;
  readonly amount: string;
  readonly accounts: ReadonlyArray<{
    readonly code: string;
    readonly label: string;
    readonly amount: string;
  }>;
}

export interface ProfitLossReport {
  readonly fromDate: string;
  readonly toDate: string;
  readonly charges: ReadonlyArray<ProfitLossLine>;
  readonly produits: ReadonlyArray<ProfitLossLine>;
  readonly totalCharges: string;
  readonly totalProduits: string;
  /** produits − charges. Positive = bénéfice, negative = perte. */
  readonly resultat: string;
}

export interface BalanceSheetGroup {
  readonly accountId: string;
  readonly code: string;
  readonly label: string;
  readonly amount: string;
}

export interface BalanceSheetSection {
  readonly key: BalanceSheetActifKey | BalanceSheetPassifKey;
  readonly label: string;
  readonly groups: ReadonlyArray<BalanceSheetGroup>;
  readonly total: string;
}

export interface BalanceSheetReport {
  readonly asAtDate: string;
  readonly actif: {
    readonly sections: ReadonlyArray<BalanceSheetSection>;
    readonly total: string;
  };
  readonly passif: {
    readonly sections: ReadonlyArray<BalanceSheetSection>;
    readonly total: string;
  };
  /**
   * Bilan equilibre check: difference between Actif and Passif. Should
   * be 0 once the current year's net result is incorporated. The wave 2
   * MVP exposes the raw difference; the wave 3 will fold the P&L result
   * into capitaux propres automatically.
   */
  readonly difference: string;
}

export interface GeneralLedgerReport {
  readonly accountId: string;
  readonly accountCode: string;
  readonly accountLabel: string;
  readonly accountClass: number;
  readonly fromDate: string;
  readonly toDate: string;
  readonly opening: { openingDebit: string; openingCredit: string };
  readonly lines: readonly GeneralLedgerEntry[];
  readonly totals: {
    readonly periodDebit: string;
    readonly periodCredit: string;
    readonly endingDebit: string;
    readonly endingCredit: string;
  };
}

/**
 * `ReportsService` — Module 9 wave 1 accounting reports.
 *
 *   - `getTrialBalance`  : balance générale (one row per account).
 *   - `getGeneralLedger` : grand livre d'un compte (chronologique + cumul).
 *
 * Both reports are *strictly read-only*: they project validated
 * `journal_entry_lines` and never touch the DB beyond the SELECT. No
 * audit event is emitted on report consumption — the audit trail
 * already covers the writes (entry_created / entry_validated).
 *
 * Money arithmetic uses JS numbers internally for the running balance
 * (the only place a sequential reduce is needed); inputs and outputs
 * stay as `string` for DECIMAL(15,2) fidelity. Tolerance of 0.005 on
 * the trial-balance totals would only matter if we did per-account
 * net rounding before summing — which we don't (we sum raw cents).
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly repo: ReportsRepository,
    private readonly accounts: OrganizationAccountRepository,
  ) {}

  async getTrialBalance(
    organizationId: TenantId,
    query: TrialBalanceQuery,
  ): Promise<TrialBalanceReport> {
    assertTenantId(organizationId);
    this.assertDateRange(query.fromDate, query.toDate);

    const rows = await this.repo.trialBalance(organizationId, query);
    const filtered =
      query.hideEmpty === true
        ? rows.filter(
            (r) =>
              Number(r.openingDebit) !== 0 ||
              Number(r.openingCredit) !== 0 ||
              Number(r.periodDebit) !== 0 ||
              Number(r.periodCredit) !== 0,
          )
        : rows;

    return {
      fromDate: query.fromDate,
      toDate: query.toDate,
      rows: filtered,
      totals: this.computeTrialBalanceTotals(filtered),
    };
  }

  async getGeneralLedger(
    organizationId: TenantId,
    query: GeneralLedgerQuery,
  ): Promise<GeneralLedgerReport> {
    assertTenantId(organizationId);
    this.assertDateRange(query.fromDate, query.toDate);

    const account = await this.accounts.findById(query.accountId, organizationId);
    if (account === null) {
      throw new AppException(ERROR_CODES.CHART_ACCOUNT_NOT_FOUND, {
        message: `Account ${query.accountId} not found in this organisation.`,
      });
    }

    const [rawLines, opening] = await Promise.all([
      this.repo.generalLedger(organizationId, query),
      this.repo.generalLedgerOpening(organizationId, query.accountId, query.fromDate),
    ]);

    // Compute running balance starting from opening (debit positive,
    // credit negative). One pass over the chronologically-ordered list.
    let running = Number(opening.openingDebit) - Number(opening.openingCredit);
    const lines: GeneralLedgerEntry[] = rawLines.map((row) => {
      running += Number(row.debit) - Number(row.credit);
      return { ...row, runningBalance: running.toFixed(2) };
    });

    const periodDebit = rawLines.reduce((s, r) => s + Number(r.debit), 0);
    const periodCredit = rawLines.reduce((s, r) => s + Number(r.credit), 0);
    const totalDebit = Number(opening.openingDebit) + periodDebit;
    const totalCredit = Number(opening.openingCredit) + periodCredit;
    const net = totalDebit - totalCredit;

    return {
      accountId: account.id,
      accountCode: account.code,
      accountLabel: account.label,
      accountClass: account.class,
      fromDate: query.fromDate,
      toDate: query.toDate,
      opening,
      lines,
      totals: {
        periodDebit: periodDebit.toFixed(2),
        periodCredit: periodCredit.toFixed(2),
        endingDebit: (net > 0 ? net : 0).toFixed(2),
        endingCredit: (net < 0 ? -net : 0).toFixed(2),
      },
    };
  }

  /**
   * Compte de Résultat OHADA — agrégation des classes 6 (charges) et 7
   * (produits) sur la période [fromDate, toDate].
   *
   * Chaque section (60, 61, …, 70, 71, …) liste les comptes mouvementés
   * sur la période avec leur contribution nette :
   *   - charges  : netDebit  = periodDebit  - periodCredit
   *   - produits : netCredit = periodCredit - periodDebit
   *
   * Résultat = Total Produits − Total Charges.
   */
  async getProfitLoss(
    organizationId: TenantId,
    query: { fromDate: string; toDate: string },
  ): Promise<ProfitLossReport> {
    assertTenantId(organizationId);
    this.assertDateRange(query.fromDate, query.toDate);

    const rows = await this.repo.trialBalance(organizationId, {
      fromDate: query.fromDate,
      toDate: query.toDate,
    });

    const class6 = rows.filter((r) => r.accountClass === 6);
    const class7 = rows.filter((r) => r.accountClass === 7);

    const charges = PL_CHARGE_SECTIONS.map((section) =>
      this.buildPlSection(section.code, section.label, class6, 'CHARGE'),
    );
    const produits = PL_PRODUIT_SECTIONS.map((section) =>
      this.buildPlSection(section.code, section.label, class7, 'PRODUIT'),
    );

    const totalCharges = charges.reduce((s, sect) => s + Number(sect.amount), 0);
    const totalProduits = produits.reduce((s, sect) => s + Number(sect.amount), 0);
    const resultat = totalProduits - totalCharges;

    return {
      fromDate: query.fromDate,
      toDate: query.toDate,
      charges,
      produits,
      totalCharges: totalCharges.toFixed(2),
      totalProduits: totalProduits.toFixed(2),
      resultat: resultat.toFixed(2),
    };
  }

  /**
   * Bilan OHADA — photographie patrimoniale "as at" une date.
   *
   * Classifie chaque compte ayant un solde cumulé en :
   *   ACTIF  : Immobilisé (cl. 2) / Circulant (cl. 3, 4 débit) / Trésorerie actif (cl. 5 débit)
   *   PASSIF : Capitaux propres (cl. 1, codes 10-15) / Dettes financières (cl. 1, codes 16+)
   *            / Passif circulant (cl. 4 crédit) / Trésorerie passif (cl. 5 crédit)
   *
   * Wave 2 n'incorpore PAS automatiquement le résultat de l'exercice
   * courant dans les capitaux propres — `difference` expose l'écart
   * actif − passif pour que l'utilisateur le contrôle visuellement.
   * Wave 3 fera la consolidation automatique.
   */
  async getBalanceSheet(
    organizationId: TenantId,
    query: { asAtDate: string },
  ): Promise<BalanceSheetReport> {
    assertTenantId(organizationId);
    if (!ReportsService.isYmd(query.asAtDate)) {
      throw new AppException(ERROR_CODES.REPORT_INVALID_DATE_RANGE, {
        message: `asAtDate must be YYYY-MM-DD (got ${query.asAtDate}).`,
      });
    }

    const rows = await this.repo.accountBalancesAsAt(organizationId, query.asAtDate);

    const actifBuckets = new Map<BalanceSheetActifKey, BalanceSheetGroup[]>();
    const passifBuckets = new Map<BalanceSheetPassifKey, BalanceSheetGroup[]>();

    for (const row of rows) {
      const debit = Number(row.totalDebit);
      const credit = Number(row.totalCredit);
      const net = debit - credit;
      if (Math.abs(net) < 0.005) continue; // zero-balance account → skip
      const netSign: 'D' | 'C' = net > 0 ? 'D' : 'C';
      const classification = classifyForBilan(row.accountCode, row.accountClass, netSign);
      if (classification === null) continue; // class 6/7/8/9 — not Bilan
      const absAmount = Math.abs(net).toFixed(2);
      const group: BalanceSheetGroup = {
        accountId: row.accountId,
        code: row.accountCode,
        label: row.accountLabel,
        amount: absAmount,
      };
      if (classification.side === 'ACTIF') {
        const bucket = actifBuckets.get(classification.key) ?? [];
        bucket.push(group);
        actifBuckets.set(classification.key, bucket);
      } else {
        const bucket = passifBuckets.get(classification.key) ?? [];
        bucket.push(group);
        passifBuckets.set(classification.key, bucket);
      }
    }

    const actifSections: BalanceSheetSection[] = (
      Object.keys(ACTIF_SECTION_LABELS) as BalanceSheetActifKey[]
    ).map((key) => {
      const groups = actifBuckets.get(key) ?? [];
      const total = groups.reduce((s, g) => s + Number(g.amount), 0);
      return {
        key,
        label: ACTIF_SECTION_LABELS[key],
        groups,
        total: total.toFixed(2),
      };
    });

    const passifSections: BalanceSheetSection[] = (
      Object.keys(PASSIF_SECTION_LABELS) as BalanceSheetPassifKey[]
    ).map((key) => {
      const groups = passifBuckets.get(key) ?? [];
      const total = groups.reduce((s, g) => s + Number(g.amount), 0);
      return {
        key,
        label: PASSIF_SECTION_LABELS[key],
        groups,
        total: total.toFixed(2),
      };
    });

    const totalActif = actifSections.reduce((s, sect) => s + Number(sect.total), 0);
    const totalPassif = passifSections.reduce((s, sect) => s + Number(sect.total), 0);

    return {
      asAtDate: query.asAtDate,
      actif: { sections: actifSections, total: totalActif.toFixed(2) },
      passif: { sections: passifSections, total: totalPassif.toFixed(2) },
      difference: (totalActif - totalPassif).toFixed(2),
    };
  }

  // ─── Helpers ───────────────────────────────────────────────────────

  private buildPlSection(
    prefix: string,
    label: string,
    rows: readonly TrialBalanceRow[],
    side: 'CHARGE' | 'PRODUIT',
  ): ProfitLossLine {
    const matching = rows.filter((r) => r.accountCode.startsWith(prefix));
    const accounts = matching
      .map((r) => {
        const periodD = Number(r.periodDebit);
        const periodC = Number(r.periodCredit);
        const net = side === 'CHARGE' ? periodD - periodC : periodC - periodD;
        return { code: r.accountCode, label: r.accountLabel, amount: net };
      })
      .filter((a) => Math.abs(a.amount) >= 0.005);

    const amount = accounts.reduce((s, a) => s + a.amount, 0);
    return {
      code: prefix,
      label,
      amount: amount.toFixed(2),
      accounts: accounts.map((a) => ({
        code: a.code,
        label: a.label,
        amount: a.amount.toFixed(2),
      })),
    };
  }

  private assertDateRange(fromDate: string, toDate: string): void {
    if (!ReportsService.isYmd(fromDate) || !ReportsService.isYmd(toDate)) {
      throw new AppException(ERROR_CODES.REPORT_INVALID_DATE_RANGE, {
        message: `Both fromDate and toDate must be YYYY-MM-DD (got ${fromDate}, ${toDate}).`,
      });
    }
    if (fromDate > toDate) {
      throw new AppException(ERROR_CODES.REPORT_INVALID_DATE_RANGE, {
        message: `fromDate must be <= toDate (got ${fromDate} > ${toDate}).`,
      });
    }
  }

  static isYmd(s: string): boolean {
    return /^\d{4}-\d{2}-\d{2}$/.test(s);
  }

  private computeTrialBalanceTotals(rows: readonly TrialBalanceRow[]): {
    openingDebit: string;
    openingCredit: string;
    periodDebit: string;
    periodCredit: string;
    endingDebit: string;
    endingCredit: string;
  } {
    const sum = (key: keyof TrialBalanceRow): number =>
      rows.reduce((s, r) => s + Number(r[key] as string), 0);
    return {
      openingDebit: sum('openingDebit').toFixed(2),
      openingCredit: sum('openingCredit').toFixed(2),
      periodDebit: sum('periodDebit').toFixed(2),
      periodCredit: sum('periodCredit').toFixed(2),
      endingDebit: sum('endingDebit').toFixed(2),
      endingCredit: sum('endingCredit').toFixed(2),
    };
  }
}
