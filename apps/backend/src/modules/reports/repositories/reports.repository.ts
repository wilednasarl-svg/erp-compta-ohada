import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import { JournalEntryLineEntity } from '../../journals/entities/journal-entry-line.entity';

/**
 * Aggregated trial-balance row, one per organization-chart account.
 * Money columns are returned as `string` to preserve DECIMAL(15,2)
 * precision across the wire — clients should format display-side.
 */
export interface TrialBalanceRow {
  readonly accountId: string;
  readonly accountCode: string;
  readonly accountLabel: string;
  readonly accountClass: number;
  readonly openingDebit: string;
  readonly openingCredit: string;
  readonly periodDebit: string;
  readonly periodCredit: string;
  readonly endingDebit: string;
  readonly endingCredit: string;
}

/**
 * A single line of the general-ledger drill-down, in chronological
 * order. `runningBalance` is computed in the service since SQL
 * window-functions are heavier than a sequential JS reduce here.
 */
export interface GeneralLedgerRow {
  readonly lineId: string;
  readonly entryId: string;
  readonly entryDate: string;
  readonly journalCode: string;
  readonly entryNumber: number;
  readonly description: string | null;
  readonly debit: string;
  readonly credit: string;
  readonly letteringCode: string | null;
}

export interface TrialBalanceFilters {
  readonly fromDate: string;
  readonly toDate: string;
  /** Only return accounts in this OHADA class (1-9). Optional. */
  readonly accountClass?: number;
  /** Inclusive lower bound on `code`. Optional. */
  readonly accountCodeFrom?: string;
  /** Inclusive upper bound on `code`. Optional. */
  readonly accountCodeTo?: string;
  /** Skip accounts that have no movement and no opening. */
  readonly hideEmpty?: boolean;
  /** Optional analytic axis filter (Migration 0092). Filtre les lignes
   *  par type d'axe analytique (CHANTIER, BU, ACTIVITE, PROJET). */
  readonly analyticAxisType?: string;
  /** Optional analytic axis code filter — typiquement associé à
   *  `analyticAxisType` pour cibler un chantier / une BU spécifique. */
  readonly analyticAxisCode?: string;
}

export interface GeneralLedgerFilters {
  readonly accountId: string;
  readonly fromDate: string;
  readonly toDate: string;
}

/**
 * Agrégat de validité d'une période (AC-V5), calculé AVANT génération.
 * Money columns en `string` pour préserver DECIMAL(15,2). `lastMovementDate`
 * est `null` quand la période ne contient aucune écriture validée.
 */
export interface PeriodValidityAggregate {
  readonly committedEntries: number;
  readonly totalDebit: string;
  readonly totalCredit: string;
  readonly lastMovementDate: string | null;
}

/**
 * Import session header for the diagnostic report. Only the columns the
 * report cares about — full session entity is loaded by the imports
 * module elsewhere.
 */
export interface ImportSessionMeta {
  readonly id: string;
  readonly label: string | null;
  readonly status: string;
  readonly sourceType: string;
  readonly documentType: string | null;
  readonly totalLines: number;
  readonly errorLines: number;
  readonly createdAt: Date;
}

/**
 * Raw staging row needed to compute the import diagnostic (balance par
 * compte + anomalies). `mappedValues` and `errors` are JSONB columns
 * that staging surfaces in their typed form — see the imports module
 * for the canonical `MappedRow` / `ValidationError` shapes.
 */
export interface ImportStagingRow {
  readonly rowNumber: number;
  readonly mappedValues: Record<string, string | null>;
  readonly errors: ReadonlyArray<{
    readonly code: string;
    readonly message: string;
    readonly field?: string;
  }>;
}

