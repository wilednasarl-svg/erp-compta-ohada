import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import { AuditTrailService, type AuditContext } from '../../audit/services/audit-trail.service';
import { AccountingPeriodRepository } from '../../journals/repositories/accounting-period.repository';
import { AccountingScoreEntity } from '../entities/accounting-score.entity';
import { AccountingScoreRepository } from '../repositories/accounting-score.repository';
import { calculateScore } from './score-calculator';
import {
  SIGNIFICANT_ENTRY_THRESHOLD,
  type ScoreInputs,
  type ScoreResult,
} from '../types/accounting-score.types';

export interface RecalculateArgs {
  readonly organizationId: TenantId;
  readonly exerciseId: string;
  readonly actorId: string;
  readonly ctx: AuditContext;
  /** Date de référence pour le critère "retards". Defaults to today. */
  readonly referenceDate?: string;
}

@Injectable()
export class AccountingScoreService {
  private static readonly MODULE = 'accounting_score' as const;
  private readonly logger = new Logger(AccountingScoreService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly periods: AccountingPeriodRepository,
    private readonly scores: AccountingScoreRepository,
    private readonly audit: AuditTrailService,
  ) {}

  /**
   * Recalcule le score, persiste une nouvelle ligne `accounting_scores`
   * et journalise via AuditTrailService. Retourne l'entité persistée +
   * son ScoreResult (breakdown).
   *
   * Loose-coupling : toutes les sources (AI / docs / bank / workflow)
   * sont lues en SQL brut. Si une table source n'existe pas encore
   * dans la DB cible (ex: branche concurrente où Module 11 n'est pas
   * mergé), on traite ça comme "0 contribution" plutôt que crasher.
   */
  async recalculate(args: RecalculateArgs): Promise<{
    entity: AccountingScoreEntity;
    result: ScoreResult;
  }> {
    assertTenantId(args.organizationId);

    const period = await this.periods.findById(args.exerciseId, args.organizationId);
    if (!period) {
      throw new AppException(ERROR_CODES.ACCOUNTING_PERIOD_NOT_FOUND, {
        message: `Accounting period '${args.exerciseId}' not found.`,
      });
    }

    const referenceDate = args.referenceDate ?? new Date().toISOString().slice(0, 10);
    const inputs = await this.collectInputs(
      args.organizationId,
      args.exerciseId,
      period.startDate,
      period.endDate,
      period.status,
      referenceDate,
    );

    const result = calculateScore(inputs);

    const entity = await this.scores.insert({
      organizationId: args.organizationId,
      exerciseId: args.exerciseId,
      score: result.score,
      grade: result.grade,
      breakdown: result.breakdown,
      calculatedBy: 'heuristic_v1',
    });

    await this.emitAudit(
      'score_recalculated',
      args.exerciseId,
      {
        score: result.score,
        grade: result.grade,
        breakdown: result.breakdown,
        scoreId: entity.id,
      },
      args.ctx,
      args.actorId,
      args.organizationId,
    );

    this.logger.log(
      `recalculate: org=${args.organizationId} exercise=${args.exerciseId} score=${result.score} grade=${result.grade}`,
    );

    return { entity, result };
  }

  /**
   * Retourne le score le plus récent pour (org, exercise), ou null si
   * jamais calculé. Ne déclenche AUCUN recalcul (cf. POST /recalculate).
   */
  async getLatest(
    organizationId: TenantId,
    exerciseId: string,
  ): Promise<AccountingScoreEntity | null> {
    assertTenantId(organizationId);
    return this.scores.findLatest(organizationId, exerciseId);
  }

  // ------------------------------------------------------------------
  // Internals — collecte d'inputs (SQL brut, loose-coupling).
  // ------------------------------------------------------------------

  private async collectInputs(
    organizationId: TenantId,
    _exerciseId: string,
    startDate: string,
    endDate: string,
    periodStatus: 'open' | 'closed',
    referenceDate: string,
  ): Promise<ScoreInputs> {
    const [anomalies, missingJustification, bankReconciliation] = await Promise.all([
      this.collectAnomalies(organizationId, startDate, endDate),
      this.collectMissingJustification(organizationId, startDate, endDate),
      this.collectBankReconciliation(organizationId, startDate, endDate),
    ]);

    return {
      anomalies,
      missingJustification,
      bankReconciliation,
      workflowDelays: {
        periodEndDate: endDate,
        periodStatus,
        referenceDate,
      },
    };
  }

