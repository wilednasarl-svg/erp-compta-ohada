import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import { JournalEntryLineEntity } from '../../journals/entities/journal-entry-line.entity';

/**
 * Raw aggregation row : un net par classe OHADA dans une fenêtre date.
 */
export interface ClassNetRow {
  readonly accountClass: number;
  readonly totalDebit: string;
  readonly totalCredit: string;
}

/**
 * Net par préfixe de code (utile pour 40x = fournisseurs, 41x = clients,
 * 51x/53x = trésorerie). `accountCodePrefix` est passé à `LIKE
 * <prefix>%`.
 */
export interface CodePrefixNetRow {
  readonly totalDebit: string;
  readonly totalCredit: string;
}

/**
 * Row aging brute : une ligne par écriture non-lettrée, avec son net
 * signé (debit - credit) et son ancienneté en jours.
 */
export interface AgingLineRow {
  readonly accountId: string;
  readonly accountCode: string;
  readonly accountLabel: string;
  readonly netSigned: string; // debit - credit, peut être négatif
  readonly daysOld: number;
}

/**
 * Bucket mensuel sur préfixes de codes (wave 2 — cashflow).
 * `month` est la date du 1er du mois (DATE PG).
 */
export interface MonthlyPrefixRow {
  readonly month: string;
  readonly totalDebit: string;
  readonly totalCredit: string;
}

/**
 * Bucket mensuel par classe (wave 2 — évolution P&L). On charge en une
 * seule requête classes 6 et 7 + un GROUP BY (month, class).
 */
export interface MonthlyClassRow {
  readonly month: string;
  readonly accountClass: number;
  readonly totalDebit: string;
  readonly totalCredit: string;
}

/**
 * Top-N comptes par flux dans une classe (wave 2 — drill-down /
 * camembert / horizontal bar).
 */
export interface TopAccountFlowRow {
  readonly accountId: string;
  readonly accountCode: string;
  readonly accountLabel: string;
  readonly totalDebit: string;
  readonly totalCredit: string;
}

@Injectable()
export class DashboardsRepository {
  constructor(
    @InjectRepository(JournalEntryLineEntity)
    private readonly lineRepo: Repository<JournalEntryLineEntity>,
  ) {}

  /**
   * Somme debit/credit groupée par classe (1-9), pour les écritures
   * `validated` dont la date est dans `[fromDate, toDate]`.
   *
   * Le service interpréte le sens du net selon la convention de
   * chaque classe : 5x → débit naturel (cash), 6x → débit (charges),
   * 7x → crédit (produits), 40x → crédit (dettes), 41x → débit
   * (créances).
   */
  async aggregateByClass(
    organizationId: TenantId | string,
    fromDate: string,
    toDate: string,
    classes: readonly number[],
  ): Promise<ClassNetRow[]> {
    assertTenantId(organizationId);
    if (classes.length === 0) return [];

    const rows = await this.lineRepo
      .createQueryBuilder('l')
      .innerJoin('journal_entries', 'e', 'e.id = l.journal_entry_id')
      .innerJoin('organization_chart_accounts', 'a', 'a.id = l.account_id')
      .where('l.organization_id = :organizationId', { organizationId })
      .andWhere(`e.status = 'validated'`)
      .andWhere(`e.entry_date >= :fromDate::date`, { fromDate })
      .andWhere(`e.entry_date <= :toDate::date`, { toDate })
      .andWhere(`a.class IN (:...classes)`, { classes: classes as number[] })
      .select('a.class', 'accountClass')
      .addSelect('COALESCE(SUM(l.debit), 0)', 'totalDebit')
      .addSelect('COALESCE(SUM(l.credit), 0)', 'totalCredit')
      .groupBy('a.class')
      .getRawMany<{
        accountClass: string | number;
        totalDebit: string;
        totalCredit: string;
      }>();

    return rows.map((r) => ({
      accountClass: Number(r.accountClass),
      totalDebit: r.totalDebit,
      totalCredit: r.totalCredit,
    }));
  }

