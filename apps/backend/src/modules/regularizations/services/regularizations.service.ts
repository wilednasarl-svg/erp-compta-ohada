import { Injectable, Logger } from '@nestjs/common';

import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import type { AuditContext } from '../../audit/services/audit-trail.service';
import {
  EntriesService,
  type CreateLineInput,
  type EntryView,
} from '../../journals/services/entries.service';
import { AddEntryDto } from '../dto/add-entry.dto';
import { CreateBatchDto } from '../dto/create-batch.dto';
import { RegularizationBatchEntity } from '../entities/regularization-batch.entity';
import { RegularizationEntryEntity } from '../entities/regularization-entry.entity';
import { RegularizationBatchesRepository } from '../repositories/regularization-batches.repository';
import { RegularizationEntriesRepository } from '../repositories/regularization-entries.repository';
import {
  isRegularizationType,
  REGULARIZATION_LINE_MAPPING,
  REGULARIZATION_TYPE_DESCRIPTION,
  type RegularizationBatchStatus,
  type RegularizationType,
} from '../types/regularization.types';

/**
 * Code journal par défaut pour les régularisations périodiques.
 * `OD` (opérations diverses) est seedé par OrganizationsService pour
 * toute organisation SYSCOHADA.
 */
const DEFAULT_JOURNAL_CODE = 'OD';

export interface ListRegularizationBatchesOptions {
  readonly status?: RegularizationBatchStatus;
  readonly exerciseEndDate?: string;
}

export interface RegularizationBatchWithEntries {
  readonly batch: RegularizationBatchEntity;
  readonly entries: ReadonlyArray<RegularizationEntryEntity>;
}

/**
 * W3.5 — Service applicatif des régularisations périodiques OHADA
 * (CCA / PCA / CAP / PAR).
 *
 * Cycle de vie d'un batch :
 *
 *   `createBatch`  → status='draft', reversalDate = exerciseEndDate + 1j
 *   `addEntry` × N (seulement en draft)
 *   `executeBatch` → génère 1 écriture agrégée au journal OD,
 *                    validée, puis status='executed'
 *   `reverseBatch` → génère 1 écriture symétrique au reversalDate,
 *                    status='reversed'
 *   `cancelBatch`  → status='cancelled' (uniquement depuis draft)
 *
 * Aucune mutation in-place sur les entités : on lit, on calcule, on
 * persiste un patch via le repository.
 */
@Injectable()
export class RegularizationsService {
  private readonly logger = new Logger(RegularizationsService.name);

  constructor(
    private readonly batchesRepo: RegularizationBatchesRepository,
    private readonly entriesRepo: RegularizationEntriesRepository,
    private readonly entriesService: EntriesService,
  ) {}

  // ─── Queries ───────────────────────────────────────────────────────

  async listBatches(
    organizationId: TenantId,
    options: ListRegularizationBatchesOptions = {},
  ): Promise<ReadonlyArray<RegularizationBatchEntity>> {
    assertTenantId(organizationId);
    return this.batchesRepo.listByOrg(organizationId, {
      status: options.status,
      exerciseEndDate: options.exerciseEndDate,
    });
  }

  async findBatch(
    organizationId: TenantId,
    batchId: string,
  ): Promise<RegularizationBatchWithEntries> {
    assertTenantId(organizationId);
    const batch = await this.requireBatch(organizationId, batchId);
    const entries = await this.entriesRepo.listByBatch(batchId, organizationId);
    return { batch, entries };
  }

  // ─── Create ────────────────────────────────────────────────────────

  async createBatch(
    organizationId: TenantId,
    dto: CreateBatchDto,
    createdBy: string,
  ): Promise<RegularizationBatchEntity> {
    assertTenantId(organizationId);
    const reversalDate = this.addOneDay(dto.exerciseEndDate);
    const batch = await this.batchesRepo.create({
      organizationId,
      exerciseEndDate: dto.exerciseEndDate,
      reversalDate,
      label: dto.label ?? '',
      status: 'draft',
      createdById: createdBy,
    });
    this.logger.log(
      `Regularization batch ${batch.id} created — exerciseEndDate=${dto.exerciseEndDate}`,
    );
    return batch;
  }

  // ─── Entries (draft only) ──────────────────────────────────────────

  async addEntry(
    organizationId: TenantId,
    batchId: string,
    dto: AddEntryDto,
  ): Promise<RegularizationEntryEntity> {
    assertTenantId(organizationId);
    const batch = await this.requireBatch(organizationId, batchId);
    this.assertDraft(batch);

    if (!isRegularizationType(dto.type)) {
      throw new AppException(ERROR_CODES.REGULARIZATION_ENTRY_INVALID_TYPE, {
        message: `Unknown regularization type: '${String(dto.type)}'.`,
      });
    }

    return this.entriesRepo.create({
      batchId,
      organizationId,
      type: dto.type,
      expenseRevenueAccount: dto.expenseRevenueAccount,
      regularizationAccount: dto.regularizationAccount,
      amount: dto.amount,
      tvaAmount: dto.tvaAmount,
      label: dto.label,
    });
  }

