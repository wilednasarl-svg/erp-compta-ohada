import { Injectable, Logger } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';

import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import { AuditTrailService, type AuditContext } from '../../audit/services/audit-trail.service';
import { JournalEntryEntity } from '../../journals/entities/journal-entry.entity';
import { JournalEntryLineEntity } from '../../journals/entities/journal-entry-line.entity';
import { BankAccountsRepository } from '../repositories/bank-accounts.repository';
import { BankReconciliationMatchesRepository } from '../repositories/bank-reconciliation-matches.repository';
import { BankStatementLinesRepository } from '../repositories/bank-statement-lines.repository';
import { BankStatementsRepository } from '../repositories/bank-statements.repository';
import {
  proposeAutoMatches,
  type AutoMatchInputEntryLine,
  type AutoMatchInputStatementLine,
  type AutoMatchProposal,
} from './auto-match-algorithm';

/**
 * `BankReconciliationService` — matching ligne relevé ↔ ligne écriture.
 *
 * Trois opérations principales :
 *   - `proposeMatches` (lecture seule, exécute l'auto-match algo).
 *   - `applyMatch` (crée un match, met à jour le statut ligne + relevé).
 *   - `unmatch` (supprime un match, recalcule statuts).
 */
@Injectable()
export class BankReconciliationService {
  private static readonly MODULE = 'bank-reconciliation' as const;
  private readonly logger = new Logger(BankReconciliationService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly accountsRepo: BankAccountsRepository,
    private readonly statementsRepo: BankStatementsRepository,
    private readonly linesRepo: BankStatementLinesRepository,
    private readonly matchesRepo: BankReconciliationMatchesRepository,
    private readonly audit: AuditTrailService,
  ) {}

  async proposeMatches(
    bankAccountId: string,
    organizationId: TenantId,
  ): Promise<ReadonlyArray<AutoMatchProposal>> {
    assertTenantId(organizationId);

    const account = await this.accountsRepo.findById(bankAccountId, organizationId);
    if (!account) {
      throw new AppException(ERROR_CODES.BANK_ACCOUNT_NOT_FOUND, {
        message: `Bank account '${bankAccountId}' not found.`,
      });
    }

    const unmatched = await this.linesRepo.listUnmatchedByAccount(bankAccountId, organizationId);
    if (unmatched.length === 0) return [];

    const candidates = await this.fetchCandidateEntryLines(
      organizationId,
      account.chartAccountId,
    );
    if (candidates.length === 0) return [];

    const stInputs: AutoMatchInputStatementLine[] = unmatched.map((l) => ({
      id: l.id,
      operationDate: l.operationDate,
      label: l.label,
      amount: l.amount,
    }));

    const entryInputs: AutoMatchInputEntryLine[] = candidates.map((c) => ({
      id: c.lineId,
      entryDate: c.entryDate,
      description: c.description,
      signedAmount: c.signedAmount,
    }));

    return proposeAutoMatches(stInputs, entryInputs);
  }

  async applyMatch(
    organizationId: TenantId,
    statementLineId: string,
    journalEntryLineId: string,
    method: 'manual' | 'auto',
    confidenceScore: number | null,
    actorId: string,
    ctx: AuditContext,
  ): Promise<void> {
    assertTenantId(organizationId);

    return this.dataSource.transaction(async (manager) => {
      const stLine = await this.linesRepo.findById(statementLineId, organizationId);
      if (!stLine) {
        throw new AppException(ERROR_CODES.BANK_STATEMENT_LINE_NOT_FOUND, {
          message: `Bank statement line '${statementLineId}' not found.`,
        });
      }
      if (stLine.matchStatus === 'matched') {
        throw new AppException(ERROR_CODES.BANK_STATEMENT_LINE_ALREADY_MATCHED, {
          message: `Statement line '${statementLineId}' is already matched.`,
        });
      }

      const account = await this.accountsRepo.findById(stLine.bankAccountId, organizationId);
      if (!account) {
        throw new AppException(ERROR_CODES.BANK_ACCOUNT_NOT_FOUND, {
          message: `Bank account '${stLine.bankAccountId}' not found.`,
        });
      }

      const entryLineRepo = manager.getRepository(JournalEntryLineEntity);
      const queryResult = await entryLineRepo
        .createQueryBuilder('l')
        .innerJoinAndSelect(JournalEntryEntity, 'e', 'e.id = l.journal_entry_id')
        .where('l.id = :id', { id: journalEntryLineId })
        .andWhere('l.organization_id = :orgId', { orgId: organizationId })
        .getRawAndEntities();

      if (queryResult.entities.length === 0) {
        throw new AppException(ERROR_CODES.JOURNAL_ENTRY_NOT_FOUND, {
          message: `Journal entry line '${journalEntryLineId}' not found.`,
        });
      }

      const line = queryResult.entities[0];
      const entryStatus = queryResult.raw[0]?.e_status as string | undefined;

      if (entryStatus !== 'validated') {
        throw new AppException(ERROR_CODES.BANK_RECONCILIATION_ENTRY_LINE_NOT_VALIDATED, {
          message: `Journal entry must be 'validated' to be matched (current: '${entryStatus}').`,
        });
      }

      if (line.accountId !== account.chartAccountId) {
        throw new AppException(ERROR_CODES.BANK_RECONCILIATION_ENTRY_LINE_WRONG_ACCOUNT, {
          message: `Entry line account does not match the bank account's chart account.`,
        });
      }

      const signedEntryAmount = Number(line.debit) - Number(line.credit);
      const bankAmount = Number(stLine.amount);
      if (signedEntryAmount.toFixed(2) !== bankAmount.toFixed(2)) {
        throw new AppException(ERROR_CODES.BANK_RECONCILIATION_AMOUNT_MISMATCH, {
          message: `Amount mismatch: bank=${bankAmount.toFixed(2)}, entry signed=${signedEntryAmount.toFixed(2)}.`,
        });
      }

      await this.matchesRepo.create(
        {
          organizationId,
          bankStatementLineId: statementLineId,
          journalEntryLineId,
          matchMethod: method,
          confidenceScore: method === 'auto' ? confidenceScore : null,
          matchedById: actorId,
        },
        manager,
      );

      await this.linesRepo.updateStatus(statementLineId, organizationId, 'matched', manager);
      await this.recomputeStatementCounters(stLine.bankStatementId, organizationId, manager);

      await this.emitAudit(
        'bank_match_applied',
        statementLineId,
        {
          journalEntryLineId,
          method,
          confidenceScore,
          amount: stLine.amount,
        },
        ctx,
        actorId,
        organizationId,
      );
    });
  }