  /**
   * Somme debit/credit pour les comptes dont le `code` commence par
   * l'un des préfixes passés. La fenêtre date est habituellement
   * "cumulatif depuis le début" (snapshot au `toDate`) pour les soldes
   * de bilan (cash, clients, fournisseurs) — donc on n'impose pas
   * de borne basse.
   */
  async aggregateByCodePrefix(
    organizationId: TenantId | string,
    toDate: string,
    codePrefixes: readonly string[],
  ): Promise<CodePrefixNetRow> {
    assertTenantId(organizationId);
    if (codePrefixes.length === 0) {
      return { totalDebit: '0', totalCredit: '0' };
    }

    const qb = this.lineRepo
      .createQueryBuilder('l')
      .innerJoin('journal_entries', 'e', 'e.id = l.journal_entry_id')
      .innerJoin('organization_chart_accounts', 'a', 'a.id = l.account_id')
      .where('l.organization_id = :organizationId', { organizationId })
      .andWhere(`e.status = 'validated'`)
      .andWhere(`e.entry_date <= :toDate::date`, { toDate })
      .select('COALESCE(SUM(l.debit), 0)', 'totalDebit')
      .addSelect('COALESCE(SUM(l.credit), 0)', 'totalCredit');

    // Construit dynamiquement le OR (a.code LIKE prefix%).
    const orParts = codePrefixes.map((_, i) => `a.code LIKE :prefix${i}`).join(' OR ');
    const params: Record<string, string> = {};
    codePrefixes.forEach((p, i) => {
      params[`prefix${i}`] = `${p}%`;
    });
    qb.andWhere(`(${orParts})`, params);

    const row = await qb.getRawOne<{
      totalDebit: string;
      totalCredit: string;
    }>();

    return {
      totalDebit: row?.totalDebit ?? '0',
      totalCredit: row?.totalCredit ?? '0',
    };
  }

  /**
   * Lignes non-lettrées sur des comptes dont le code commence par
   * `codePrefix` (= '41' pour clients, '40' pour fournisseurs).
   *
   * Renvoie une ligne par tuple (line_id) avec l'ancienneté calculée
   * en SQL via `(asOfDate::date - e.entry_date)::int`. Les lignes
   * lettrées (letteringId NOT NULL) sont exclues — elles ont été
   * compensées et ne représentent plus un solde dû.
   *
   * Le `netSigned` est `debit - credit` ; côté service on prend la
   * valeur ABS pour clients (créance = débit), et on inverse le signe
   * pour fournisseurs (dette = crédit).
   */
  async unletteredLinesByCodePrefix(
    organizationId: TenantId | string,
    fromDate: string,
    toDate: string,
    asOfDate: string,
    codePrefix: string,
  ): Promise<AgingLineRow[]> {
    assertTenantId(organizationId);

    const rows = await this.lineRepo
      .createQueryBuilder('l')
      .innerJoin('journal_entries', 'e', 'e.id = l.journal_entry_id')
      .innerJoin('organization_chart_accounts', 'a', 'a.id = l.account_id')
      .where('l.organization_id = :organizationId', { organizationId })
      .andWhere(`e.status = 'validated'`)
      .andWhere(`e.entry_date >= :fromDate::date`, { fromDate })
      .andWhere(`e.entry_date <= :toDate::date`, { toDate })
      .andWhere(`l.lettering_id IS NULL`)
      .andWhere(`a.code LIKE :prefix`, { prefix: `${codePrefix}%` })
      .select('a.id', 'accountId')
      .addSelect('a.code', 'accountCode')
      .addSelect('a.label', 'accountLabel')
      .addSelect('(l.debit - l.credit)', 'netSigned')
      .addSelect(`(:asOfDate::date - e.entry_date)::int`, 'daysOld')
      .setParameter('asOfDate', asOfDate)
      .getRawMany<{
        accountId: string;
        accountCode: string;
        accountLabel: string;
        netSigned: string;
        daysOld: string | number;
      }>();

    return rows.map((r) => ({
      accountId: r.accountId,
      accountCode: r.accountCode,
      accountLabel: r.accountLabel,
      netSigned: r.netSigned,
      daysOld: Number(r.daysOld),
    }));
  }

  // ─── Wave 2 — time-series + top-N ───────────────────────────────

