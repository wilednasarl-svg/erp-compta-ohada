import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import { OrganizationAccountingConfigEntity } from '../entities/organization-accounting-config.entity';
import type { AccountingSystem } from '../types/accounting-system';

/**
 * `OrganizationAccountingConfigRepository` (BE-PC-04) — 1-1 row with
 * `organizations`. Created at organisation creation time, never
 * updated (the system is frozen — see design D2).
 *
 * Effectively tenant-scoped (PK = `organization_id`), so every method
 * runs `assertTenantId` first and accepts the `TenantId | string`
 * brand. Matches the pattern from `InvitationRepository` /
 * `OrganizationAccountRepository`.
 */
@Injectable()
export class OrganizationAccountingConfigRepository {
  constructor(
    @InjectRepository(OrganizationAccountingConfigEntity)
    private readonly repo: Repository<OrganizationAccountingConfigEntity>,
  ) {}

  async findByOrganizationId(
    organizationId: TenantId | string,
  ): Promise<OrganizationAccountingConfigEntity | null> {
    assertTenantId(organizationId);
    return this.repo.findOne({ where: { organizationId } });
  }

  async create(input: {
    organizationId: TenantId | string;
    system: AccountingSystem;
  }): Promise<OrganizationAccountingConfigEntity> {
    assertTenantId(input.organizationId);
    const entity = this.repo.create({
      organizationId: input.organizationId,
      system: input.system,
    });
    return this.repo.save(entity);
  }
}