  private async collectAnomalies(
    organizationId: TenantId,
    startDate: string,
    endDate: string,
  ): Promise<ScoreInputs['anomalies']> {
    // Dénominateur : nb d'écritures validées sur la fenêtre exercice.
    const entryRows = await this.dataSource.query<Array<{ total: string }>>(
      `SELECT COUNT(*)::text AS total
         FROM journal_entries
        WHERE organization_id = $1
          AND entry_date >= $2
          AND entry_date <= $3
          AND status = 'validated'`,
      [organizationId, startDate, endDate],
    );
    const totalValidatedEntries = Number(entryRows[0]?.total ?? 0);

    // Anomalies — table peut ne pas exister sur certaines branches /
    // environnements (Module 11 pas encore mergé). On tombe sur 0 dans
    // ce cas plutôt que cracher.
    let anomaliesCount = 0;
    let weightedAnomalyScore = 0;
    try {
      const anomalyRows = await this.dataSource.query<
        Array<{ total: string; weighted: string | null }>
      >(
        `SELECT COUNT(*)::text AS total,
                COALESCE(SUM(a.risk_score), 0)::text AS weighted
           FROM ai_anomalies a
           LEFT JOIN journal_entries e ON e.id = a.entry_id
          WHERE a.organization_id = $1
            AND (
              a.entry_id IS NULL
              OR (e.entry_date >= $2 AND e.entry_date <= $3)
            )`,
        [organizationId, startDate, endDate],
      );
      anomaliesCount = Number(anomalyRows[0]?.total ?? 0);
      weightedAnomalyScore = Number(anomalyRows[0]?.weighted ?? 0);
    } catch (e: unknown) {
      this.logger.debug(
        `collectAnomalies: ai_anomalies query failed (likely table missing) — ${String(e)}`,
      );
    }

    return { totalValidatedEntries, anomaliesCount, weightedAnomalyScore };
  }

  private async collectMissingJustification(
    organizationId: TenantId,
    startDate: string,
    endDate: string,
  ): Promise<ScoreInputs['missingJustification']> {
    // "Significant" = écriture validée d'origine manuelle/import, dont
    // la plus grosse ligne (debit ou credit) dépasse le seuil XOF.
    // 'depreciation' et 'bank_reconciliation' sont auto-générés et
    // n'ont pas besoin d'un justificatif scanné.
    const rows = await this.dataSource.query<Array<{ total: string; without: string }>>(
      `WITH significant AS (
         SELECT e.id
           FROM journal_entries e
          WHERE e.organization_id = $1
            AND e.entry_date >= $2
            AND e.entry_date <= $3
            AND e.status = 'validated'
            AND e.source_type IN ('manual', 'import')
            AND EXISTS (
              SELECT 1
                FROM journal_entry_lines l
               WHERE l.journal_entry_id = e.id
                 AND (l.debit >= $4 OR l.credit >= $4)
            )
       )
       SELECT
         (SELECT COUNT(*)::text FROM significant) AS total,
         (SELECT COUNT(*)::text FROM significant s
           WHERE NOT EXISTS (
             SELECT 1 FROM document_entries de
              WHERE de.entry_id = s.id
                AND de.organization_id = $1
           )) AS without`,
      [organizationId, startDate, endDate, SIGNIFICANT_ENTRY_THRESHOLD],
    );

    return {
      significantEntries: Number(rows[0]?.total ?? 0),
      withoutDocuments: Number(rows[0]?.without ?? 0),
    };
  }

  private async collectBankReconciliation(
    organizationId: TenantId,
    startDate: string,
    endDate: string,
  ): Promise<ScoreInputs['bankReconciliation']> {
    // Table peut ne pas exister sur certaines branches. Fallback 0.
    try {
      const rows = await this.dataSource.query<Array<{ total: string; unmatched: string }>>(
        `SELECT COUNT(*)::text AS total,
                COUNT(*) FILTER (WHERE match_status = 'unmatched')::text AS unmatched
           FROM bank_statement_lines
          WHERE organization_id = $1
            AND operation_date >= $2
            AND operation_date <= $3`,
        [organizationId, startDate, endDate],
      );
      return {
        totalLines: Number(rows[0]?.total ?? 0),
        unmatchedLines: Number(rows[0]?.unmatched ?? 0),
      };
    } catch (e: unknown) {
      this.logger.debug(
        `collectBankReconciliation: bank_statement_lines query failed — ${String(e)}`,
      );
      return { totalLines: 0, unmatchedLines: 0 };
    }
  }

  private async emitAudit(
    action: string,
    entityId: string,
    data: Record<string, unknown>,
    ctx: AuditContext,
    actorId: string,
    organizationId: TenantId | string,
  ): Promise<void> {
    await this.audit
      .record({
        module: AccountingScoreService.MODULE,
        action,
        entityType: 'accounting_period',
        entityId,
        after: data,
        ctx: { ...ctx, userId: actorId, organizationId },
      })
      .catch((e) => this.logger.warn(`Audit failed: ${String(e)}`));
  }
}