/**
 * `ReportsRepository` — Module 9 wave 1 read-only aggregations over
 * `journal_entry_lines` joined with `journal_entries` (status filter)
 * and `organization_chart_accounts` (label / class).
 *
 * SECURITY: every public method takes `organizationId: TenantId` and
 * scopes every query on `organization_id`. `assertTenantId` runs first
 * so a missing scope crashes with a clear stack rather than leaking
 * cross-tenant data.
 *
 * IMMUTABILITY: only validated entries contribute. Drafts must be
 * validated (or cancelled) before they appear in any report — that is
 * the contract Module 8 enforces via the state machine.
 *
 * Performance: both methods use `getRawMany()` to bypass entity
 * hydration since the output is fully projected. Indexes
 * `ix_journal_entry_lines_org_account` + `ix_journal_entries_org_date`
 * cover the typical access pattern.
 */
@Injectable()
export class ReportsRepository {
  constructor(
    @InjectRepository(JournalEntryLineEntity)
    private readonly lineRepo: Repository<JournalEntryLineEntity>,
  ) {}

  async trialBalance(
    organizationId: TenantId | string,
    filters: TrialBalanceFilters,
  ): Promise<TrialBalanceRow[]> {
    assertTenantId(organizationId);

    // Single query that emits per-account opening (entries strictly
    // before fromDate) + period (entries in [fromDate, toDate]).
    // The GROUP BY is on account; the conditional SUMs partition by
    // date window. Joins are inner so accounts with no movement are
    // naturally excluded (use a separate left-joined query if we
    // ever want "all accounts including zero rows").
    const qb = this.lineRepo
      .createQueryBuilder('l')
      .innerJoin('journal_entries', 'e', 'e.id = l.journal_entry_id')
      .innerJoin('organization_chart_accounts', 'a', 'a.id = l.account_id')
      .where('l.organization_id = :organizationId', { organizationId })
      .andWhere(`e.status = 'validated'`)
      .andWhere(`e.entry_date <= :toDate::date`, { toDate: filters.toDate })
      .select('a.id', 'accountId')
      .addSelect('a.code', 'accountCode')
      .addSelect('a.label', 'accountLabel')
      .addSelect('a.class', 'accountClass')
      .addSelect(
        `COALESCE(SUM(CASE WHEN e.entry_date < :fromDate::date THEN l.debit  ELSE 0 END), 0)`,
        'openingDebit',
      )
      .addSelect(
        `COALESCE(SUM(CASE WHEN e.entry_date < :fromDate::date THEN l.credit ELSE 0 END), 0)`,
        'openingCredit',
      )
      .addSelect(
        `COALESCE(SUM(CASE WHEN e.entry_date >= :fromDate::date AND e.entry_date <= :toDate::date THEN l.debit  ELSE 0 END), 0)`,
        'periodDebit',
      )
      .addSelect(
        `COALESCE(SUM(CASE WHEN e.entry_date >= :fromDate::date AND e.entry_date <= :toDate::date THEN l.credit ELSE 0 END), 0)`,
        'periodCredit',
      )
      .setParameter('fromDate', filters.fromDate)
      .groupBy('a.id')
      .addGroupBy('a.code')
      .addGroupBy('a.label')
      .addGroupBy('a.class')
      .orderBy('a.code', 'ASC');

    if (filters.accountClass !== undefined) {
      qb.andWhere('a.class = :accountClass', { accountClass: filters.accountClass });
    }
    if (filters.accountCodeFrom !== undefined) {
      qb.andWhere('a.code >= :codeFrom', { codeFrom: filters.accountCodeFrom });
    }
    if (filters.accountCodeTo !== undefined) {
      qb.andWhere('a.code <= :codeTo', { codeTo: filters.accountCodeTo });
    }
    if (filters.analyticAxisType !== undefined) {
      qb.andWhere('l.analytic_axis_type = :axisType', {
        axisType: filters.analyticAxisType,
      });
    }
    if (filters.analyticAxisCode !== undefined) {
      qb.andWhere('l.analytic_axis_code = :axisCode', {
        axisCode: filters.analyticAxisCode,
      });
    }

    const rows = await qb.getRawMany<{
      accountId: string;
      accountCode: string;
      accountLabel: string;
      accountClass: string | number;
      openingDebit: string;
      openingCredit: string;
      periodDebit: string;
      periodCredit: string;
    }>();

    return rows.map((r) => {
      const openingD = Number(r.openingDebit);
      const openingC = Number(r.openingCredit);
      const periodD = Number(r.periodDebit);
      const periodC = Number(r.periodCredit);
      const endingD = openingD + periodD;
      const endingC = openingC + periodC;
      const net = endingD - endingC;
      return {
        accountId: r.accountId,
        accountCode: r.accountCode,
        accountLabel: r.accountLabel,
        accountClass: Number(r.accountClass),
        openingDebit: openingD.toFixed(2),
        openingCredit: openingC.toFixed(2),
        periodDebit: periodD.toFixed(2),
        periodCredit: periodC.toFixed(2),
        // Convention SYSCOHADA : présenter le solde du côté naturel ;
        // un compte avec net > 0 est en débit, net < 0 en crédit. Les
        // deux côtés ne sont jamais positifs simultanément à la sortie.
        endingDebit: (net > 0 ? net : 0).toFixed(2),
        endingCredit: (net < 0 ? -net : 0).toFixed(2),
      };
    });
  }

