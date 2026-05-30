import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import { JournalEntryLineEntity } from '../../journals/entities/journal-entry-line.entity';

/** Total débit/crédit agrégé sur un ensemble de préfixes de comptes. */
export interface PrefixSum {
  readonly totalDebit: string;
  readonly totalCredit: string;
}

/**
 * Agrège les écritures comptables validées par préfixe de compte SYSCOHADA,
 * sur une période. Réutilise la même mécanique que l'agrégation TVA
 * (`a.code LIKE prefix || '%'`) pour que les sous-comptes héritent de leur
 * racine. Seules les écritures `validated` comptent (les brouillons n'ont
 * aucun impact fiscal).
 */
@Injectable()
export class FiscalBaseRepository {
  constructor(
    @InjectRepository(JournalEntryLineEntity)
    private readonly lineRepo: Repository<JournalEntryLineEntity>,
  ) {}

  async sumByPrefixes(
    organizationId: TenantId | string,
    fromDate: string,
    toDate: string,
    prefixes: ReadonlyArray<string>,
  ): Promise<PrefixSum> {
    assertTenantId(organizationId);
    if (prefixes.length === 0) {
      return { totalDebit: '0', totalCredit: '0' };
    }

    const row = await this.lineRepo
      .createQueryBuilder('l')
      .innerJoin('journal_entries', 'e', 'e.id = l.journal_entry_id')
      .innerJoin('organization_chart_accounts', 'a', 'a.id = l.account_id')
      .innerJoin('(SELECT UNNEST(:prefixes::text[]) AS prefix)', 'p', `a.code LIKE p.prefix || '%'`)
      .where('l.organization_id = :organizationId', { organizationId })
      .andWhere(`e.status = 'validated'`)
      .andWhere(`e.entry_date >= :fromDate::date AND e.entry_date <= :toDate::date`, {
        fromDate,
        toDate,
      })
      .setParameter('prefixes', [...prefixes])
      .select(`COALESCE(SUM(l.debit), 0)`, 'totalDebit')
      .addSelect(`COALESCE(SUM(l.credit), 0)`, 'totalCredit')
      .getRawOne<{ totalDebit: string; totalCredit: string }>();

    return {
      totalDebit: row?.totalDebit ?? '0',
      totalCredit: row?.totalCredit ?? '0',
    };
  }
}
