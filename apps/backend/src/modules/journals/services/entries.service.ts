import { Injectable, Logger } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';

import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import { AuditTrailService, type AuditContext } from '../../audit/services/audit-trail.service';
import { OrganizationAccountEntity } from '../../accounting-plan/entities/organization-account.entity';
import { AccountingPeriodRepository } from '../repositories/accounting-period.repository';
import { JournalRepository } from '../repositories/journal.repository';
import {
  JournalEntryRepository,
  type ListEntriesFilters,
} from '../repositories/journal-entry.repository';
import { JournalEntryLineRepository } from '../repositories/journal-entry-line.repository';
import type { JournalEntryEntity } from '../entities/journal-entry.entity';
import type { JournalEntrySourceType } from '../entities/journal-entry.entity';

export interface CreateLineInput {
  readonly accountCode: string;
  readonly debit: number;
  readonly credit: number;
  readonly description?: string | null;
  /** Axe analytique optionnel (Migration 0092 — Option A). */
  readonly analyticAxisType?: string | null;
  readonly analyticAxisCode?: string | null;
}

export interface CreateEntryInput {
  readonly journalCode: string;
  readonly entryDate: string;
  readonly description: string;
  readonly reference?: string | null;
  readonly lines: CreateLineInput[];
  readonly sourceType?: JournalEntrySourceType;
  readonly sourceImportSessionId?: string | null;
}

export interface EntryView {
  readonly id: string;
  readonly organizationId: string;
  readonly journalCode: string;
  readonly periodId: string;
  readonly entryNumber: number;
  readonly entryDate: string;
  readonly description: string;
  readonly reference: string | null;
  readonly status: string;
  readonly sourceType: string;
  readonly createdById: string | null;
  readonly validatedAt: Date | null;
  readonly cancelledAt: Date | null;
  readonly lines: Array<{
    id: string;
    accountId: string;
    position: number;
    description: string | null;
    debit: string;
    credit: string;
  }>;
}

@Injectable()
export class EntriesService {
  private static readonly MODULE = 'journals' as const;
  private readonly logger = new Logger(EntriesService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly periodsRepo: AccountingPeriodRepository,
    private readonly journalRepo: JournalRepository,
    private readonly entryRepo: JournalEntryRepository,
    private readonly lineRepo: JournalEntryLineRepository,
    private readonly audit: AuditTrailService,
  ) {}

  async createDraft(
    organizationId: TenantId,
    input: CreateEntryInput,
    actorId: string,
    ctx: AuditContext,
  ): Promise<EntryView> {
    assertTenantId(organizationId);

    if (!input.lines || input.lines.length === 0) {
      throw new AppException(ERROR_CODES.JOURNAL_ENTRY_EMPTY_LINES, {
        message: 'An entry must have at least one line.',
      });
    }

    const totalDebit = input.lines.reduce((s, l) => s + (l.debit ?? 0), 0);
    const totalCredit = input.lines.reduce((s, l) => s + (l.credit ?? 0), 0);
    if (Math.abs(totalDebit - totalCredit) > 0.005) {
      throw new AppException(ERROR_CODES.JOURNAL_ENTRY_UNBALANCED, {
        message: `Entry unbalanced: debit=${totalDebit}, credit=${totalCredit}.`,
      });
    }

    for (let i = 0; i < input.lines.length; i++) {
      const l = input.lines[i];
      if ((l.debit > 0 && l.credit > 0) || (l.debit <= 0 && l.credit <= 0)) {
        throw new AppException(ERROR_CODES.JOURNAL_ENTRY_INVALID_LINE, {
          message: `Line ${i + 1}: exactly one of debit or credit must be positive.`,
        });
      }
    }

    return this.dataSource.transaction(async (manager) => {
      const journal = await this.journalRepo.findByCode(organizationId, input.journalCode);
      if (!journal || !journal.isActive) {
        throw new AppException(ERROR_CODES.JOURNAL_NOT_FOUND, {
          message: `Journal not found or inactive: ${input.journalCode}`,
        });
      }

      const period = await this.periodsRepo.findContainingDate(organizationId, input.entryDate);
      if (!period) {
        throw new AppException(ERROR_CODES.ACCOUNTING_PERIOD_NOT_FOUND, {
          message: `No open period contains date ${input.entryDate}.`,
        });
      }
      if (period.status === 'closed') {
        throw new AppException(ERROR_CODES.ACCOUNTING_PERIOD_CLOSED, {
          message: `Period is closed: ${period.label}`,
        });
      }

      const resolvedLines = await this.resolveAccounts(organizationId, input.lines, manager);
      const entryNumber = await this.journalRepo.assignNextEntryNumber(
        journal.id,
        organizationId,
        manager,
      );

      const entry = await this.entryRepo.create(
        {
          organizationId,
          journalId: journal.id,
          periodId: period.id,
          entryNumber,
          entryDate: input.entryDate,
          description: input.description,
          reference: input.reference ?? null,
          status: 'draft',
          sourceType: input.sourceType ?? 'manual',
          sourceImportSessionId: input.sourceImportSessionId ?? null,
          createdById: actorId,
        },
        manager,
      );

      await this.lineRepo.createMany(
        resolvedLines.map((l, idx) => ({
          organizationId,
          journalEntryId: entry.id,
          accountId: l.accountId,
          position: idx + 1,
          description: l.description ?? null,
          debit: l.debit.toFixed(2),
          credit: l.credit.toFixed(2),
        })),
        manager,
      );

      await this.emitAudit(
        'journals.entry_created',
        entry.id,
        {
          journalCode: input.journalCode,
          entryNumber,
        },
        ctx,
      ).catch((e: unknown) => this.logger.warn(`Audit failed: ${String(e)}`));

      return this.buildView(entry, journal.code, resolvedLines);
    });
  }

