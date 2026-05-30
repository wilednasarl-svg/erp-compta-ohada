import { Injectable } from '@nestjs/common';

import type { TenantId } from '../../../common/persistence/tenant-scope';
import { percentOf, subtractAmounts, sumAmounts } from '../lib/budget-money';
import {
  BudgetVarianceRepository,
  type BudgetGroupBy,
  type VarianceQuery,
} from '../repositories/budget-variance.repository';
import type { BudgetScenario } from '../types/budget.types';

export interface VarianceRowResult {
  readonly dimension: string | null;
  readonly dimensionLabel: string | null;
  readonly budget: string;
  readonly actual: string;
  readonly variance: string;
  readonly variancePct: number | null;
  readonly favorable: boolean;
  readonly realizationPct: number | null;
}

export interface VarianceReportResult {
  readonly fiscalYear: number;
  readonly budgetScenario: BudgetScenario;
  readonly groupBy: BudgetGroupBy;
  readonly rows: VarianceRowResult[];
  readonly totalBudget: string;
  readonly totalActual: string;
  readonly totalVariance: string;
}

@Injectable()
export class BudgetVarianceService {
  constructor(private readonly variance: BudgetVarianceRepository) {}

  /**
   * Produit l'état d'écart réalisé vs budget. Le caractère favorable de
   * l'écart dépend du SENS du compte SYSCOHADA : pour un produit (classe 7),
   * réalisé > budget est favorable ; pour une charge, réalisé < budget est
   * favorable. Le sens n'est déterminable de façon fiable que sur un
   * regroupement par compte ; pour les autres dimensions on adopte la
   * perspective « coût » (écart ≤ 0 = favorable).
   */
  async report(organizationId: TenantId, query: VarianceQuery): Promise<VarianceReportResult> {
    const groupBy = query.groupBy ?? 'account';
    const budgetScenario = query.budgetScenario ?? 'BI';
    const rawRows = await this.variance.computeVariance(organizationId, query);

    const rows: VarianceRowResult[] = rawRows.map((r) => {
      const variance = subtractAmounts(r.actual, r.budget);
      const absBudget = r.budget.startsWith('-') ? r.budget.slice(1) : r.budget;
      const isRevenue = groupBy === 'account' && this.isRevenueAccount(r.dimension);

      return {
        dimension: r.dimension,
        dimensionLabel: r.dimensionLabel,
        budget: r.budget,
        actual: r.actual,
        variance,
        variancePct: percentOf(variance, absBudget),
        favorable: this.isFavorable(variance, isRevenue),
        realizationPct: percentOf(r.actual, r.budget),
      };
    });

    const totalBudget = sumAmounts(rows.map((r) => r.budget));
    const totalActual = sumAmounts(rows.map((r) => r.actual));

    return {
      fiscalYear: query.fiscalYear,
      budgetScenario,
      groupBy,
      rows,
      totalBudget,
      totalActual,
      totalVariance: subtractAmounts(totalActual, totalBudget),
    };
  }

  /** Classe 7 SYSCOHADA = produits (revenus). */
  private isRevenueAccount(accountCode: string | null): boolean {
    return typeof accountCode === 'string' && accountCode.startsWith('7');
  }

  /**
   * Produit : écart positif (réalisé > budget) favorable.
   * Charge / perspective coût : écart négatif (réalisé < budget) favorable.
   */
  private isFavorable(variance: string, isRevenue: boolean): boolean {
    const negative = variance.startsWith('-');
    const positiveOrZero = !negative;
    return isRevenue ? positiveOrZero : negative || variance === '0.00';
  }
}