  async unmatch(
    organizationId: TenantId,
    matchId: string,
    actorId: string,
    ctx: AuditContext,
  ): Promise<void> {
    assertTenantId(organizationId);

    return this.dataSource.transaction(async (manager) => {
      const match = await this.matchesRepo.findById(matchId, organizationId);
      if (!match) {
        throw new AppException(ERROR_CODES.BANK_RECONCILIATION_MATCH_NOT_FOUND, {
          message: `Reconciliation match '${matchId}' not found.`,
        });
      }

      const stLine = await this.linesRepo.findById(match.bankStatementLineId, organizationId);
      if (!stLine) {
        throw new AppException(ERROR_CODES.BANK_STATEMENT_LINE_NOT_FOUND, {
          message: `Bank statement line '${match.bankStatementLineId}' vanished — DB integrity issue.`,
        });
      }

      await this.matchesRepo.delete(matchId, organizationId, manager);

      const remaining = await this.matchesRepo.countByStatementLine(
        match.bankStatementLineId,
        organizationId,
        manager,
      );
      if (remaining === 0) {
        await this.linesRepo.updateStatus(
          match.bankStatementLineId,
          organizationId,
          'unmatched',
          manager,
        );
      }

      await this.recomputeStatementCounters(stLine.bankStatementId, organizationId, manager);

      await this.emitAudit(
        'bank_match_removed',
        matchId,
        {
          statementLineId: match.bankStatementLineId,
          entryLineId: match.journalEntryLineId,
        },
        ctx,
        actorId,
        organizationId,
      );
    });
  }

  private async recomputeStatementCounters(
    statementId: string,
    organizationId: TenantId,
    manager: EntityManager,
  ): Promise<void> {
    const matchedCount = await this.linesRepo.countMatchedByStatement(statementId, organizationId);
    const statement = await this.statementsRepo.findById(statementId, organizationId);
    if (!statement) return;

    let status: 'imported' | 'matching' | 'reconciled';
    if (matchedCount === 0) status = 'imported';
    else if (matchedCount === statement.importedLinesCount) status = 'reconciled';
    else status = 'matching';

    await this.statementsRepo.updateCounts(
      statementId,
      organizationId,
      matchedCount,
      status,
      manager,
    );

    if (status === 'reconciled') {
      await this.accountsRepo.update(
        statement.bankAccountId,
        organizationId,
        { lastReconciledAt: new Date() },
        manager,
      );
    }
  }

  private async fetchCandidateEntryLines(
    organizationId: TenantId,
    chartAccountId: string,
  ): Promise<
    Array<{
      lineId: string;
      entryDate: string;
      description: string | null;
      signedAmount: string;
    }>
  > {
    const repo = this.dataSource.getRepository(JournalEntryLineEntity);
    const rows = await repo
      .createQueryBuilder('l')
      .innerJoin(JournalEntryEntity, 'e', 'e.id = l.journal_entry_id')
      .leftJoin('bank_reconciliation_matches', 'm', 'm.journal_entry_line_id = l.id')
      .where('l.organization_id = :orgId', { orgId: organizationId })
      .andWhere('l.account_id = :accountId', { accountId: chartAccountId })
      .andWhere('e.status = :status', { status: 'validated' })
      .andWhere('m.id IS NULL')
      .select([
        'l.id AS line_id',
        'e.entry_date AS entry_date',
        'l.description AS description',
        'l.debit AS debit',
        'l.credit AS credit',
      ])
      .getRawMany();

    return rows.map((r) => ({
      lineId: r.line_id,
      entryDate:
        r.entry_date instanceof Date ? r.entry_date.toISOString().slice(0, 10) : r.entry_date,
      description: r.description ?? null,
      signedAmount: (Number(r.debit) - Number(r.credit)).toFixed(2),
    }));
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
        module: BankReconciliationService.MODULE,
        action,
        entityType: 'bank_reconciliation',
        entityId,
        after: data,
        ctx: { ...ctx, userId: actorId, organizationId },
      })
      .catch((e) => this.logger.warn(`Audit failed: ${String(e)}`));
  }
}