  /**
   * Validité de la période sur les seules écritures `validated` (AC-V5).
   * Une requête agrégée unique : compte d'écritures distinctes, Σ débit,
   * Σ crédit et date du dernier mouvement sur [fromDate, toDate]. Sert à
   * l'indice pré-génération du Report Console — l'invariant Σdébit=Σcrédit
   * vaut sur n'importe quelle fenêtre (chaque écriture s'équilibre), donc un
   * écart non nul révèle une corruption de données plutôt qu'un déséquilibre
   * comptable normal.
   */
  async periodValidity(
    organizationId: TenantId | string,
    filters: { readonly fromDate: string; readonly toDate: string },
  ): Promise<PeriodValidityAggregate> {
    assertTenantId(organizationId);

    const row = await this.lineRepo
      .createQueryBuilder('l')
      .innerJoin('journal_entries', 'e', 'e.id = l.journal_entry_id')
      .where('l.organization_id = :organizationId', { organizationId })
      .andWhere(`e.status = 'validated'`)
      .andWhere(`e.entry_date >= :fromDate::date AND e.entry_date <= :toDate::date`, {
        fromDate: filters.fromDate,
        toDate: filters.toDate,
      })
      .select('COUNT(DISTINCT e.id)', 'committedEntries')
      .addSelect('COALESCE(SUM(l.debit), 0)', 'totalDebit')
      .addSelect('COALESCE(SUM(l.credit), 0)', 'totalCredit')
      .addSelect(`TO_CHAR(MAX(e.entry_date), 'YYYY-MM-DD')`, 'lastMovementDate')
      .getRawOne<{
        committedEntries: string;
        totalDebit: string;
        totalCredit: string;
        lastMovementDate: string | null;
      }>();

    return {
      committedEntries: Number(row?.committedEntries ?? 0),
      totalDebit: Number(row?.totalDebit ?? 0).toFixed(2),
      totalCredit: Number(row?.totalCredit ?? 0).toFixed(2),
      lastMovementDate: row?.lastMovementDate ?? null,
    };
  }

