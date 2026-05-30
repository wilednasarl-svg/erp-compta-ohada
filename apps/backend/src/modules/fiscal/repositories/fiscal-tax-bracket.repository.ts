import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import { FiscalTaxBracketEntity } from '../entities/fiscal-tax-bracket.entity';

export interface BracketInput {
  readonly bracketOrder: number;
  readonly fromAmount: string;
  readonly toAmount: string | null;
  readonly rate: string;
}

@Injectable()
export class FiscalTaxBracketRepository {
  constructor(
    @InjectRepository(FiscalTaxBracketEntity)
    private readonly repo: Repository<FiscalTaxBracketEntity>,
    private readonly dataSource: DataSource,
  ) {}

  async list(
    organizationId: TenantId | string,
    taxCode: string,
  ): Promise<FiscalTaxBracketEntity[]> {
    assertTenantId(organizationId);
    return this.repo.find({
      where: { organizationId, taxCode },
      order: { effectiveFrom: 'DESC', bracketOrder: 'ASC' },
    });
  }

  /** Tranches applicables à une date (barème actif le plus récent). */
  async findEffective(
    organizationId: TenantId | string,
    taxCode: string,
    onDate: string,
  ): Promise<FiscalTaxBracketEntity[]> {
    assertTenantId(organizationId);
    const latest = await this.repo
      .createQueryBuilder('b')
      .select('MAX(b.effective_from)', 'eff')
      .where('b.organization_id = :organizationId', { organizationId })
      .andWhere('b.tax_code = :taxCode', { taxCode })
      .andWhere('b.effective_from <= :onDate', { onDate })
      .getRawOne<{ eff: string | null }>();

    if (!latest?.eff) return [];

    return this.repo.find({
      where: { organizationId, taxCode, effectiveFrom: latest.eff },
      order: { bracketOrder: 'ASC' },
    });
  }

  /**
   * Remplace atomiquement le barème d'un impôt à une date d'effet : supprime
   * les tranches existantes pour (org, taxCode, effectiveFrom) puis insère
   * le nouveau jeu. Transaction pour éviter un barème partiel.
   */
  async replace(
    organizationId: TenantId | string,
    taxCode: string,
    effectiveFrom: string,
    brackets: ReadonlyArray<BracketInput>,
  ): Promise<FiscalTaxBracketEntity[]> {
    assertTenantId(organizationId);
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(FiscalTaxBracketEntity);
      await repo.delete({ organizationId, taxCode, effectiveFrom });
      const entities = brackets.map((b) =>
        repo.create({
          organizationId,
          taxCode,
          effectiveFrom,
          bracketOrder: b.bracketOrder,
          fromAmount: b.fromAmount,
          toAmount: b.toAmount,
          rate: b.rate,
        }),
      );
      return repo.save(entities);
    });
  }

  async countForDate(
    organizationId: TenantId | string,
    taxCode: string,
    effectiveFrom: string,
  ): Promise<number> {
    assertTenantId(organizationId);
    return this.repo.count({ where: { organizationId, taxCode, effectiveFrom } });
  }
}
