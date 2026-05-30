import { Injectable } from '@nestjs/common';

import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import type { TenantId } from '../../../common/persistence/tenant-scope';
import { BudgetAxisEntity } from '../entities/budget-axis.entity';
import {
  BudgetAxisRepository,
  type ListBudgetAxesFilter,
} from '../repositories/budget-axis.repository';
import type { BudgetAxisType } from '../types/budget.types';

export interface CreateAxisCommand {
  readonly axisType: BudgetAxisType;
  readonly code: string;
  readonly label: string;
  readonly parentId?: string;
  readonly isActive?: boolean;
}

export interface UpdateAxisCommand {
  readonly label?: string;
  readonly parentId?: string | null;
  readonly isActive?: boolean;
}

@Injectable()
export class BudgetAxesService {
  constructor(private readonly axes: BudgetAxisRepository) {}

  async list(organizationId: TenantId, filter: ListBudgetAxesFilter): Promise<BudgetAxisEntity[]> {
    return this.axes.list(organizationId, filter);
  }

  async findById(id: string, organizationId: TenantId): Promise<BudgetAxisEntity> {
    const axis = await this.axes.findById(id, organizationId);
    if (!axis) {
      throw new AppException(ERROR_CODES.BUDGET_AXIS_NOT_FOUND, {
        message: `Axe budgétaire ${id} introuvable`,
        details: { id },
      });
    }
    return axis;
  }

  async create(organizationId: TenantId, cmd: CreateAxisCommand): Promise<BudgetAxisEntity> {
    const existing = await this.axes.findByCode(organizationId, cmd.axisType, cmd.code);
    if (existing) {
      throw new AppException(ERROR_CODES.BUDGET_AXIS_CODE_TAKEN, {
        message: `Le code ${cmd.code} existe déjà pour le type ${cmd.axisType}`,
        details: { axisType: cmd.axisType, code: cmd.code },
      });
    }

    if (cmd.parentId) {
      await this.assertParentValid(organizationId, cmd.parentId, cmd.axisType);
    }

    return this.axes.create({
      organizationId,
      axisType: cmd.axisType,
      code: cmd.code,
      label: cmd.label,
      parentId: cmd.parentId ?? null,
      isActive: cmd.isActive,
    });
  }

  async update(
    id: string,
    organizationId: TenantId,
    cmd: UpdateAxisCommand,
  ): Promise<BudgetAxisEntity> {
    const axis = await this.findById(id, organizationId);

    if (cmd.parentId) {
      if (cmd.parentId === id) {
        throw new AppException(ERROR_CODES.BUDGET_AXIS_PARENT_TYPE_MISMATCH, {
          message: 'Un axe ne peut pas être son propre parent',
          details: { id },
        });
      }
      await this.assertParentValid(organizationId, cmd.parentId, axis.axisType);
    }

    return this.axes.update(axis, {
      label: cmd.label,
      parentId: cmd.parentId,
      isActive: cmd.isActive,
    });
  }

  /** Le parent doit exister et partager le même type d'axe (cohérence de l'arbre). */
  private async assertParentValid(
    organizationId: TenantId,
    parentId: string,
    axisType: BudgetAxisType,
  ): Promise<void> {
    const parent = await this.axes.findById(parentId, organizationId);
    if (!parent) {
      throw new AppException(ERROR_CODES.BUDGET_AXIS_PARENT_NOT_FOUND, {
        message: `Axe parent ${parentId} introuvable`,
        details: { parentId },
      });
    }
    if (parent.axisType !== axisType) {
      throw new AppException(ERROR_CODES.BUDGET_AXIS_PARENT_TYPE_MISMATCH, {
        message: `Le parent doit être du même type (${axisType})`,
        details: { parentId, expected: axisType, actual: parent.axisType },
      });
    }
  }
}
