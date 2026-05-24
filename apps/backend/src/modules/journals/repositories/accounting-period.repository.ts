import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, IsNull, Repository } from 'typeorm';

import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import { AccountingPeriodEntity } from '../entities/accounting-period.entity';
import type { AccountingPeriodKind } from '../types/journal.types';

export interface CreatePeriodInput {
  readonly organizationId: TenantId | string;
  readonly parentId: string | null;
  readonly kind: AccountingPeriodKind;
  readonly label: string;
  readonly startDate: string;
  readonly endDate: string;
}

@Injectable()
export class AccountingPeriodRepository {
  constructor(
    @InjectRepository(AccountingPeriodEntity)
    private readonly repo: Repository<AccountingPeriodEntity>,
  ) {}

  /**
   * Crée une période. Accepte un `EntityManager` optionnel pour joindre
   * la transaction de création d'exercice (parent + enfants en un seul flush).
   */
  async create(input: CreatePeriodInput, manager?: EntityManager): Promise<AccountingPeriodEntity> {
    assertTenantId(input.organizationId);
    const repo = manager ? manager.getRepository(AccountingPeriodEntity) : this.repo;
    const entity = repo.create({
      organizationId: input.organizationId,
      parentId: input.parentId,
      kind: input.kind,
      label: input.label,
      startDate: input.startDate,
      endDate: input.endDate,
      status: 'open',
    });
    return repo.save(entity);
  }

  async findById(
    id: string,
    organizationId: TenantId | string,
  ): Promise<AccountingPeriodEntity | null> {
    assertTenantId(organizationId);
    return this.repo.findOne({ where: { id, organizationId } });
  }

  async findContainingDate(
    organizationId: TenantId | string,
    date: string,
    kind?: AccountingPeriodKind,
  ): Promise<AccountingPeriodEntity | null> {
    assertTenantId(organizationId);
    const qb = this.repo
      .createQueryBuilder('p')
      .where('p.organization_id = :organizationId', { organizationId })
      .andWhere('p.start_date <= :date', { date })
      .andWhere('p.end_date >= :date', { date });

    if (kind) {
      qb.andWhere('p.kind = :kind', { kind });
    } else {
      // Prefer the finest-grained period (MONTHLY > QUARTERLY > ANNUAL)
      qb.orderBy(
        `CASE p.kind
          WHEN 'MONTHLY' THEN 1
          WHEN 'QUARTERLY' THEN 2
          WHEN 'ANNUAL' THEN 3
          ELSE 4
        END`,
        'ASC',
      );
    }

    return qb.getOne();
  }

  async listByOrganization(organizationId: TenantId | string): Promise<AccountingPeriodEntity[]> {
    assertTenantId(organizationId);
    return this.repo.find({
      where: { organizationId },
      order: { startDate: 'DESC', kind: 'ASC' },
    });
  }

  async listChildren(parentId: string): Promise<AccountingPeriodEntity[]> {
    return this.repo.find({ where: { parentId }, order: { startDate: 'ASC' } });
  }

  async listAnnualRoots(organizationId: TenantId | string): Promise<AccountingPeriodEntity[]> {
    assertTenantId(organizationId);
    return this.repo.find({
      where: { organizationId, parentId: IsNull(), kind: 'ANNUAL' },
      order: { startDate: 'DESC' },
    });
  }

  async closePeriod(id: string, closedBy: string | null): Promise<void> {
    await this.repo.update(
      { id },
      { status: 'closed', closedAt: new Date(), closedBy, reopenedReason: null },
    );
  }

  async reopenPeriod(id: string, reason: string): Promise<void> {
    await this.repo.update(
      { id },
      { status: 'open', closedAt: null, closedBy: null, reopenedReason: reason },
    );
  }
}
