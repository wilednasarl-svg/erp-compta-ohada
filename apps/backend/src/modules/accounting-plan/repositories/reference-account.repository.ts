import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { ReferenceAccountEntity } from '../entities/reference-account.entity';
import type { AccountingSystem } from '../types/accounting-system';

/**
 * `ReferenceAccountRepository` (BE-PC-04) — read access to the OHADA
 * SYSCOHADA AUDCIF reference chart.
 *
 * Non-tenant-scoped: this table is a global catalogue shared by every
 * organisation. Writes are intentionally NOT exposed — the only path
 * for changes is a TypeORM migration (the next OHADA reform will
 * touch this table once).
 */
@Injectable()
export class ReferenceAccountRepository {
  constructor(
    @InjectRepository(ReferenceAccountEntity)
    private readonly repo: Repository<ReferenceAccountEntity>,
  ) {}

  /**
   * Return all reference accounts that belong to a given accounting
   * system, ordered by `code` ASC so the consumer can render an
   * arborescence without an extra sort.
   *
   * Implemented with the Postgres `&&` array-overlap operator via raw
   * SQL because TypeORM has no first-class predicate for "array
   * contains element". `qb.where(":system = ANY(applicable_systems)")`
   * keeps the value parameterised — no string concatenation of user
   * data.
   */
  async listBySystem(system: AccountingSystem): Promise<ReferenceAccountEntity[]> {
    return this.repo
      .createQueryBuilder('a')
      .where(':system = ANY(a.applicable_systems)', { system })
      .orderBy('a.code', 'ASC')
      .getMany();
  }

  async findByCode(code: string): Promise<ReferenceAccountEntity | null> {
    return this.repo.findOne({ where: { code } });
  }

  async countAll(): Promise<number> {
    return this.repo.count();
  }
}
