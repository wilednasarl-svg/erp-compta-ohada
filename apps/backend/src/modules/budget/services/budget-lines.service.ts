import { Injectable } from '@nestjs/common';

import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import type { TenantId } from '../../../common/persistence/tenant-scope';
import { toBaseAmount } from '../lib/budget-money';
import { BudgetAxisEntity } from '../entities/budget-axis.entity';
import { BudgetLineEntity } from '../entities/budget-line.entity';
import { BudgetAxisRepository } from '../repositories/budget-axis.repository';
import {
  BudgetLineRepository,
  type ListBudgetLinesFilter,
} from '../repositories/budget-line.repository';
import {
  BUDGET_STATUS_TRANSITIONS,
  DEFAULT_BUDGET_CURRENCY,
  type BudgetAxisType,
  type BudgetLineStatus,
  type BudgetScenario,
  type BudgetType,
} from '../types/budget.types';

export interface CreateLineCommand {
  readonly fiscalYear: number;
  readonly periodMonth?: number | null;
  readonly budgetType: BudgetType;
  readonly scenario?: BudgetScenario;
  readonly accountCode: string;
  readonly accountLabel?: string;
  readonly costCenterAxisId?: string;
  readonly projectAxisId?: string;
  readonly agencyAxisId?: string;
  readonly productAxisId?: string;
  readonly amount: string;
  readonly currency?: string;
  readonly exchangeRate?: string;
  readonly comment?: string;
  readonly hypothesis?: string;
  readonly createdById?: string | null;
}

export interface UpdateLineCommand {
  readonly accountLabel?: string;
  readonly amount?: string;
  readonly currency?: string;
  readonly exchangeRate?: string;
  readonly comment?: string;
  readonly hypothesis?: string;
}

@Injectable()
export class BudgetLinesService {
  constructor(
    private readonly lines: BudgetLineRepository,
    private readonly axes: BudgetAxisRepository,
  ) {}

  async list(
    organizationId: TenantId,
    filter: ListBudgetLinesFilter,
  ): Promise<{ rows: BudgetLineEntity[]; total: number }> {
    return this.lines.list(organizationId, filter);
  }

  async findById(id: string, organizationId: TenantId): Promise<BudgetLineEntity> {
    const line = await this.lines.findById(id, organizationId);
    if (!line) {
      throw new AppException(ERROR_CODES.BUDGET_LINE_NOT_FOUND, {
        message: `Ligne budgétaire ${id} introuvable`,
        details: { id },
      });
    }
    return line;
  }

  async create(organizationId: TenantId, cmd: CreateLineCommand): Promise<BudgetLineEntity> {
    const scenario = cmd.scenario ?? 'BI';
    const currency = cmd.currency ?? DEFAULT_BUDGET_CURRENCY;
    const exchangeRate = cmd.exchangeRate ?? '1';

    await this.assertAxes(organizationId, cmd);

    const duplicate = await this.lines.findByNaturalKey(organizationId, {
      fiscalYear: cmd.fiscalYear,
      periodMonth: cmd.periodMonth ?? null,
      budgetType: cmd.budgetType,
      scenario,
      accountCode: cmd.accountCode,
      costCenterAxisId: cmd.costCenterAxisId,
      projectAxisId: cmd.projectAxisId,
      agencyAxisId: cmd.agencyAxisId,
      productAxisId: cmd.productAxisId,
    });
    if (duplicate) {
      throw new AppException(ERROR_CODES.BUDGET_LINE_DUPLICATE, {
        message:
          'Une ligne budgétaire existe déjà pour cette clé (compte+analytique+période+scénario)',
        details: { existingId: duplicate.id },
      });
    }

    return this.lines.create({
      organizationId,
      fiscalYear: cmd.fiscalYear,
      periodMonth: cmd.periodMonth ?? null,
      budgetType: cmd.budgetType,
      scenario,
      accountCode: cmd.accountCode,
      accountLabel: cmd.accountLabel ?? null,
      costCenterAxisId: cmd.costCenterAxisId ?? null,
      projectAxisId: cmd.projectAxisId ?? null,
      agencyAxisId: cmd.agencyAxisId ?? null,
      productAxisId: cmd.productAxisId ?? null,
      amount: cmd.amount,
      currency,
      exchangeRate,
      amountBase: toBaseAmount(cmd.amount, exchangeRate),
      comment: cmd.comment ?? null,
      hypothesis: cmd.hypothesis ?? null,
      createdById: cmd.createdById ?? null,
    });
  }

  async update(
    id: string,
    organizationId: TenantId,
    cmd: UpdateLineCommand,
  ): Promise<BudgetLineEntity> {
    const line = await this.findById(id, organizationId);
    this.assertMutable(line);

    const amount = cmd.amount ?? line.amount;
    const exchangeRate = cmd.exchangeRate ?? line.exchangeRate;

    return this.lines.update(line, {
      accountLabel: cmd.accountLabel,
      amount: cmd.amount,
      currency: cmd.currency,
      exchangeRate: cmd.exchangeRate,
      amountBase: toBaseAmount(amount, exchangeRate),
      comment: cmd.comment,
      hypothesis: cmd.hypothesis,
    });
  }

  async transition(
    id: string,
    organizationId: TenantId,
    targetStatus: BudgetLineStatus,
    validatedById?: string | null,
  ): Promise<BudgetLineEntity> {
    const line = await this.findById(id, organizationId);
    const allowed = BUDGET_STATUS_TRANSITIONS[line.status];
    if (!allowed.includes(targetStatus)) {
      throw new AppException(ERROR_CODES.BUDGET_LINE_INVALID_TRANSITION, {
        message: `Transition ${line.status} → ${targetStatus} non autorisée`,
        details: { from: line.status, to: targetStatus, allowed },
      });
    }

    const isValidation = targetStatus === 'valide_n1' || targetStatus === 'valide_daf';
    return this.lines.update(line, {
      status: targetStatus,
      validatedById: isValidation ? (validatedById ?? null) : line.validatedById,
    });
  }

  async remove(id: string, organizationId: TenantId): Promise<void> {
    const line = await this.findById(id, organizationId);
    this.assertMutable(line);
    await this.lines.delete(line);
  }

  /** Une ligne verrouillée n'est plus modifiable ni supprimable. */
  private assertMutable(line: BudgetLineEntity): void {
    if (line.status === 'verrouille') {
      throw new AppException(ERROR_CODES.BUDGET_LINE_LOCKED, {
        message: 'Ligne budgétaire verrouillée : modification interdite',
        details: { id: line.id, status: line.status },
      });
    }
  }

  /** Valide que chaque axe référencé existe, appartient à l'org et a le bon type. */
  private async assertAxes(organizationId: TenantId, cmd: CreateLineCommand): Promise<void> {
    const checks: ReadonlyArray<readonly [string | undefined, BudgetAxisType]> = [
      [cmd.costCenterAxisId, 'cost_center'],
      [cmd.projectAxisId, 'project'],
      [cmd.agencyAxisId, 'agency'],
      [cmd.productAxisId, 'product'],
    ];
    for (const [axisId, expectedType] of checks) {
      if (!axisId) continue;
      const axis: BudgetAxisEntity | null = await this.axes.findById(axisId, organizationId);
      if (!axis || axis.axisType !== expectedType) {
        throw new AppException(ERROR_CODES.BUDGET_AXIS_NOT_FOUND, {
          message: `Axe ${axisId} introuvable ou de type incorrect (attendu ${expectedType})`,
          details: { axisId, expectedType, actualType: axis?.axisType ?? null },
        });
      }
    }
  }
}
