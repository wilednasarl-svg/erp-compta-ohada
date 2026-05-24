import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { OrganizationAccountingConfigEntity } from '../entities/organization-accounting-config.entity';
import type { AccountingSystem } from '../types/accounting-system';

/**
 * `OrganizationAccountingConfigRepository` (BE-PC-04) — 1-1 row with
 * `organizations`. Created at organisation creation time, never
 * updated (the system is frozen — see design D2).
 */
@Injectable()
export class OrganizationAccountingConfigRepository {
  constructor(
    @InjectRepository(OrganizationAccountingConfigEntity)
    private readonly repo: Repository<OrganizationAccountingConfigEntity>,
  ) {}

  async findByOrganizationId(
    organizationId: string,
  ): Promise<OrganizationAccountingConfigEntity | null> {
    return this.repo.findOne({ where: { organizationId } });
  }

  async create(input: {
    organizationId: string;
    system: AccountingSystem;
  }): Promise<OrganizationAccountingConfigEntity> {
    const entity = this.repo.create({
      organizationId: input.organizationId,
      system: input.system,
    });
    return this.repo.save(entity);
  }
}