  async generalLedger(
    organizationId: TenantId | string,
    filters: GeneralLedgerFilters,
  ): Promise<GeneralLedgerRow[]> {
    assertTenantId(organizationId);

    const rows = await this.lineRepo
      .createQueryBuilder('l')
      .innerJoin('journal_entries', 'e', 'e.id = l.journal_entry_id')
      .innerJoin('journals', 'j', 'j.id = e.journal_id')
      .leftJoin('partner_letterings', 'pl', 'pl.id = l.lettering_id')
      .where('l.organization_id = :organizationId', { organizationId })
      .andWhere('l.account_id = :accountId', { accountId: filters.accountId })
      .andWhere(`e.status = 'validated'`)
      .andWhere(`e.entry_date >= :fromDate::date AND e.entry_date <= :toDate::date`, {
        fromDate: filters.fromDate,
        toDate: filters.toDate,
      })
      .select('l.id', 'lineId')
      .addSelect('e.id', 'entryId')
      .addSelect(`TO_CHAR(e.entry_date, 'YYYY-MM-DD')`, 'entryDate')
      .addSelect('j.code', 'journalCode')
      .addSelect('e.entry_number', 'entryNumber')
      .addSelect('e.description', 'description')
      .addSelect('l.debit', 'debit')
      .addSelect('l.credit', 'credit')
      .addSelect('pl.lettering_code', 'letteringCode')
      .orderBy('e.entry_date', 'ASC')
      .addOrderBy('e.entry_number', 'ASC')
      .addOrderBy('l.position', 'ASC')
      .getRawMany<{
        lineId: string;
        entryId: string;
        entryDate: string;
        journalCode: string;
        entryNumber: string | number;
        description: string | null;
        debit: string;
        credit: string;
        letteringCode: string | null;
      }>();

    return rows.map((r) => ({
      lineId: r.lineId,
      entryId: r.entryId,
      entryDate: r.entryDate,
      journalCode: r.journalCode,
      entryNumber: Number(r.entryNumber),
      description: r.description,
      debit: Number(r.debit).toFixed(2),
      credit: Number(r.credit).toFixed(2),
      letteringCode: r.letteringCode,
    }));
  }

  /**
   * Cumulative balance "as at" a date — every validated journal-entry
   * line on or before `asAtDate`, grouped per account. Used by the
   * Bilan (balance sheet), which is a snapshot of the org's financial
   * position at a single date, not over a period.
   *
   * Returns one row per account that has had any movement; the service
   * is in charge of normalising the signed `net` into debit / credit
   * columns and of classifying accounts into Bilan sections.
   */
  async accountBalancesAsAt(
    organizationId: TenantId | string,
    asAtDate: string,
  ): Promise<
    Array<{
      accountId: string;
      accountCode: string;
      accountLabel: string;
      accountClass: number;
      isOpposing: boolean;
      totalDebit: string;
      totalCredit: string;
    }>
  > {
    assertTenantId(organizationId);
    const rows = await this.lineRepo
      .createQueryBuilder('l')
      .innerJoin('journal_entries', 'e', 'e.id = l.journal_entry_id')
      .innerJoin('organization_chart_accounts', 'a', 'a.id = l.account_id')
      .where('l.organization_id = :organizationId', { organizationId })
      .andWhere(`e.status = 'validated'`)
      .andWhere(`e.entry_date <= :asAtDate::date`, { asAtDate })
      .select('a.id', 'accountId')
      .addSelect('a.code', 'accountCode')
      .addSelect('a.label', 'accountLabel')
      .addSelect('a.class', 'accountClass')
      .addSelect('a.is_opposing', 'isOpposing')
      .addSelect('COALESCE(SUM(l.debit), 0)', 'totalDebit')
      .addSelect('COALESCE(SUM(l.credit), 0)', 'totalCredit')
      .groupBy('a.id')
      .addGroupBy('a.code')
      .addGroupBy('a.label')
      .addGroupBy('a.class')
      .addGroupBy('a.is_opposing')
      .orderBy('a.code', 'ASC')
      .getRawMany<{
        accountId: string;
        accountCode: string;
        accountLabel: string;
        accountClass: string | number;
        isOpposing: boolean | string | null;
        totalDebit: string;
        totalCredit: string;
      }>();

    return rows.map((r) => ({
      accountId: r.accountId,
      accountCode: r.accountCode,
      accountLabel: r.accountLabel,
      accountClass: Number(r.accountClass),
      // PG renvoie `boolean` via le driver, mais on défensivement
      // coerce le string 't'/'f' au cas où (driver alternatif).
      isOpposing: r.isOpposing === true || r.isOpposing === 't' || r.isOpposing === 'true',
      totalDebit: Number(r.totalDebit).toFixed(2),
      totalCredit: Number(r.totalCredit).toFixed(2),
    }));
  }

