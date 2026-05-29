import type { BankAccountEntity } from '../entities/bank-account.entity';
import type { BankStatementEntity } from '../entities/bank-statement.entity';
import type { BankStatementLineEntity } from '../entities/bank-statement-line.entity';
import type { AutoMatchProposal } from '../services/auto-match-algorithm';
import {
  type AutoMatchProposalResponse,
  type BankAccountEnvelopeResponse,
  type BankAccountResponse,
  type BankStatementLineResponse,
  type BankStatementResponse,
  type BankStatementWithLinesResponse,
  type ImportBankStatementResponse,
  type ListBankAccountsResponse,
  type ListBankStatementsResponse,
  type ListProposalsResponse,
} from '../dto/responses';

/**
 * Mappers purs entité TypeORM -> DTO de réponse pour le module
 * bank-reconciliation. Forme JSON strictement préservée par rapport
 * au comportement pré-DTO.
 */

export function toBankAccountResponse(entity: BankAccountEntity): BankAccountResponse {
  return {
    id: entity.id,
    organizationId: entity.organizationId,
    code: entity.code,
    label: entity.label,
    bankName: entity.bankName,
    accountNumber: entity.accountNumber,
    iban: entity.iban,
    currency: entity.currency,
    chartAccountId: entity.chartAccountId,
    openingBalance: entity.openingBalance,
    status: entity.status,
    lastReconciledAt: entity.lastReconciledAt,
    createdById: entity.createdById,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
  };
}

export function toBankStatementResponse(entity: BankStatementEntity): BankStatementResponse {
  return {
    id: entity.id,
    organizationId: entity.organizationId,
    bankAccountId: entity.bankAccountId,
    periodStart: entity.periodStart,
    periodEnd: entity.periodEnd,
    openingBalance: entity.openingBalance,
    closingBalance: entity.closingBalance,
    currency: entity.currency,
    importedFileName: entity.importedFileName,
    importedFileHash: entity.importedFileHash,
    importedLinesCount: entity.importedLinesCount,
    matchedLinesCount: entity.matchedLinesCount,
    status: entity.status,
    importedById: entity.importedById,
    importedAt: entity.importedAt,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
  };
}

export function toBankStatementLineResponse(
  entity: BankStatementLineEntity,
): BankStatementLineResponse {
  return {
    id: entity.id,
    organizationId: entity.organizationId,
    bankStatementId: entity.bankStatementId,
    bankAccountId: entity.bankAccountId,
    lineOrder: entity.lineOrder,
    operationDate: entity.operationDate,
    valueDate: entity.valueDate,
    label: entity.label,
    bankReference: entity.bankReference,
    amount: entity.amount,
    matchStatus: entity.matchStatus,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
  };
}

export function toAutoMatchProposalResponse(
  proposal: AutoMatchProposal,
): AutoMatchProposalResponse {
  return {
    statementLineId: proposal.statementLineId,
    journalEntryLineId: proposal.journalEntryLineId,
    confidenceScore: proposal.confidenceScore,
  };
}

// ─── Enveloppes ───────────────────────────────────────────────────────

export function toListBankAccounts(
  entities: ReadonlyArray<BankAccountEntity>,
): ListBankAccountsResponse {
  return { accounts: entities.map(toBankAccountResponse) };
}

export function toBankAccountEnvelope(entity: BankAccountEntity): BankAccountEnvelopeResponse {
  return { account: toBankAccountResponse(entity) };
}

export function toListBankStatements(
  entities: ReadonlyArray<BankStatementEntity>,
): ListBankStatementsResponse {
  return { statements: entities.map(toBankStatementResponse) };
}

export function toBankStatementWithLines(
  statement: BankStatementEntity,
  lines: ReadonlyArray<BankStatementLineEntity>,
): BankStatementWithLinesResponse {
  return {
    statement: toBankStatementResponse(statement),
    lines: lines.map(toBankStatementLineResponse),
  };
}

export function toImportBankStatement(
  statement: BankStatementEntity,
  linesCount: number,
): ImportBankStatementResponse {
  return {
    statement: toBankStatementResponse(statement),
    linesCount,
  };
}

export function toListProposals(
  proposals: ReadonlyArray<AutoMatchProposal>,
): ListProposalsResponse {
  return { proposals: proposals.map(toAutoMatchProposalResponse) };
}
