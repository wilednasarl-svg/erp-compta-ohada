import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import { BudgetLineEntity } from '../entities/budget-line.entity';
import type { BudgetScenario, BudgetType } from '../types/budget.types';

/** Dimension d'agrégation pour l'analyse d'écart (whitelist — anti-injection). */
export type BudgetGroupBy =
  | 'account'
  | 'cost_center'
  | 'project'
  | 'agency'
  | 'budget_type'
  | 'period';

const GROUP_BY_COLUMNS: Readonly<Record<BudgetGroupBy, { key: string; label: string }>> = {
  account: { key: 'account_code', label: 'account_label' },
  cost_center: { key: 'cost_center_axis_id', label: 'cost_center_axis_id' },
  project: { key: 'project_axis_id', label: 'project_axis_id' },
  agency: { key: 'agency_axis_id', label: 'agency_axis_id' },
  budget_type: { key: 'budget_type', label: 'budget_type' },
  period: { key: 'period_month', label: 'period_month' },
};

export interface VarianceQuery {
  readonly fiscalYear: number;
  /** Scénario budgétaire de référence comparé au REAL (BI par défaut). */
  readonly budgetScenario?: BudgetScenario;
  readonly groupBy?: BudgetGroupBy;
  readonly budgetType?: BudgetType;
  /** Borne YTD : ne somme que les périodes ≤ ce mois (1..12). */
  readonly upToMonth?: number | null;
}

/** Ligne d'agrégat brute (montants en string NUMERIC). */
export interface VarianceRow {
  readonly dimension: string | null;
  readonly dimensionLabel: string | null;
  readonly budget: string;
  readonly actual: string;
}

@Injectable()
export class BudgetVarianceRepository {
  constructor(
    @InjectRepository(BudgetLineEntity)
    private readonly repo: Repository<BudgetLineEntity>,
  ) {}

  /**
   * Pivote les scénarios en colonnes (budget vs réalisé) et agrège les
   * montants de base par la dimension demandée, en une seule passe SQL.
   * Le calcul d'écart (montant, %, sens favorable/défavorable) est fait en
   * service car il dépend du sens du compte SYSCOHADA.
   */
  async computeVariance(
    organizationId: TenantId | string,
    query: VarianceQuery,
  ): Promise<VarianceRow[]> {
    assertTenantId(organizationId);

    const groupBy = query.groupBy ?? 'account';
    const col = GROUP_BY_COLUMNS[groupBy];
    const budgetScenario = query.budgetScenario ?? 'BI';

    // Quand la colonne de libellé EST la colonne de regroupement (cas des axes
    // analytiques, colonnes UUID, et de la période/type), on la sélectionne
    // directement : Postgres n'a pas d'agrégat MAX(uuid), et la colonne
    // groupée est de toute façon fonctionnellement déterminée. MAX n'est requis
    // que pour le libellé de compte (account_label, non groupé).
    const labelExpr =
      col.label === col.key ? `line.${col.label}` : `MAX(line.${col.label})`;

    const qb = this.repo
      .createQueryBuilder('line')
      .select(`line.${col.key}`, 'dimension')
      .addSelect(labelExpr, 'dimensionLabel')
      .addSelect(
        `COALESCE(SUM(CASE WHEN line.scenario = :budgetScenario THEN line.amount_base ELSE 0 END), 0)`,
        'budget',
      )
      .addSelect(
        `COALESCE(SUM(CASE WHEN line.scenario = 'REAL' THEN line.amount_base ELSE 0 END), 0)`,
        'actual',
      )
      .where('line.organization_id = :organizationId', { organizationId })
      .andWhere('line.fiscal_year = :fiscalYear', { fiscalYear: query.fiscalYear })
      .setParameter('budgetScenario', budgetScenario);

    if (query.budgetType) {
      qb.andWhere('line.budget_type = :budgetType', { budgetType: query.budgetType });
    }
    if (query.upToMonth !== undefined && query.upToMonth !== null) {
      qb.andWhere('(line.period_month IS NULL OR line.period_month <= :upToMonth)', {
        upToMonth: query.upToMonth,
      });
    }

    const rows = await qb.groupBy(`line.${col.key}`).orderBy(`line.${col.key}`, 'ASC').getRawMany<{
      dimension: string | null;
      dimensionLabel: string | null;
      budget: string;
      actual: string;
    }>();

    return rows.map((r) => ({
      dimension: r.dimension,
      dimensionLabel: r.dimensionLabel,
      budget: r.budget ?? '0',
      actual: r.actual ?? '0',
    }));
  }
}
