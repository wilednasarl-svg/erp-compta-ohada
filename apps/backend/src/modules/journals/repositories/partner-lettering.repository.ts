import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';

import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import {
  PartnerLetteringEntity,
  type LetteringStatus,
} from '../entities/partner-lettering.entity';

export interface CreateLetteringInput {
  readonly organizationId: TenantId | string;
  readonly letteringCode: string;
  readonly partnerAccountId: string;
  readonly partnerLabel: string;
  readonly totalAmount: string;
  readonly createdById: string;
  readonly status: LetteringStatus;
  readonly completedAt: Date | null;
}

export interface ListLetteringFilters {
  readonly partnerAccountId?: string;
  readonly status?: LetteringStatus;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * `PartnerLetteringRepository` — tenant-scoped CRUD on the
 * `partner_letterings` table.
 *
 * Like every Module 8 repository, every public method routes through
 * `assertTenantId` before touching the inner repo so a missing scope
 * is a 500 with a clear stack rather than a cross-tenant leak.
 *
 * Lines are not modeled here — they live in `JournalEntryLineRepository`
 * (column `lettering_id` on `journal_entry_lines`). The service
 * orchestrates the two repos inside a single transaction.
 */
@Injectable()
export class PartnerLetteringRepository {
  constructor(
    @InjectRepository(PartnerLetteringEntity)
    private readonly repo: Repository<PartnerLetteringEntity>,
  ) {}

  async create(
    input: CreateLetteringInput,
    manager?: EntityManager,
  ): Promise<PartnerLetteringEntity> {
    assertTenantId(input.organizationId);
    const repo = manager ? manager.getRepository(PartnerLetteringEntity) : this.repo;
    const entity = repo.create({
      organizationId: input.organizationId,
      letteringCode: input.letteringCode,
      partnerAccountId: input.partnerAccountId,
      partnerLabel: input.partnerLabel,
      totalAmount: input.totalAmount,
      createdById: input.createdById,
      status: input.status,
      completedAt: input.completedAt,
    });
    return repo.save(entity);
  }

  async findById(
    id: string,
    organizationId: TenantId | string,
  ): Promise<PartnerLetteringEntity | null> {
    assertTenantId(organizationId);
    return this.repo.findOne({ where: { id, organizationId } });
  }

  async listForOrg(
    organizationId: TenantId | string,
    filters: ListLetteringFilters = {},
  ): Promise<PartnerLetteringEntity[]> {
    assertTenantId(organizationId);
    const qb = this.repo
      .createQueryBuilder('l')
      .where('l.organization_id = :organizationId', { organizationId })
      .orderBy('l.created_at', 'DESC')
      .take(filters.limit ?? 50)
      .skip(filters.offset ?? 0);
    if (filters.partnerAccountId !== undefined) {
      qb.andWhere('l.partner_account_id = :partnerAccountId', {
        partnerAccountId: filters.partnerAccountId,
      });
    }
    if (filters.status !== undefined) {
      qb.andWhere('l.status = :status', { status: filters.status });
    }
    return qb.getMany();
  }

  /**
   * Pick the next code (`A0001` → `A0002` → … → `A9999` → `B0001` …)
   * for the given organisation. Bounded scan over the latest 1 row
   * so the next-code computation stays O(1) regardless of history.
   *
   * Returns the new code without persisting — the caller wraps the
   * insert in the same transaction so two concurrent commits can't
   * both pick the same code (the `UNIQUE(org, code)` constraint
   * catches the race; the caller is expected to retry).
   */
  async nextLetteringCode(
    organizationId: TenantId | string,
    manager?: EntityManager,
  ): Promise<string> {
    assertTenantId(organizationId);
    const repo = manager ? manager.getRepository(PartnerLetteringEntity) : this.repo;
    const last = await repo
      .createQueryBuilder('l')
      .where('l.organization_id = :organizationId', { organizationId })
      .orderBy('l.lettering_code', 'DESC')
      .limit(1)
      .getOne();

    if (!last) {
      return 'A0001';
    }
    return PartnerLetteringRepository.incrementCode(last.letteringCode);
  }

  /**
   * `A0001` → `A0002` … `A9999` → `B0001` … `Z9999` → wraps to `A0001`.
   * The unique constraint catches a wrap collision; callers should
   * surface that as a clean error if it ever happens at scale.
   */
  static incrementCode(code: string): string {
    const match = /^([A-Z])(\d{4})$/.exec(code);
    if (!match) {
      return 'A0001';
    }
    const letter = match[1] as string;
    const number = Number.parseInt(match[2] as string, 10);
    if (number < 9999) {
      return `${letter}${String(number + 1).padStart(4, '0')}`;
    }
    if (letter < 'Z') {
      return `${String.fromCharCode(letter.charCodeAt(0) + 1)}0001`;
    }
    return 'A0001';
  }

  async markBroken(
    id: string,
    organizationId: TenantId | string,
    brokenById: string,
    reason: string,
    manager?: EntityManager,
  ): Promise<void> {
    assertTenantId(organizationId);
    const repo = manager ? manager.getRepository(PartnerLetteringEntity) : this.repo;
    await repo.update(
      { id, organizationId },
      {
        status: 'broken',
        brokenAt: new Date(),
        brokenById,
        brokenReason: reason,
      },
    );
  }
}
