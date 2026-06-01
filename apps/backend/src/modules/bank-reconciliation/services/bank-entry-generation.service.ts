import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import { OrganizationAccountRepository } from '../../accounting-plan/repositories/organization-account.repository';
import { type AuditContext } from '../../audit/services/audit-trail.service';
import { EntriesService } from '../../journals/services/entries.service';
import { BankReconciliationMatchEntity } from '../entities/bank-reconciliation-match.entity';
import { BankStatementLineEntity } from '../entities/bank-statement-line.entity';
import { BankAccountsRepository } from '../repositories/bank-accounts.repository';
import { BankStatementLinesRepository } from '../repositories/bank-statement-lines.repository';
import { buildBankEntryLines } from '../lib/bank-entry-builder';

export interface GenerateBankEntryParams {
  /** Code SYSCOHADA du compte de contrepartie (charge/produit). */
  readonly counterpartAccountCode: string;
  /** Journal de comptabilisation (ex. 'BQ'). */
  readonly journalCode: string;
  /** Libellé de l'écriture ; défaut = libellé de la ligne de relevé. */
  readonly label?: string | null;
}

export interface GenerateBankEntryResult {
  readonly entryId: string;
  readonly entryNumber: number;
  readonly bankJournalEntryLineId: string;
  readonly matchId: string;
  readonly direction: 'outflow' | 'inflow';
  readonly absAmount: number;
}

/**
 * Génère l'écriture comptable manquante d'une ligne de relevé non rapprochée
 * (agios, frais bancaires, prélèvements/virements non saisis), puis la
 * rapproche automatiquement de la ligne de relevé.
 *
 * S'appuie sur `EntriesService` pour la création/validation de l'écriture
 * (équilibre, période ouverte, numérotation) et sur le mécanisme de match
 * existant. Net-new et additif : ne modifie aucun service du module.
 */
@Injectable()
export class BankEntryGenerationService {
  private readonly logger = new Logger(BankEntryGenerationService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly linesRepo: BankStatementLinesRepository,
    private readonly accountsRepo: BankAccountsRepository,
    private readonly orgAccounts: OrganizationAccountRepository,
    private readonly entries: EntriesService,
  ) {}

  async generateEntryForLine(
    organizationId: TenantId,
    statementLineId: string,
    params: GenerateBankEntryParams,
    actorId: string,
    ctx: AuditContext,
  ): Promise<GenerateBankEntryResult> {
    assertTenantId(organizationId);

    const line = await this.linesRepo.findById(statementLineId, organizationId);
    if (line === null) {
      throw new AppException(ERROR_CODES.BANK_STATEMENT_LINE_NOT_FOUND, {
        message: 'Bank statement line not found.',
      });
    }
    if (line.matchStatus === 'matched') {
      throw new AppException(ERROR_CODES.BANK_STATEMENT_LINE_ALREADY_MATCHED, {
        message: 'Cette ligne de relevé est déjà rapprochée.',
      });
    }

    const bankAccount = await this.accountsRepo.findById(line.bankAccountId, organizationId);
    if (bankAccount === null) {
      throw new AppException(ERROR_CODES.BANK_ACCOUNT_NOT_FOUND, {
        message: 'Bank account not found.',
      });
    }

    const bankChartAccount = await this.orgAccounts.findById(
      bankAccount.chartAccountId,
      organizationId,
    );
    if (bankChartAccount === null) {
      throw new AppException(ERROR_CODES.CHART_ACCOUNT_NOT_FOUND, {
        message: 'Compte banque (plan comptable) introuvable.',
      });
    }

    const counterpart = await this.orgAccounts.findByCode(
      params.counterpartAccountCode,
      organizationId,
    );
    if (counterpart === null) {
      throw new AppException(ERROR_CODES.CHART_ACCOUNT_NOT_FOUND, {
        message: `Compte de contrepartie introuvable : ${params.counterpartAccountCode}`,
      });
    }

    // Construction PURE des deux lignes équilibrées (orientation par le signe).
    let draft;
    try {
      draft = buildBankEntryLines({
        statementAmount: line.amount,
        bankAccountCode: bankChartAccount.code,
        counterpartAccountCode: counterpart.code,
      });
    } catch (cause: unknown) {
      throw new AppException(ERROR_CODES.BANK_GENERATED_ENTRY_INVALID, {
        message: cause instanceof Error ? cause.message : 'Écriture bancaire invalide.',
      });
    }

    // Création + validation de l'écriture (EntriesService gère sa transaction,
    // l'équilibre, la période ouverte et la numérotation).
    const created = await this.entries.createDraft(
      organizationId,
      {
        journalCode: params.journalCode,
        entryDate: line.operationDate,
        description: (params.label ?? line.label).slice(0, 255),
        reference: line.bankReference ?? null,
        lines: draft.lines.map((l) => ({
          accountCode: l.accountCode,
          debit: l.debit,
          credit: l.credit,
        })),
        sourceType: 'bank_reconciliation',
      },
      actorId,
      ctx,
    );
    const validated = await this.entries.validate(organizationId, created.id, actorId, ctx);

    // Ligne d'écriture portée par le compte banque : c'est elle qu'on rapproche
    // de la ligne de relevé.
    const bankLine = validated.lines.find((l) => l.accountId === bankAccount.chartAccountId);
    if (bankLine === undefined) {
      // Ne devrait pas arriver (on vient de poster cette ligne) — garde défensive.
      throw new AppException(ERROR_CODES.BANK_GENERATED_ENTRY_INVALID, {
        message: "Ligne banque introuvable dans l'écriture générée.",
      });
    }

    // Rapprochement + bascule du statut, atomiquement.
    const matchId = await this.dataSource.transaction(async (manager) => {
      const match = manager.getRepository(BankReconciliationMatchEntity).create({
        organizationId,
        bankStatementLineId: line.id,
        journalEntryLineId: bankLine.id,
        matchMethod: 'manual',
        confidenceScore: null,
        matchedById: actorId,
        matchedAt: new Date(),
        matchGroupId: null,
        fxRateApplied: null,
      });
      const saved = await manager.getRepository(BankReconciliationMatchEntity).save(match);
      await manager
        .getRepository(BankStatementLineEntity)
        .update({ id: line.id, organizationId }, { matchStatus: 'matched' });
      return saved.id;
    });

    this.logger.log(
      `Écriture bancaire générée (org=${organizationId}, ligne=${line.id}, ` +
        `entry=${validated.id}, sens=${draft.direction}, montant=${draft.absAmount}).`,
    );

    return {
      entryId: validated.id,
      entryNumber: validated.entryNumber,
      bankJournalEntryLineId: bankLine.id,
      matchId,
      direction: draft.direction,
      absAmount: draft.absAmount,
    };
  }
}
