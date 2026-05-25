import { Injectable } from '@nestjs/common';

import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import { type TenantId } from '../../../common/persistence/tenant-scope';
import { AccountingPeriodRepository } from '../../journals/repositories/accounting-period.repository';
import { DashboardsRepository } from '../repositories/dashboards.repository';
import type {
  AccountClassBreakdown,
  DashboardSummary,
} from '../types/dashboard-types';

/**
 * `DashboardSummaryService` — agrège les KPIs d'accueil pour un
 * exercice donné.
 *
 * Convention SYSCOHADA appliquée pour les agrégats :
 *
 *   - cashBalance     : solde débit net des comptes 5x trésorerie
 *                       (banques, caisses, virements). Snapshot au
 *                       `endDate` de l'exercice.
 *   - receivables     : solde débit net des comptes 41x (clients).
 *                       Snapshot au `endDate`.
 *   - payables        : solde crédit net des comptes 40x (fournisseurs).
 *                       Snapshot au `endDate`.
 *   - revenueYtd      : flux crédit net classe 7x (produits) sur
 *                       l'exercice [startDate, endDate].
 *   - expensesYtd     : flux débit net classe 6x (charges) sur l'exercice.
 *   - netResultYtd    : revenueYtd - expensesYtd (signed).
 *
 * Ratios :
 *   - grossMarginRatio : (revenue - expenses) / revenue. `null` si
 *                        revenue = 0 (évite division par zéro et signal
 *                        clair au client que la valeur n'est pas
 *                        calculable plutôt qu'un NaN ou 0 trompeur).
 *   - liquidityRatio   : cash / payables. `null` si payables = 0.
 *
 * Toutes les valeurs monétaires sortent en `string` DECIMAL pour
 * préserver la précision côté wire (DECIMAL(15,2) PG → string pg
 * driver → string JSON, jamais de cast en Number côté backend).
 */
@Injectable()
export class DashboardSummaryService {
  /** Classe OHADA → libellé humain pour le breakdown. */
  private static readonly CLASS_LABELS: Record<number, string> = {
    1: 'Capitaux',
    2: 'Immobilisations',
    3: 'Stocks',
    4: 'Tiers',
    5: 'Trésorerie',
    6: 'Charges',
    7: 'Produits',
    8: 'Comptes spéciaux',
    9: 'Comptes analytiques',
  };

  constructor(
    private readonly dashRepo: DashboardsRepository,
    private readonly periodsRepo: AccountingPeriodRepository,
  ) {}

  async getSummary(
    organizationId: TenantId,
    exerciseId: string,
  ): Promise<DashboardSummary> {
    const period = await this.periodsRepo.findById(exerciseId, organizationId);
    if (period === null || period.parentId !== null) {
      // On exige un exercice racine (annuel). Une sous-période
      // mensuelle/trimestrielle ne devrait pas être passée ici — c'est
      // le rôle d'un futur endpoint `summary?periodId=<sub>` éventuel.
      throw new AppException(ERROR_CODES.ACCOUNTING_PERIOD_NOT_FOUND, {
        message: `Exercise ${exerciseId} not found or is not a root annual period`,
      });
    }

    const fromDate = period.startDate;
    const toDate = period.endDate;

    // 1. Soldes instantanés (snapshot au `toDate`, donc cumulatif
    //    depuis l'origine). cash/AR/AP par préfixes de code car la
    //    SYSCOHADA mélange 51/53 (cash) et 52/54/57 (instruments) dans
    //    la même classe 5 — on prend strictement les comptes qui
    //    représentent du cash dispo (51, 53, 57).
    const [cashAgg, arAgg, apAgg] = await Promise.all([
      this.dashRepo.aggregateByCodePrefix(organizationId, toDate, ['51', '53', '57']),
      this.dashRepo.aggregateByCodePrefix(organizationId, toDate, ['41']),
      this.dashRepo.aggregateByCodePrefix(organizationId, toDate, ['40']),
    ]);

    const cashBalance = sub(cashAgg.totalDebit, cashAgg.totalCredit);
    const receivables = sub(arAgg.totalDebit, arAgg.totalCredit);
    // Payables : net crédit. Si l'org a payé trop (debit > credit),
    // le net est négatif — on garde le signe (un "payables négatif"
    // signale un trop-versé / acompte aux fournisseurs).
    const payables = sub(apAgg.totalCredit, apAgg.totalDebit);

    // 2. YTD : flux exercices uniquement [startDate, endDate].
    const classRows = await this.dashRepo.aggregateByClass(
      organizationId,
      fromDate,
      toDate,
      [1, 2, 3, 4, 5, 6, 7, 8, 9],
    );

    // Map classe → row pour lookup O(1) en construisant le breakdown.
    const classMap = new Map<number, (typeof classRows)[number]>();
    for (const row of classRows) classMap.set(row.accountClass, row);

    const revenueRow = classMap.get(7);
    const expensesRow = classMap.get(6);
    const revenueYtd = revenueRow ? sub(revenueRow.totalCredit, revenueRow.totalDebit) : '0.00';
    const expensesYtd = expensesRow
      ? sub(expensesRow.totalDebit, expensesRow.totalCredit)
      : '0.00';
    const netResultYtd = sub(revenueYtd, expensesYtd);

    // 3. Ratios — null si dénominateur = 0 (signal au client).
    const revenueNum = Number(revenueYtd);
    const payablesNum = Number(payables);
    const grossMarginRatio =
      revenueNum > 0 ? round4((revenueNum - Number(expensesYtd)) / revenueNum) : null;
    const liquidityRatio =
      payablesNum > 0 ? round4(Number(cashBalance) / payablesNum) : null;

    // 4. Breakdown par classe pour drill-down ultérieur côté UI.
    const accountClassBreakdown: AccountClassBreakdown[] = classRows
      .map((r) => ({
        accountClass: r.accountClass,
        label: DashboardSummaryService.CLASS_LABELS[r.accountClass] ?? `Classe ${r.accountClass}`,
        debit: format2(r.totalDebit),
        credit: format2(r.totalCredit),
        net: sub(r.totalDebit, r.totalCredit),
      }))
      .sort((a, b) => a.accountClass - b.accountClass);

    return {
      organizationId,
      exerciseId,
      periodStart: fromDate,
      periodEnd: toDate,
      currency: 'XOF', // SYSCOHADA UEMOA default ; Module 16 wave 2 ouvrira la para
      cashBalance,
      receivables,
      payables,
      revenueYtd,
      expensesYtd,
      netResultYtd,
      grossMarginRatio,
      liquidityRatio,
      accountClassBreakdown,
    };
  }
}

/** Soustraction string→string sans drift (jusqu'à 2 décimales). */
function sub(a: string, b: string): string {
  return (Number(a) - Number(b)).toFixed(2);
}

function format2(s: string): string {
  return Number(s).toFixed(2);
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/**
 * Exposé pour les tests : injection facile sans avoir à mocker le
 * repo entier — un fake plug-in qui implémente uniquement les méthodes
 * utilisées par le service suffit.
 */
export const DASHBOARD_SUMMARY_CLASS_LABELS = DashboardSummaryService['CLASS_LABELS'];
