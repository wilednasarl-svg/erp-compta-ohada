import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import { JournalEntryLineEntity } from '../../journals/entities/journal-entry-line.entity';

/**
 * Une ligne agrégée par préfixe de compte SYSCOHADA — l'agrégation TVA
 * wave 1 fonctionne par regroupement de comptes (443x, 4452x, 4451x).
 */
export interface TvaAggregationRow {
  readonly accountPrefix: string;
  readonly accountLabel: string | null;
  readonly totalDebit: string;
  readonly totalCredit: string;
}

/**
 * `TvaAggregationRepository` — agrégations TVA sur `journal_entry_lines`.
 *
 * Wave 1 : on parcourt toutes les lignes validées sur la période et on
 * groupe par préfixe de compte. Les sous-comptes héritent de leur racine
 * (4431, 44311, 44312 sont tous "TVA collectée").
 *
 * SECURITY : tenant scope assertÃ© sur chaque méthode publique.
 */
@Injectable()
export class TvaAggregationRepository {
  constructor(
    @InjectRepository(JournalEntryLineEntity)
    private readonly lineRepo: Repository<JournalEntryLineEntity>,
  ) {}

  /**
   * Agrège les mouvements (débit / crédit) par préfixe de compte sur la
   * période [fromDate, toDate]. Seules les écritures `validated` sont
   * comptées — les brouillons n'ont aucun impact fiscal.
   *
   * `prefixes` est un tableau de préfixes à matcher en `LIKE prefix || '%'`.
   * Le SQL est paramétré (ANY array) pour éviter toute injection.
   */
  async aggregateByPrefixes(
    organizationId: TenantId | string,
    fromDate: string,
    toDate: string,
    prefixes: ReadonlyArray<string>,
  ): Promise<TvaAggregationRow[]> {
    assertTenantId(organizationId);

    if (prefixes.length === 0) {
      return [];
    }

    // On joint chaque préfixe via UNNEST + LIKE prefix||'%' pour qu'une
    // ligne dont le compte commence par 4431, 4432, ... soit rattachée
    // au bon groupe. GROUP BY sur le préfixe matché (pas sur a.code) pour
    // que tous les sous-comptes d'un même préfixe partagent une seule
    // ligne agrégée.
    const rows = await this.lineRepo
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
      .select('p.prefix', 'accountPrefix')
      .addSelect(
        // Le label affiché est celui du sous-compte le plus court qui
        // matche le préfixe (typiquement le compte racine 4431 lui-même).
        // MIN sur la longueur sert d'heuristique stable.
        `(
           SELECT a2.label
             FROM organization_chart_accounts a2
            WHERE a2.organization_id = :organizationId
              AND a2.code LIKE p.prefix || '%'
            ORDER BY LENGTH(a2.code) ASC, a2.code ASC
            LIMIT 1
         )`,
        'accountLabel',
      )
      .addSelect(`COALESCE(SUM(l.debit),  0)`, 'totalDebit')
      .addSelect(`COALESCE(SUM(l.credit), 0)`, 'totalCredit')
      .groupBy('p.prefix')
      .orderBy('p.prefix', 'ASC')
      .getRawMany<{
        accountPrefix: string;
        accountLabel: string | null;
        totalDebit: string;
        totalCredit: string;
      }>();

    return rows.map((r) => ({
      accountPrefix: r.accountPrefix,
      accountLabel: r.accountLabel,
      totalDebit: Number(r.totalDebit).toFixed(2),
      totalCredit: Number(r.totalCredit).toFixed(2),
    }));
  }
}