  /**
   * Mouvements par compte BORNÉS sur une période [fromDate, toDate] —
   * contrairement à `accountBalancesAsAt` (cumul depuis l'origine), à
   * utiliser pour les comptes de gestion (classes 6/7/8) afin que les
   * notes annexes reflètent l'EXERCICE et non le cumul historique
   * (sinon divergence avec le Compte de résultat dès le 2e exercice).
   */
  async accountMovementsBetween(
    organizationId: TenantId | string,
    fromDate: string,
    toDate: string,
  ): Promise<
    Array<{
      accountId: string;
      accountCode: string;
      accountLabel: string;
      accountClass: number;
      isOpposing: boolean;
      totalDebit: string;
      totalCredit: string;
    }>
  > {
    assertTenantId(organizationId);
    const rows = await this.lineRepo
      .createQueryBuilder('l')
      .innerJoin('journal_entries', 'e', 'e.id = l.journal_entry_id')
      .innerJoin('organization_chart_accounts', 'a', 'a.id = l.account_id')
      .where('l.organization_id = :organizationId', { organizationId })
      .andWhere(`e.status = 'validated'`)
      .andWhere(`e.entry_date >= :fromDate::date AND e.entry_date <= :toDate::date`, {
        fromDate,
        toDate,
      })
      .select('a.id', 'accountId')
      .addSelect('a.code', 'accountCode')
      .addSelect('a.label', 'accountLabel')
      .addSelect('a.class', 'accountClass')
      .addSelect('a.is_opposing', 'isOpposing')
      .addSelect('COALESCE(SUM(l.debit), 0)', 'totalDebit')
      .addSelect('COALESCE(SUM(l.credit), 0)', 'totalCredit')
      .groupBy('a.id')
      .addGroupBy('a.code')
      .addGroupBy('a.label')
      .addGroupBy('a.class')
      .addGroupBy('a.is_opposing')
      .orderBy('a.code', 'ASC')
      .getRawMany<{
        accountId: string;
        accountCode: string;
        accountLabel: string;
        accountClass: string | number;
        isOpposing: boolean | string | null;
        totalDebit: string;
        totalCredit: string;
      }>();

    return rows.map((r) => ({
      accountId: r.accountId,
      accountCode: r.accountCode,
      accountLabel: r.accountLabel,
      accountClass: Number(r.accountClass),
      isOpposing: r.isOpposing === true || r.isOpposing === 't' || r.isOpposing === 'true',
      totalDebit: Number(r.totalDebit).toFixed(2),
      totalCredit: Number(r.totalCredit).toFixed(2),
    }));
  }

  /**
   * Agrège les mouvements de classe 6 (charges) et 7 (produits) par
   * code d'axe analytique sur une période. Sert au rapport "marge par
   * activité" qui présente une ligne par axe (chantier / BU / projet).
   *
   * Retourne un tableau d'objets `{ axisCode, accountClass, periodDebit,
   * periodCredit }`. La projection finale en marge brute / VA / résultat
   * par axe est faite côté service (postes RA/RB/TA/TB/etc.).
   *
   * Migration 0092 — uniquement sur lignes où `analytic_axis_type =
   * :axisType` (les lignes sans axe sont exclues). Pour inclure une
   * pseudo-ligne "Sans imputation" il faudra un UNION ALL côté service.
   */
  async marginByAxis(
    organizationId: TenantId | string,
    filters: {
      fromDate: string;
      toDate: string;
      axisType: string;
    },
  ): Promise<
    Array<{
      axisCode: string;
      accountCode: string;
      accountClass: number;
      periodDebit: string;
      periodCredit: string;
    }>
  > {
    assertTenantId(organizationId);
    const rows = await this.lineRepo
      .createQueryBuilder('l')
      .innerJoin('journal_entries', 'e', 'e.id = l.journal_entry_id')
      .innerJoin('organization_chart_accounts', 'a', 'a.id = l.account_id')
      .where('l.organization_id = :organizationId', { organizationId })
      .andWhere(`e.status = 'validated'`)
      .andWhere(`e.entry_date >= :fromDate::date AND e.entry_date <= :toDate::date`, {
        fromDate: filters.fromDate,
        toDate: filters.toDate,
      })
      .andWhere('l.analytic_axis_type = :axisType', { axisType: filters.axisType })
      .andWhere('l.analytic_axis_code IS NOT NULL')
      .andWhere('a.class IN (6, 7, 8)') // P&L + HAO
      .select('l.analytic_axis_code', 'axisCode')
      .addSelect('a.code', 'accountCode')
      .addSelect('a.class', 'accountClass')
      .addSelect(`COALESCE(SUM(l.debit), 0)`, 'periodDebit')
      .addSelect(`COALESCE(SUM(l.credit), 0)`, 'periodCredit')
      .groupBy('l.analytic_axis_code')
      .addGroupBy('a.code')
      .addGroupBy('a.class')
      .orderBy('l.analytic_axis_code', 'ASC')
      .addOrderBy('a.code', 'ASC')
      .getRawMany<{
        axisCode: string;
        accountCode: string;
        accountClass: string | number;
        periodDebit: string;
        periodCredit: string;
      }>();
    return rows.map((r) => ({
      axisCode: r.axisCode,
      accountCode: r.accountCode,
      accountClass: Number(r.accountClass),
      periodDebit: Number(r.periodDebit).toFixed(2),
      periodCredit: Number(r.periodCredit).toFixed(2),
    }));
  }

