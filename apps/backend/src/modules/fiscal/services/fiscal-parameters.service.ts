import { Injectable } from '@nestjs/common';

import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import type { TenantId } from '../../../common/persistence/tenant-scope';
import { FiscalParameterEntity } from '../entities/fiscal-parameter.entity';
import {
  FiscalParameterRepository,
  type CreateFiscalParameterInput,
  type UpdateFiscalParameterInput,
} from '../repositories/fiscal-parameter.repository';
import { CI_DEFAULT_FISCAL_PARAMETERS, type FiscalDeclarationKind } from '../types/fiscal.types';

@Injectable()
export class FiscalParametersService {
  constructor(private readonly params: FiscalParameterRepository) {}

  async list(
    organizationId: TenantId,
    filter: { activeOnly?: boolean; declarationKind?: FiscalDeclarationKind },
  ): Promise<FiscalParameterEntity[]> {
    return this.params.list(organizationId, filter);
  }

  async findById(id: string, organizationId: TenantId): Promise<FiscalParameterEntity> {
    const param = await this.params.findById(id, organizationId);
    if (!param) {
      throw new AppException(ERROR_CODES.FISCAL_PARAMETER_NOT_FOUND, {
        message: `Paramètre fiscal ${id} introuvable`,
        details: { id },
      });
    }
    return param;
  }

  async create(
    organizationId: TenantId,
    input: Omit<CreateFiscalParameterInput, 'organizationId'>,
  ): Promise<FiscalParameterEntity> {
    const existing = await this.params.findByCodeAndDate(
      organizationId,
      input.taxCode,
      input.effectiveFrom,
    );
    if (existing) {
      throw new AppException(ERROR_CODES.FISCAL_PARAMETER_CODE_TAKEN, {
        message: `Un paramètre ${input.taxCode} existe déjà à la date d'effet ${input.effectiveFrom}`,
        details: { taxCode: input.taxCode, effectiveFrom: input.effectiveFrom },
      });
    }
    return this.params.create({ organizationId, ...input });
  }

  async update(
    id: string,
    organizationId: TenantId,
    input: UpdateFiscalParameterInput,
  ): Promise<FiscalParameterEntity> {
    const param = await this.findById(id, organizationId);
    return this.params.update(param, input);
  }

  /**
   * Seede le catalogue de paramètres CI par défaut pour l'exercice courant.
   * Idempotent : ne crée que les codes absents à la date d'effet calculée
   * (1er janvier de `fiscalYear`). Retourne le nombre de paramètres créés.
   */
  async seedDefaults(organizationId: TenantId, fiscalYear: number): Promise<{ created: number }> {
    const effectiveFrom = `${fiscalYear}-01-01`;
    let created = 0;
    for (const def of CI_DEFAULT_FISCAL_PARAMETERS) {
      const exists = await this.params.findByCodeAndDate(
        organizationId,
        def.taxCode,
        effectiveFrom,
      );
      if (exists) continue;
      await this.params.create({
        organizationId,
        taxCode: def.taxCode,
        label: def.label,
        declarationKind: def.declarationKind,
        rate: def.rate,
        baseKind: def.baseKind,
        periodicity: def.periodicity,
        ceiling: def.ceiling ?? null,
        dueDay: def.dueDay ?? 15,
        chargeAccount: def.chargeAccount ?? null,
        liabilityAccount: def.liabilityAccount ?? null,
        effectiveFrom,
        notes: def.notes ?? null,
      });
      created += 1;
    }
    return { created };
  }
}