  async removeEntry(organizationId: TenantId, batchId: string, entryId: string): Promise<void> {
    assertTenantId(organizationId);
    const batch = await this.requireBatch(organizationId, batchId);
    this.assertDraft(batch);
    await this.entriesRepo.delete(entryId, organizationId);
  }

  // ─── Execution ─────────────────────────────────────────────────────

  async executeBatch(
    organizationId: TenantId,
    batchId: string,
    executedBy: string,
    ctx: AuditContext,
  ): Promise<RegularizationBatchEntity> {
    assertTenantId(organizationId);
    const batch = await this.requireBatch(organizationId, batchId);
    this.assertDraft(batch);

    const entries = await this.entriesRepo.listByBatch(batchId, organizationId);
    if (entries.length === 0) {
      throw new AppException(ERROR_CODES.JOURNAL_ENTRY_EMPTY_LINES, {
        message: `Batch ${batchId} has no entries to execute.`,
      });
    }

    const lines = this.buildLines(entries, /* reverse */ false);
    const description = this.buildDescription(batch, 'execution');
    const entry = await this.postEntry(
      organizationId,
      DEFAULT_JOURNAL_CODE,
      batch.exerciseEndDate,
      description,
      lines,
      executedBy,
      ctx,
    );

    const updated = await this.batchesRepo.update(organizationId, batchId, {
      status: 'executed',
      executedAt: new Date(),
      executedById: executedBy,
      journalEntryId: entry.id,
    });
    this.logger.log(
      `Regularization batch ${batchId} executed — entry=${entry.id}, lines=${lines.length}`,
    );
    return updated;
  }

  // ─── Reversal ──────────────────────────────────────────────────────

  async reverseBatch(
    organizationId: TenantId,
    batchId: string,
    reversedBy: string,
    ctx: AuditContext,
  ): Promise<RegularizationBatchEntity> {
    assertTenantId(organizationId);
    const batch = await this.requireBatch(organizationId, batchId);
    this.assertExecuted(batch);
    if (batch.reversedAt !== null) {
      throw new AppException(ERROR_CODES.REGULARIZATION_BATCH_ALREADY_REVERSED, {
        message: `Batch ${batchId} is already reversed.`,
      });
    }

    const entries = await this.entriesRepo.listByBatch(batchId, organizationId);
    const lines = this.buildLines(entries, /* reverse */ true);
    const description = this.buildDescription(batch, 'reversal');
    const entry = await this.postEntry(
      organizationId,
      DEFAULT_JOURNAL_CODE,
      batch.reversalDate,
      description,
      lines,
      reversedBy,
      ctx,
    );

    const updated = await this.batchesRepo.update(organizationId, batchId, {
      status: 'reversed',
      reversedAt: new Date(),
      reversedById: reversedBy,
      reversalJournalEntryId: entry.id,
    });
    this.logger.log(`Regularization batch ${batchId} reversed — entry=${entry.id}`);
    return updated;
  }

  // ─── Cancellation ──────────────────────────────────────────────────

  async cancelBatch(organizationId: TenantId, batchId: string): Promise<RegularizationBatchEntity> {
    assertTenantId(organizationId);
    const batch = await this.requireBatch(organizationId, batchId);
    if (batch.status !== 'draft') {
      throw new AppException(ERROR_CODES.REGULARIZATION_BATCH_NOT_DRAFT, {
        message: `Only draft batches can be cancelled (current status=${batch.status}).`,
      });
    }
    return this.batchesRepo.update(organizationId, batchId, {
      status: 'cancelled',
      cancelledAt: new Date(),
    });
  }

  // ─── Helpers ───────────────────────────────────────────────────────

  private async requireBatch(
    organizationId: TenantId,
    id: string,
  ): Promise<RegularizationBatchEntity> {
    const batch = await this.batchesRepo.findById(organizationId, id);
    if (!batch) {
      throw new AppException(ERROR_CODES.REGULARIZATION_BATCH_NOT_FOUND, {
        message: `Regularization batch '${id}' not found in this organization.`,
      });
    }
    return batch;
  }

  private assertDraft(batch: RegularizationBatchEntity): void {
    if (batch.status !== 'draft') {
      throw new AppException(ERROR_CODES.REGULARIZATION_BATCH_NOT_DRAFT, {
        message: `Batch ${batch.id} is not in draft status (current=${batch.status}).`,
      });
    }
  }