  /**
   * Liste les couples (axis_type, axis_code) utilisés dans l'org sur
   * la période — sert à peupler le sélecteur frontend "choisir un axe".
   */
  async listAnalyticAxes(
    organizationId: TenantId | string,
    fromDate?: string,
    toDate?: string,
  ): Promise<Array<{ axisType: string; axisCode: string; lineCount: number }>> {
    assertTenantId(organizationId);
    const qb = this.lineRepo
      .createQueryBuilder('l')
      .innerJoin('journal_entries', 'e', 'e.id = l.journal_entry_id')
      .where('l.organization_id = :organizationId', { organizationId })
      .andWhere(`e.status = 'validated'`)
      .andWhere('l.analytic_axis_type IS NOT NULL')
      .andWhere('l.analytic_axis_code IS NOT NULL')
      .select('l.analytic_axis_type', 'axisType')
      .addSelect('l.analytic_axis_code', 'axisCode')
      .addSelect('COUNT(*)::int', 'lineCount')
      .groupBy('l.analytic_axis_type')
      .addGroupBy('l.analytic_axis_code')
      .orderBy('l.analytic_axis_type', 'ASC')
      .addOrderBy('l.analytic_axis_code', 'ASC');
    if (fromDate !== undefined) {
      qb.andWhere('e.entry_date >= :fromDate::date', { fromDate });
    }
    if (toDate !== undefined) {
      qb.andWhere('e.entry_date <= :toDate::date', { toDate });
    }
    return qb.getRawMany<{ axisType: string; axisCode: string; lineCount: number }>();
  }

  /**
   * Compute the strictly-before-fromDate net balance for one account
   * — i.e. the "opening balance" line shown at the top of the general
   * ledger. Returns { openingDebit, openingCredit }.
   */
  async generalLedgerOpening(
    organizationId: TenantId | string,
    accountId: string,
    fromDate: string,
  ): Promise<{ openingDebit: string; openingCredit: string }> {
    assertTenantId(organizationId);

    const row = await this.lineRepo
      .createQueryBuilder('l')
      .innerJoin('journal_entries', 'e', 'e.id = l.journal_entry_id')
      .where('l.organization_id = :organizationId', { organizationId })
      .andWhere('l.account_id = :accountId', { accountId })
      .andWhere(`e.status = 'validated'`)
      .andWhere(`e.entry_date < :fromDate::date`, { fromDate })
      .select('COALESCE(SUM(l.debit), 0)', 'debit')
      .addSelect('COALESCE(SUM(l.credit), 0)', 'credit')
      .getRawOne<{ debit: string; credit: string }>();

    const d = Number(row?.debit ?? 0);
    const c = Number(row?.credit ?? 0);
    const net = d - c;
    return {
      openingDebit: (net > 0 ? net : 0).toFixed(2),
      openingCredit: (net < 0 ? -net : 0).toFixed(2),
    };
  }

