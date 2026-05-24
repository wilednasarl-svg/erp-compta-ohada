import { Injectable, Logger } from '@nestjs/common';
import { EntityManager } from 'typeorm';

import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import { AuditTrailService, type AuditContext } from '../../audit/services/audit-trail.service';
import { TvaCodeEntity } from '../entities/tva-code.entity';
import { TvaCodeRepository } from '../repositories/tva-code.repository';
import { DEFAULT_TVA_CODES_CI } from '../types/tva.types';
import { CreateTvaCodeDto } from '../dto/create-tva-code.dto';
import { UpdateTvaCodeDto } from '../dto/update-tva-code.dto';

@Injectable()
export class TvaCodesService {
  private static readonly MODULE = 'tva' as const;
  private readonly logger = new Logger(TvaCodesService.name);

  constructor(
    private readonly tvaCodeRepo: TvaCodeRepository,
    private readonly audit: AuditTrailService,
  ) {}

  /**
   * Seed Côte d'Ivoire standard TVA codes for a new organization.
   * Called inside the OrganizationsService.create transaction.
   */
  async seedDefaultCodes(organizationId: TenantId, manager: EntityManager): Promise<TvaCodeEntity[]> {
    assertTenantId(organizationId);
    const seeded: TvaCodeEntity[] = [];
    for (const codeSpec of DEFAULT_TVA_CODES_CI) {
      const created = await this.tvaCodeRepo.create(
        {
          organizationId,
          code: codeSpec.code,
          label: codeSpec.label,
          rate: codeSpec.rate,
          type: codeSpec.type,
          kind: codeSpec.kind,
          isActive: true,
        },
        manager,
      );
      seeded.push(created);
    }
    this.logger.log(`Seeded ${DEFAULT_TVA_CODES_CI.length} standard TVA codes for org ${organizationId}`);
    return seeded;
  }

  async listForOrg(
    organizationId: TenantId,
    options: { activeOnly?: boolean } = {},
  ): Promise<TvaCodeEntity[]> {
    assertTenantId(organizationId);
    return this.tvaCodeRepo.listByOrganization(organizationId, options);
  }

  async findByCode(organizationId: TenantId, code: string): Promise<TvaCodeEntity> {
    assertTenantId(organizationId);
    const tvaCode = await this.tvaCodeRepo.findByCode(organizationId, code);
    if (!tvaCode) {
      throw new AppException(ERROR_CODES.TVA_CODE_NOT_FOUND, {
        message: `TVA code '${code}' not found in organization.`,
      });
    }
    return tvaCode;
  }

  async findById(id: string, organizationId: TenantId): Promise<TvaCodeEntity> {
    assertTenantId(organizationId);
    const tvaCode = await this.tvaCodeRepo.findById(id, organizationId);
    if (!tvaCode) {
      throw new AppException(ERROR_CODES.TVA_CODE_NOT_FOUND, {
        message: `TVA code with ID '${id}' not found in organization.`,
      });
    }
    return tvaCode;
  }

  async create(
    organizationId: TenantId,
    dto: CreateTvaCodeDto,
    actorId: string,
    ctx: AuditContext,
  ): Promise<TvaCodeEntity> {
    assertTenantId(organizationId);
    const existing = await this.tvaCodeRepo.findByCode(organizationId, dto.code);
    if (existing) {
      throw new AppException(ERROR_CODES.TVA_CODE_TAKEN, {
        message: `TVA code '${dto.code}' already exists in this organization.`,
      });
    }

    const tvaCode = await this.tvaCodeRepo.create({
      organizationId,
      code: dto.code,
      label: dto.label,
      rate: dto.rate,
      type: dto.type,
      kind: dto.kind,
      isActive: dto.isActive ?? true,
    });

    await this.audit
      .record({
        module: TvaCodesService.MODULE,
        action: 'code_created',
        entityType: 'tva_code',
        entityId: tvaCode.id,
        after: {
          code: tvaCode.code,
          label: tvaCode.label,
          rate: tvaCode.rate,
          type: tvaCode.type,
          kind: tvaCode.kind,
          isActive: tvaCode.isActive,
        },
        ctx: { ...ctx, userId: actorId, organizationId },
      })
      .catch((e) => this.logger.warn(`Audit failed: ${String(e)}`));

    return tvaCode;
  }

  async update(
    id: string,
    organizationId: TenantId,
    dto: UpdateTvaCodeDto,
    actorId: string,
    ctx: AuditContext,
  ): Promise<TvaCodeEntity> {
    assertTenantId(organizationId);
    const tvaCode = await this.findById(id, organizationId);

    const before = {
      label: tvaCode.label,
      rate: tvaCode.rate,
      type: tvaCode.type,
      kind: tvaCode.kind,
      isActive: tvaCode.isActive,
    };

    const patch: Partial<TvaCodeEntity> = {};
    if (dto.label !== undefined) patch.label = dto.label;
    if (dto.rate !== undefined) patch.rate = dto.rate;
    if (dto.type !== undefined) patch.type = dto.type;
    if (dto.kind !== undefined) patch.kind = dto.kind;
    if (dto.isActive !== undefined) patch.isActive = dto.isActive;

    const updated = await this.tvaCodeRepo.update(id, organizationId, patch);

    const after = {
      label: updated.label,
      rate: updated.rate,
      type: updated.type,
      kind: updated.kind,
      isActive: updated.isActive,
    };

    // Calculate changed fields only
    const changesBefore: Record<string, unknown> = {};
    const changesAfter: Record<string, unknown> = {};
    for (const key of Object.keys(after) as Array<keyof typeof after>) {
      if (before[key] !== after[key]) {
        changesBefore[key] = before[key];
        changesAfter[key] = after[key];
      }
    }

    if (Object.keys(changesAfter).length > 0) {
      await this.audit
        .record({
          module: TvaCodesService.MODULE,
          action: 'code_updated',
          entityType: 'tva_code',
          entityId: updated.id,
          before: changesBefore,
          after: changesAfter,
          ctx: { ...ctx, userId: actorId, organizationId },
        })
        .catch((e) => this.logger.warn(`Audit failed: ${String(e)}`));
    }

    return updated;
  }
}
