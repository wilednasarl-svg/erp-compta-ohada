import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import { AccountingScoreEntity } from '../entities/accounting-score.entity';
import type { ScoreBreakdown, ScoreCalculator, ScoreGrade } from '../types/accounting-score.types';

export interface InsertScoreInput {
  readonly organizationId: TenantId | string;
  readonly exerciseId: string;
  readonly score: number;
  readonly grade: ScoreGrade;
  readonly breakdown: ScoreBreakdown;
  readonly calculatedBy?: ScoreCalculator;
}

@Injectable()
export class AccountingScoreRepository {
  constructor(
    @InjectRepository(AccountingScoreEntity)
    private readonly repo: Repository<AccountingScoreEntity>,
  ) {}

  async insert(input: InsertScoreInput): Promise<AccountingScoreEntity> {
    assertTenantId(input.organizationId);
    const entity = this.repo.create({
      organizationId: input.organizationId,
      exerciseId: input.exerciseId,
      score: input.score,
      grade: input.grade,
      breakdown: input.breakdown,
      calculatedBy: input.calculatedBy ?? 'heuristic_v1',
    });
    return this.repo.save(entity);
  }

  /**
   * Score courant = le plus récent pour (org, exercise). null si jamais
   * calculé.
   */
  async findLatest(
    organizationId: TenantId | string,
    exerciseId: string,
  ): Promise<AccountingScoreEntity | null> {
    assertTenantId(organizationId);
    return this.repo.findOne({
      where: { organizationId, exerciseId },
      order: { calculatedAt: 'DESC' },
    });
  }
}