  async validate(
    organizationId: TenantId,
    entryId: string,
    actorId: string,
    ctx: AuditContext,
  ): Promise<EntryView> {
    assertTenantId(organizationId);
    const entry = await this.getOrThrow(organizationId, entryId);
    if (entry.status !== 'draft') {
      throw new AppException(ERROR_CODES.JOURNAL_ENTRY_IMMUTABLE, {
        message: 'Entry is not in draft status.',
      });
    }
    await this.entryRepo.updateStatus(entryId, 'validated', {
      validatedAt: new Date(),
      validatedById: actorId,
    });
    await this.emitAudit('journals.entry_validated', entryId, {}, ctx).catch((e: unknown) =>
      this.logger.warn(`Audit failed: ${String(e)}`),
    );
    return this.getEntry(organizationId, entryId);
  }

  async cancel(
    organizationId: TenantId,
    entryId: string,
    reason: string,
    actorId: string,
    ctx: AuditContext,
  ): Promise<EntryView> {
    assertTenantId(organizationId);
    const original = await this.getOrThrow(organizationId, entryId);

    if (original.status === 'cancelled') {
      throw new AppException(ERROR_CODES.JOURNAL_ENTRY_ALREADY_CANCELLED, {
        message: 'Entry is already cancelled.',
      });
    }
    if (original.status !== 'validated') {
      throw new AppException(ERROR_CODES.JOURNAL_ENTRY_IMMUTABLE, {
        message: 'Only validated entries can be reversed.',
      });
    }

    const originalLines = await this.lineRepo.listByEntry(entryId);

    return this.dataSource.transaction(async (manager) => {
      const journal = await this.journalRepo.findById(original.journalId, organizationId);
      if (!journal) {
        throw new AppException(ERROR_CODES.JOURNAL_NOT_FOUND, { message: 'Journal not found.' });
      }
      const today = new Date().toISOString().slice(0, 10);
      const period = await this.periodsRepo.findContainingDate(organizationId, today);
      if (!period || period.status === 'closed') {
        throw new AppException(ERROR_CODES.ACCOUNTING_PERIOD_CLOSED, {
          message: 'No open period to post the reversal.',
        });
      }

      const entryNumber = await this.journalRepo.assignNextEntryNumber(
        journal.id,
        organizationId,
        manager,
      );

      const reversal = await this.entryRepo.create(
        {
          organizationId,
          journalId: journal.id,
          periodId: period.id,
          entryNumber,
          entryDate: today,
          description: `Annulation piece N${original.entryNumber} - ${reason}`,
          status: 'validated' as const,
          sourceType: 'manual' as const,
          createdById: actorId,
          cancelsId: entryId,
        },
        manager,
      );

      await this.lineRepo.createMany(
        originalLines.map((l, idx) => ({
          organizationId,
          journalEntryId: reversal.id,
          accountId: l.accountId,
          position: idx + 1,
          description: l.description,
          debit: l.credit,
          credit: l.debit,
        })),
        manager,
      );

      await this.entryRepo.updateStatus(
        entryId,
        'cancelled',
        { cancelledAt: new Date(), cancelledById: actorId, cancelledReason: reason },
        manager,
      );

      await this.emitAudit(
        'journals.entry_cancelled',
        entryId,
        {
          reversalId: reversal.id,
          reason,
        },
        ctx,
      ).catch((e: unknown) => this.logger.warn(`Audit failed: ${String(e)}`));

      return this.getEntry(organizationId, reversal.id);
    });
  }

