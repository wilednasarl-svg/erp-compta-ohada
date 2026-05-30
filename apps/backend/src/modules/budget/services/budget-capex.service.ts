import { Injectable } from '@nestjs/common';

import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import type { TenantId } from '../../../common/persistence/tenant-scope';
import { computeMonthlyDotations } from '../lib/capex-amortization';
import { BudgetLineEntity } from '../entities/budget-line.entity';
import { BudgetLinesService } from './budget-lines.service';
import type { BudgetScenario } from '../types/budget.types';

/** Compte de dotation aux amortissements SYSCOHADA par défaut. */
const DEFAULT_DOTATION_ACCOUNT = '6811';

export interface GenerateAmortizationCommand {
  readonly capexLineId: string;
  /** Date de mise en service (AAAA-MM-JJ). */
  readonly serviceDate: string;
  readonly durationYears: number;
  /** Compte de charge de dotation (défaut 6811). */
  readonly dotationAccount?: string;
  /** Scénario des lignes générées (défaut = celui de la ligne CAPEX). */
  readonly scenario?: BudgetScenario;
  readonly createdById?: string | null;
}

@Injectable()
export class BudgetCapexService {
  constructor(private readonly lines: BudgetLinesService) {}

  /**
   * Génère les **dotations aux amortissements** (lignes OPEX compte 6811) de
   * l'exercice de la ligne CAPEX, à partir de son montant et de la durée
   * d'amortissement (linéaire, prorata temporis). Upsert par clé naturelle
   * (idempotent : régénérer met à jour les mêmes lignes).
   */
  async generateAmortization(
    organizationId: TenantId,
    cmd: GenerateAmortizationCommand,
  ): Promise<{ created: BudgetLineEntity[] }> {
    const capex = await this.lines.findById(cmd.capexLineId, organizationId);
    if (capex.budgetType !== 'CAPEX') {
      throw new AppException(ERROR_CODES.BUDGET_LINE_NOT_CAPEX, {
        message: 'La ligne ciblée n’est pas un investissement (CAPEX)',
        details: { id: capex.id, budgetType: capex.budgetType },
      });
    }

    const serviceYear = Number(cmd.serviceDate.slice(0, 4));
    const serviceMonth = Number(cmd.serviceDate.slice(5, 7));

    const dotations = computeMonthlyDotations({
      amount: capex.amount,
      durationYears: cmd.durationYears,
      serviceYear,
      serviceMonth,
      exerciseYear: capex.fiscalYear,
    });

    const account = cmd.dotationAccount ?? DEFAULT_DOTATION_ACCOUNT;
    const scenario = cmd.scenario ?? capex.scenario;
    const created: BudgetLineEntity[] = [];

    for (const d of dotations) {
      const { line } = await this.lines.upsert(organizationId, {
        fiscalYear: capex.fiscalYear,
        periodMonth: d.periodMonth,
        budgetType: 'OPEX',
        scenario,
        accountCode: account,
        accountLabel: 'Dotations aux amortissements',
        amount: d.amount,
        comment: `Amortissement CAPEX ${capex.accountCode} — ${cmd.durationYears} an(s), mise en service ${cmd.serviceDate}`,
        createdById: cmd.createdById ?? null,
      });
      created.push(line);
    }

    return { created };
  }
}
