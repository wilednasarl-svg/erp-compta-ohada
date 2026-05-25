import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import { AuditTrailService, type AuditContext } from '../../audit/services/audit-trail.service';
import { AccountingPeriodRepository } from '../../journals/repositories/accounting-period.repository';
import { AiAnomalyEntity } from '../entities/ai-anomaly.entity';
import {
  AiAnomalyRepository,
  type ListAnomaliesFilters,
} from '../repositories/ai-anomaly.repository';
import { detectAnomalies, type Finding, type ScannedLine } from './anomaly-heuristics';
import { DEFAULT_DETECTOR_CONFIG, type AnomalyDetectorConfig } from '../types/ai.types';

export interface ScanArgs {
  readonly organizationId: TenantId;
  readonly periodId: string;
  readonly actorId: string;
  readonly ctx: AuditContext;
  readonly config?: AnomalyDetectorConfig;
}

export interface ScanStats {
  readonly periodId: string;
  readonly entriesScanned: number;
  readonly linesScanned: number;
  readonly anomaliesDetected: number;
  readonly durationMs: number;
}

@Injectable()
export class AiAnomalyService {
  private static readonly MODULE = 'ai' as const;
  private readonly logger = new Logger(AiAnomalyService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly anomalyRepo: AiAnomalyRepository,
    private readonly periodRepo: AccountingPeriodRepository,
    private readonly audit: AuditTrailService,
  ) {}

  async scanExerciseForAnomalies(args: ScanArgs): Promise<ScanStats> {
    assertTenantId(args.organizationId);
    const started = Date.now();

    const period = await this.periodRepo.findById(args.periodId, args.organizationId);
    if (!period) {
      throw new AppException(ERROR_CODES.ACCOUNTING_PERIOD_NOT_FOUND, {
        message: `Accounting period '${args.periodId}' not found.`,
      });
    }

    const lines = await this.loadScannedLines(args.organizationId, args.periodId);
    const findings = detectAnomalies(
      lines,
      period.startDate,
      period.endDate,
      args.config ?? DEFAULT_DETECTOR_CONFIG,
    );
    const merged = this.mergeByTarget(findings);

    await this.dataSource.transaction(async (manager) => {
      await this.anomalyRepo.deleteByPeriod(args.organizationId, args.periodId, manager);
      for (const finding of merged) {
        await this.anomalyRepo.upsert(
          {
            organizationId: args.organizationId,
            periodId: args.periodId,
            entryId: finding.entryId,
            accountId: finding.accountId,
            anomalyType: finding.anomalyType,
            riskScore: finding.riskScore,
            reasons: finding.reasons,
          },
          manager,
        );
      }
    });

    const durationMs = Date.now() - started;
    const entryIds = new Set(lines.map((l) => l.entryId));
    const stats: ScanStats = {
      periodId: args.periodId,
      entriesScanned: entryIds.size,
      linesScanned: lines.length,
      anomaliesDetected: merged.length,
      durationMs,
    };

    await this.emitAudit(
      'anomalies_scanned',
      args.periodId,
      stats as unknown as Record<string, unknown>,
      args.ctx,
      args.actorId,
      args.organizationId,
    );

    this.logger.log(
      `scanExerciseForAnomalies: org=${args.organizationId} period=${args.periodId} entries=${stats.entriesScanned} lines=${stats.linesScanned} findings=${stats.anomaliesDetected} in ${durationMs}ms`,
    );

    return stats;
  }

  async listForOrg(
    organizationId: TenantId,
    filters: ListAnomaliesFilters = {},
  ): Promise<{ anomalies: AiAnomalyEntity[]; total: number }> {
    assertTenantId(organizationId);
    return this.anomalyRepo.listForOrg(organizationId, filters);
  }

  private async loadScannedLines(
    organizationId: TenantId,
    periodId: string,
  ): Promise<ScannedLine[]> {
    const rows = await this.dataSource.query<
      Array<{
        entry_id: string;
        entry_date: string;
        journal_code: string;
        account_id: string;
        account_code: string;
        debit: string;
        credit: string;
        description: string | null;
        partner: string | null;
      }>
    >(
      `SELECT
         e.id            AS entry_id,
         TO_CHAR(e.entry_date, 'YYYY-MM-DD') AS entry_date,
         j.code          AS journal_code,
         l.account_id    AS account_id,
         a.code          AS account_code,
         l.debit         AS debit,
         l.credit        AS credit,
         l.description   AS description,
         NULL::text      AS partner
       FROM journal_entry_lines l
       JOIN journal_entries e        ON e.id = l.journal_entry_id
       JOIN journals j               ON j.id = e.journal_id
       JOIN organization_chart_accounts a ON a.id = l.account_id
       WHERE l.organization_id = $1
         AND e.period_id = $2
         AND e.status = 'validated'
       ORDER BY e.entry_date ASC, e.entry_number ASC, l.position ASC`,
      [organizationId, periodId],
    );

    return rows.map((r) => ({
      entryId: r.entry_id,
      entryDate: r.entry_date,
      journalCode: r.journal_code,
      accountId: r.account_id,
      accountCode: r.account_code,
      debit: Number(r.debit),
      credit: Number(r.credit),
      description: r.description,
      partner: r.partner,
    }));
  }

  private mergeByTarget(findings: ReadonlyArray<Finding>): Finding[] {
    const map = new Map<string, Finding>();
    for (const f of findings) {
      const key = f.entryId
        ? `e:${f.entryId}:${f.anomalyType}`
        : `a:${f.accountId ?? ''}:${f.anomalyType}`;
      const existing = map.get(key);
      if (existing) {
        map.set(key, {
          entryId: existing.entryId,
          accountId: existing.accountId,
          anomalyType: existing.anomalyType,
          riskScore: Math.max(existing.riskScore, f.riskScore),
          reasons: [...new Set([...existing.reasons, ...f.reasons])],
        });
      } else {
        map.set(key, { ...f, reasons: [...f.reasons] });
      }
    }
    return [...map.values()];
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
        module: AiAnomalyService.MODULE,
        action,
        entityType: 'accounting_period',
        entityId,
        after: data,
        ctx: { ...ctx, userId: actorId, organizationId },
      })
      .catch((e) => this.logger.warn(`Audit failed: ${String(e)}`));
  }
}