  /**
   * Buckets mensuels sur préfixes de comptes (cash flow). Renvoie
   * UN row par mois ayant eu de l'activité ; les mois vides sont
   * absents — le service les remplit avec 0 côté JS pour avoir une
   * série continue prête à plotter.
   *
   * `date_trunc('month', e.entry_date)` est PG-natif et utilise
   * l'index sur `entry_date` correctement.
   */
  async monthlyAggregateByCodePrefix(
    organizationId: TenantId | string,
    fromDate: string,
    toDate: string,
    codePrefixes: readonly string[],
  ): Promise<MonthlyPrefixRow[]> {
    assertTenantId(organizationId);
    if (codePrefixes.length === 0) return [];

    const qb = this.lineRepo
      .createQueryBuilder('l')
      .innerJoin('journal_entries', 'e', 'e.id = l.journal_entry_id')
      .innerJoin('organization_chart_accounts', 'a', 'a.id = l.account_id')
      .where('l.organization_id = :organizationId', { organizationId })
      .andWhere(`e.status = 'validated'`)
      .andWhere(`e.entry_date >= :fromDate::date`, { fromDate })
      .andWhere(`e.entry_date <= :toDate::date`, { toDate })
      .select(`date_trunc('month', e.entry_date)::date::text`, 'month')
      .addSelect('COALESCE(SUM(l.debit), 0)', 'totalDebit')
      .addSelect('COALESCE(SUM(l.credit), 0)', 'totalCredit')
      .groupBy(`date_trunc('month', e.entry_date)`)
      .orderBy(`date_trunc('month', e.entry_date)`, 'ASC');

    // OR dynamique sur les préfixes (même pattern que aggregateByCodePrefix).
    const orParts = codePrefixes.map((_, i) => `a.code LIKE :prefix${i}`).join(' OR ');
    const params: Record<string, string> = {};
    codePrefixes.forEach((p, i) => {
      params[`prefix${i}`] = `${p}%`;
    });
    qb.andWhere(`(${orParts})`, params);

    return qb.getRawMany<MonthlyPrefixRow>();
  }

  /**
   * Buckets mensuels par classe (P&L evolution). UN row par (month,
   * class) ayant eu de l'activité. Le service pivote en série
   * mensuelle continue avec revenue/expense par mois.
   */
  async monthlyAggregateByClass(
    organizationId: TenantId | string,
    fromDate: string,
    toDate: string,
    classes: readonly number[],
  ): Promise<MonthlyClassRow[]> {
    assertTenantId(organizationId);
    if (classes.length === 0) return [];

    const rows = await this.lineRepo
      .createQueryBuilder('l')
      .innerJoin('journal_entries', 'e', 'e.id = l.journal_entry_id')
      .innerJoin('organization_chart_accounts', 'a', 'a.id = l.account_id')
      .where('l.organization_id = :organizationId', { organizationId })
      .andWhere(`e.status = 'validated'`)
      .andWhere(`e.entry_date >= :fromDate::date`, { fromDate })
      .andWhere(`e.entry_date <= :toDate::date`, { toDate })
      .andWhere(`a.class IN (:...classes)`, { classes: classes as number[] })
      .select(`date_trunc('month', e.entry_date)::date::text`, 'month')
      .addSelect('a.class', 'accountClass')
      .addSelect('COALESCE(SUM(l.debit), 0)', 'totalDebit')
      .addSelect('COALESCE(SUM(l.credit), 0)', 'totalCredit')
      .groupBy(`date_trunc('month', e.entry_date)`)
      .addGroupBy('a.class')
      .orderBy(`date_trunc('month', e.entry_date)`, 'ASC')
      .getRawMany<{
        month: string;
        accountClass: string | number;
        totalDebit: string;
        totalCredit: string;
      }>();

    return rows.map((r) => ({
      month: r.month,
      accountClass: Number(r.accountClass),
      totalDebit: r.totalDebit,
      totalCredit: r.totalCredit,
    }));
  }

  /**
   * Top N comptes par flux total dans une classe. Pas de sens du tri
   * en SQL — le service trie post-fetch selon la convention de la
   * catégorie (expenses → tri par débit desc, revenue → crédit desc).
   *
   * On limit en SQL à 200 (raisonnable pour 99% des orgs) puis on
   * filtre + sort + slice côté JS.
   */
  async accountFlowsByClass(
    organizationId: TenantId | string,
    fromDate: string,
    toDate: string,
    accountClass: number,
  ): Promise<TopAccountFlowRow[]> {
    assertTenantId(organizationId);

    return this.lineRepo
      .createQueryBuilder('l')
      .innerJoin('journal_entries', 'e', 'e.id = l.journal_entry_id')
      .innerJoin('organization_chart_accounts', 'a', 'a.id = l.account_id')
      .where('l.organization_id = :organizationId', { organizationId })
      .andWhere(`e.status = 'validated'`)
      .andWhere(`e.entry_date >= :fromDate::date`, { fromDate })
      .andWhere(`e.entry_date <= :toDate::date`, { toDate })
      .andWhere('a.class = :accountClass', { accountClass })
      .select('a.id', 'accountId')
      .addSelect('a.code', 'accountCode')
      .addSelect('a.label', 'accountLabel')
      .addSelect('COALESCE(SUM(l.debit), 0)', 'totalDebit')
      .addSelect('COALESCE(SUM(l.credit), 0)', 'totalCredit')
      .groupBy('a.id')
      .addGroupBy('a.code')
      .addGroupBy('a.label')
      .limit(200)
      .getRawMany<TopAccountFlowRow>();
  }
}
