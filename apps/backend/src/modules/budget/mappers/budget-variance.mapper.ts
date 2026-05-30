import type { BudgetVarianceReportResponse } from '../dto/responses';
import type { VarianceReportResult } from '../services/budget-variance.service';

/** Mapper pur résultat du moteur d'écarts → DTO de réponse OpenAPI. */
export function toBudgetVarianceReport(result: VarianceReportResult): BudgetVarianceReportResponse {
  return {
    fiscalYear: result.fiscalYear,
    budgetScenario: result.budgetScenario,
    groupBy: result.groupBy,
    rows: result.rows.map((r) => ({
      dimension: r.dimension,
      dimensionLabel: r.dimensionLabel,
      budget: r.budget,
      actual: r.actual,
      variance: r.variance,
      variancePct: r.variancePct,
      favorable: r.favorable,
      realizationPct: r.realizationPct,
    })),
    totalBudget: result.totalBudget,
    totalActual: result.totalActual,
    totalVariance: result.totalVariance,
  };
}
