import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import { JournalEntryLineEntity } from '../../journals/entities/journal-entry-line.entity';
import type { NormalBalance } from '../../accounting-plan/types/accounting-system';

/**
 * Agrégat comptable brut d'un compte sur un mois donné, avant orientation
 * du signe. Montants en string NUMERIC (somme SQL).
 */
export interface ActualAggregateRow {
  readonly accountCode: string;
  readonly accountLabel: string | null;
  readonly accountClass: number;
  readonly normalBalance: NormalBalance;
  readonly isOpposing: boolean;
  /** 1..12 — mois calendaire de la date d'écriture. */
  readonly month: number;
  readonly totalDebit: string;
  readonly totalCredit: string;
}

/**
 * Lecture du réalisé comptable destiné à alimenter le scénario REAL du budget.
 *
 * Agrège les lignes d'écritures **validées** par compte SYSCOHADA × mois, en
 * joignant le plan comptable (code, classe, sens normal) et l'en-tête
 * d'écriture (date, statut, organisation). Les brouillons et écritures
 * annulées sont exclus ; les contre-passations validées sont incluses car
 * elles compensent comptablement les montants qu'elles extournent.
 *
 * Le filtrage par exercice est calendaire (année de `entry_date`) — convention
 * MVP, à raffiner via `accounting_periods` si l'exercice diffère de l'année
 * civile.
 */
@Injectable()
export class BudgetActualsRepository {
  constructor(
    @InjectRepository(JournalEntryLineEntity)
    private readonly lines: Repository<JournalEntryLineEntity>,
  ) {}

  async aggregateActualsByAccountMonth(
    organizationId: TenantId,
    fiscalYear: number,
  ): Promise<ActualAggregateRow[]> {
    assertTenantId(organizationId);

    const rows = await this.lines
      .createQueryBuilder('l')
      .innerJoin('journal_entries', 'e', 'e.id = l.journal_entry_id')
      .innerJoin('organization_chart_accounts', 'a', 'a.id = l.account_id')
      .select('a.code', 'accountCode')
      .addSelect('MAX(a.label)', 'accountLabel')
      .addSelect('a.class', 'accountClass')
      .addSelect('a.normal_balance', 'normalBalance')
      .addSelect('a.is_opposing', 'isOpposing')
      .addSelect('EXTRACT(MONTH FROM e.entry_date)::int', 'month')
      .addSelect('COALESCE(SUM(l.debit), 0)', 'totalDebit')
      .addSelect('COALESCE(SUM(l.credit), 0)', 'totalCredit')
      .where('e.organization_id = :organizationId', { organizationId })
      .andWhere("e.status = 'validated'")
      .andWhere('EXTRACT(YEAR FROM e.entry_date) = :fiscalYear', { fiscalYear })
      .groupBy('a.code')
      .addGroupBy('a.class')
      .addGroupBy('a.normal_balance')
      .addGroupBy('a.is_opposing')
      .addGroupBy('EXTRACT(MONTH FROM e.entry_date)')
      .orderBy('a.code', 'ASC')
      .addOrderBy('month', 'ASC')
      .getRawMany<{
        accountCode: string;
        accountLabel: string | null;
        accountClass: number;
        normalBalance: NormalBalance;
        isOpposing: boolean;
        month: number;
        totalDebit: string;
        totalCredit: string;
      }>();

    return rows.map((r) => ({
      accountCode: r.accountCode,
      accountLabel: r.accountLabel,
      accountClass: Number(r.accountClass),
      normalBalance: r.normalBalance,
      isOpposing: Boolean(r.isOpposing),
      month: Number(r.month),
      totalDebit: r.totalDebit ?? '0',
      totalCredit: r.totalCredit ?? '0',
    }));
  }
}