  async deleteDraft(
    organizationId: TenantId,
    entryId: string,
    _actorId: string,
    ctx: AuditContext,
  ): Promise<void> {
    assertTenantId(organizationId);
    const entry = await this.getOrThrow(organizationId, entryId);
    if (entry.status !== 'draft') {
      throw new AppException(ERROR_CODES.JOURNAL_ENTRY_IMMUTABLE, {
        message: 'Only draft entries can be deleted.',
      });
    }
    await this.dataSource.manager.delete('journal_entries', { id: entryId });
    await this.emitAudit('journals.entry_deleted', entryId, {}, ctx).catch((e: unknown) =>
      this.logger.warn(`Audit failed: ${String(e)}`),
    );
  }

  async getEntry(organizationId: TenantId, entryId: string): Promise<EntryView> {
    assertTenantId(organizationId);
    const entry = await this.getOrThrow(organizationId, entryId);
    const journal = await this.journalRepo.findById(entry.journalId, organizationId);
    const lines = await this.lineRepo.listByEntry(entryId);
    return {
      id: entry.id,
      organizationId: entry.organizationId,
      journalCode: journal?.code ?? '?',
      periodId: entry.periodId,
      entryNumber: entry.entryNumber,
      entryDate: entry.entryDate,
      description: entry.description,
      reference: entry.reference,
      status: entry.status,
      sourceType: entry.sourceType,
      createdById: entry.createdById,
      validatedAt: entry.validatedAt,
      cancelledAt: entry.cancelledAt,
      lines: lines.map((l) => ({
        id: l.id,
        accountId: l.accountId,
        position: l.position,
        description: l.description,
        debit: l.debit,
        credit: l.credit,
      })),
    };
  }

  async listForOrg(
    organizationId: TenantId,
    filters: ListEntriesFilters,
  ): Promise<{ entries: JournalEntryEntity[]; total: number }> {
    assertTenantId(organizationId);
    return this.entryRepo.listForOrg(organizationId, filters);
  }

  private async getOrThrow(organizationId: TenantId, entryId: string): Promise<JournalEntryEntity> {
    const entry = await this.entryRepo.findById(entryId, organizationId);
    if (!entry) {
      throw new AppException(ERROR_CODES.JOURNAL_ENTRY_NOT_FOUND, {
        message: `Journal entry not found: ${entryId}`,
      });
    }
    return entry;
  }

  private async resolveAccounts(
    organizationId: TenantId,
    lines: CreateLineInput[],
    manager: EntityManager,
  ): Promise<
    Array<{
      accountId: string;
      debit: number;
      credit: number;
      description?: string | null;
    }>
  > {
    const out = [];
    for (const line of lines) {
      const acct: OrganizationAccountEntity | null = await manager
        .getRepository(OrganizationAccountEntity)
        .findOne({ where: { organizationId, code: line.accountCode } });

      if (!acct || !acct.isActive) {
        throw new AppException(ERROR_CODES.JOURNAL_ENTRY_NOT_FOUND, {
          message: `Account not found or inactive: ${line.accountCode}`,
        });
      }
      if (acct.accountType !== 'POSTING') {
        throw new AppException(ERROR_CODES.JOURNAL_ENTRY_NON_POSTING_ACCOUNT, {
          message: `Account is not a POSTING account: ${line.accountCode}`,
        });
      }
      out.push({
        accountId: acct.id,
        debit: line.debit,
        credit: line.credit,
        description: line.description,
      });
    }
    return out;
  }

  private buildView(
    entry: JournalEntryEntity,
    journalCode: string,
    lines: Array<{
      accountId: string;
      position?: number;
      debit: number;
      credit: number;
      description?: string | null;
    }>,
  ): EntryView {
    return {
      id: entry.id,
      organizationId: entry.organizationId,
      journalCode,
      periodId: entry.periodId,
      entryNumber: entry.entryNumber,
      entryDate: entry.entryDate,
      description: entry.description,
      reference: entry.reference,
      status: entry.status,
      sourceType: entry.sourceType,
      createdById: entry.createdById,
      validatedAt: entry.validatedAt,
      cancelledAt: entry.cancelledAt,
      lines: lines.map((l, idx) => ({
        id: '',
        accountId: l.accountId,
        position: l.position ?? idx + 1,
        description: l.description ?? null,
        debit: l.debit.toFixed(2),
        credit: l.credit.toFixed(2),
      })),
    };
  }

  private async emitAudit(
    action: string,
    entityId: string,
    metadata: Record<string, unknown>,
    ctx: AuditContext,
  ): Promise<void> {
    await this.audit.record({
      module: EntriesService.MODULE,
      action,
      entityType: 'journal_entry',
      entityId,
      metadata,
      ctx,
    });
  }
}