  // ─── Import diagnostic ───────────────────────────────────────────────

  /**
   * Header of an import session, scoped to the tenant. Returns `null`
   * when the session does not exist OR belongs to another tenant — the
   * service maps both to `IMPORT_SESSION_NOT_FOUND` to avoid leaking
   * existence across tenants.
   */
  async fetchImportSessionMeta(
    organizationId: TenantId | string,
    sessionId: string,
  ): Promise<ImportSessionMeta | null> {
    assertTenantId(organizationId);
    const rows = await this.lineRepo.manager.query<
      Array<{
        id: string;
        label: string | null;
        status: string;
        source_type: string;
        total_lines: number | string;
        error_lines: number | string;
        created_at: Date;
        document_type: string | null;
      }>
    >(
      // `document_type` n'existe pas comme colonne — il est stocké dans
      // `import_sessions.mapping_override` JSONB sous la clé sentinelle
      // `__documentType` (cf. import-session.service.ts). On l'extrait
      // via ->> qui renvoie TEXT ou NULL si la clé est absente.
      `SELECT s.id,
              s.label,
              s.status,
              s.source_type,
              s.total_lines,
              s.error_lines,
              s.created_at,
              (s.mapping_override ->> '__documentType') AS document_type
         FROM import_sessions s
        WHERE s.id = $1
          AND s.organization_id = $2
        LIMIT 1`,
      [sessionId, organizationId],
    );
    const row = rows[0];
    if (row === undefined) return null;
    return {
      id: row.id,
      label: row.label,
      status: row.status,
      sourceType: row.source_type,
      documentType: row.document_type,
      totalLines: Number(row.total_lines),
      errorLines: Number(row.error_lines),
      createdAt: row.created_at,
    };
  }

  /**
   * Every staging row of a session, ordered by `row_number`. The
   * caller iterates in JS to compute aggregates and anomaly groups —
   * SQL aggregation is harder when the keys live in JSONB.
   *
   * Volumetry: a 50k-row file produces 50k rows here. We stream-read
   * with a simple SELECT; the existing `ix_import_staging_entries_session_row`
   * index covers the WHERE + ORDER BY.
   */
  async fetchImportStagingRows(
    organizationId: TenantId | string,
    sessionId: string,
  ): Promise<ImportStagingRow[]> {
    assertTenantId(organizationId);
    const rows = await this.lineRepo.manager.query<
      Array<{
        row_number: number;
        mapped_values: Record<string, string | null>;
        errors: Array<{ code: string; message: string; field?: string }>;
      }>
    >(
      `SELECT e.row_number, e.mapped_values, e.errors
         FROM import_staging_entries e
         JOIN import_sessions s ON s.id = e.session_id
        WHERE e.session_id = $1
          AND s.organization_id = $2
        ORDER BY e.row_number ASC`,
      [sessionId, organizationId],
    );
    return rows.map((r) => ({
      rowNumber: Number(r.row_number),
      mappedValues: r.mapped_values ?? {},
      errors: r.errors ?? [],
    }));
  }

  /**
   * Build `code → label` map for a list of account codes, scoped to
   * the tenant's chart. Codes not found in the map are "unknown" from
   * the report's perspective. An empty `codes` list returns an empty
   * map without hitting the DB.
   */
  async fetchAccountLabelsByCode(
    organizationId: TenantId | string,
    codes: ReadonlyArray<string>,
  ): Promise<Map<string, string>> {
    assertTenantId(organizationId);
    if (codes.length === 0) return new Map();
    const rows = await this.lineRepo.manager.query<Array<{ code: string; label: string }>>(
      `SELECT code, label
         FROM organization_chart_accounts
        WHERE organization_id = $1
          AND code = ANY($2::text[])`,
      [organizationId, codes],
    );
    const map = new Map<string, string>();
    for (const r of rows) map.set(r.code, r.label);
    return map;
  }
}