  private assertExecuted(batch: RegularizationBatchEntity): void {
    if (batch.status !== 'executed') {
      throw new AppException(ERROR_CODES.REGULARIZATION_BATCH_NOT_EXECUTED, {
        message: `Batch ${batch.id} is not in executed status (current=${batch.status}).`,
      });
    }
  }

  /**
   * Construit la liste de lignes comptables agrégée pour toutes les
   * entrées du batch. Si `reverse` est vrai, on inverse D/C pour
   * produire l'écriture d'extourne au 01/01 N+1.
   *
   * Pour `cap_tva` et `par_tva`, le montant porté est `tvaAmount` (la
   * TVA est l'objet même de l'entrée). Pour les autres types, on porte
   * `amount`. `tvaAmount` sur les entrées non-TVA reste informationnel
   * et n'est pas reflété dans l'écriture (l'utilisateur doit alors
   * ajouter une entrée TVA séparée — voir doc types).
   */
  private buildLines(
    entries: ReadonlyArray<RegularizationEntryEntity>,
    reverse: boolean,
  ): CreateLineInput[] {
    const lines: CreateLineInput[] = [];
    for (const entry of entries) {
      if (!isRegularizationType(entry.type)) {
        throw new AppException(ERROR_CODES.REGULARIZATION_ENTRY_INVALID_TYPE, {
          message: `Entry ${entry.id} has unknown type '${String(entry.type)}'.`,
        });
      }
      const mapping = REGULARIZATION_LINE_MAPPING[entry.type];
      const amount = this.pickAmount(entry);
      if (amount <= 0) continue;

      const expenseSide = reverse
        ? this.flip(mapping.expenseRevenueSide)
        : mapping.expenseRevenueSide;
      const regulSide = reverse
        ? this.flip(mapping.regularizationSide)
        : mapping.regularizationSide;

      const description = entry.label || REGULARIZATION_TYPE_DESCRIPTION[entry.type];

      lines.push(this.makeLine(entry.expenseRevenueAccount, expenseSide, amount, description));
      lines.push(this.makeLine(entry.regularizationAccount, regulSide, amount, description));
    }
    return lines;
  }

  private pickAmount(entry: RegularizationEntryEntity): number {
    const isTvaEntry: boolean = entry.type === 'cap_tva' || entry.type === 'par_tva';
    const raw = isTvaEntry ? entry.tvaAmount : entry.amount;
    const value = Number(raw);
    return Number.isFinite(value) ? value : 0;
  }

  private flip(side: 'debit' | 'credit'): 'debit' | 'credit' {
    return side === 'debit' ? 'credit' : 'debit';
  }

  private makeLine(
    accountCode: string,
    side: 'debit' | 'credit',
    amount: number,
    description: string,
  ): CreateLineInput {
    return {
      accountCode,
      debit: side === 'debit' ? amount : 0,
      credit: side === 'credit' ? amount : 0,
      description,
    };
  }

  private async postEntry(
    organizationId: TenantId,
    journalCode: string,
    entryDate: string,
    description: string,
    lines: CreateLineInput[],
    actorId: string,
    ctx: AuditContext,
  ): Promise<EntryView> {
    const draft = await this.entriesService.createDraft(
      organizationId,
      { journalCode, entryDate, description, lines },
      actorId,
      ctx,
    );
    return this.entriesService.validate(organizationId, draft.id, actorId, ctx);
  }

  /**
   * `exerciseEndDate + 1 jour` en arithmétique date pure (sans
   * dépendance horaire). On reste sur ISO YYYY-MM-DD.
   */
  private addOneDay(isoDate: string): string {
    const [yearStr, monthStr, dayStr] = isoDate.split('-');
    const year = Number(yearStr);
    const month = Number(monthStr);
    const day = Number(dayStr);
    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
      // DTO `@IsDateString` couvre déjà ce cas — garde-fou défensif.
      throw new Error(`Invalid ISO date '${isoDate}'.`);
    }
    // Utilise Date UTC pour éviter les pièges de timezone locale.
    const dt = new Date(Date.UTC(year, month - 1, day));
    dt.setUTCDate(dt.getUTCDate() + 1);
    return dt.toISOString().slice(0, 10);
  }

  private buildDescription(
    batch: RegularizationBatchEntity,
    phase: 'execution' | 'reversal',
  ): string {
    const base = batch.label?.trim().length
      ? batch.label
      : `Régularisations ${batch.exerciseEndDate}`;
    return phase === 'execution' ? base : `Contre-passation ${base}`;
  }
}

// Référence usage explicite des types pour clarifier l'API publique
export type { RegularizationType };
