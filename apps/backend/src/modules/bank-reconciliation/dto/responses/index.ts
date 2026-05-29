import { ApiProperty } from '@nestjs/swagger';

import {
  BANK_ACCOUNT_STATUSES,
  BANK_LINE_MATCH_STATUSES,
  BANK_STATEMENT_STATUSES,
  type BankAccountStatus,
  type BankStatementLineMatchStatus,
  type BankStatementStatus,
} from '../../types/bank.types';

/**
 * Contrats Response du module bank-reconciliation. Forme JSON
 * strictement préservée par rapport à la sérialisation TypeORM
 * pré-DTO (consommée déjà par le frontend).
 *
 * Pattern de référence : tva/dto/responses/.
 */

// ─── BankAccount ─────────────────────────────────────────────────────

export class BankAccountResponse {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  organizationId!: string;

  @ApiProperty()
  code!: string;

  @ApiProperty()
  label!: string;

  @ApiProperty()
  bankName!: string;

  @ApiProperty({ nullable: true, type: String })
  accountNumber!: string | null;

  @ApiProperty({ nullable: true, type: String })
  iban!: string | null;

  @ApiProperty({ description: 'Devise (XOF par défaut)', type: String })
  currency!: string;

  @ApiProperty({ format: 'uuid' })
  chartAccountId!: string;

  @ApiProperty({ description: "Solde d'ouverture. DECIMAL(15,2) en string.", type: String })
  openingBalance!: string;

  @ApiProperty({ enum: BANK_ACCOUNT_STATUSES })
  status!: BankAccountStatus;

  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  lastReconciledAt!: Date | null;

  @ApiProperty({ nullable: true, type: String, format: 'uuid' })
  createdById!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;
}

// ─── BankStatement ───────────────────────────────────────────────────

export class BankStatementResponse {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  organizationId!: string;

  @ApiProperty({ format: 'uuid' })
  bankAccountId!: string;

  @ApiProperty({ description: 'YYYY-MM-DD' })
  periodStart!: string;

  @ApiProperty({ description: 'YYYY-MM-DD' })
  periodEnd!: string;

  @ApiProperty({ description: 'DECIMAL(15,2) en string.' })
  openingBalance!: string;

  @ApiProperty({ description: 'DECIMAL(15,2) en string.' })
  closingBalance!: string;

  @ApiProperty()
  currency!: string;

  @ApiProperty()
  importedFileName!: string;

  @ApiProperty()
  importedFileHash!: string;

  @ApiProperty({ type: Number })
  importedLinesCount!: number;

  @ApiProperty({ type: Number })
  matchedLinesCount!: number;

  @ApiProperty({ enum: BANK_STATEMENT_STATUSES })
  status!: BankStatementStatus;

  @ApiProperty({ nullable: true, type: String, format: 'uuid' })
  importedById!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  importedAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;
}

// ─── BankStatementLine ───────────────────────────────────────────────

export class BankStatementLineResponse {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  organizationId!: string;

  @ApiProperty({ format: 'uuid' })
  bankStatementId!: string;

  @ApiProperty({ format: 'uuid' })
  bankAccountId!: string;

  @ApiProperty({ type: Number })
  lineOrder!: number;

  @ApiProperty({ description: 'YYYY-MM-DD' })
  operationDate!: string;

  @ApiProperty({ nullable: true, type: String })
  valueDate!: string | null;

  @ApiProperty()
  label!: string;

  @ApiProperty({ nullable: true, type: String })
  bankReference!: string | null;

  @ApiProperty({ description: 'Montant signé. DECIMAL(15,2) en string.' })
  amount!: string;

  @ApiProperty({ enum: BANK_LINE_MATCH_STATUSES })
  matchStatus!: BankStatementLineMatchStatus;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;
}

// ─── AutoMatchProposal ───────────────────────────────────────────────

export class AutoMatchProposalResponse {
  @ApiProperty({ format: 'uuid' })
  statementLineId!: string;

  @ApiProperty({ format: 'uuid' })
  journalEntryLineId!: string;

  @ApiProperty({ description: 'Score 0-100', type: Number })
  confidenceScore!: number;
}

// ─── Enveloppes ──────────────────────────────────────────────────────

export class ListBankAccountsResponse {
  @ApiProperty({ type: () => [BankAccountResponse] })
  accounts!: BankAccountResponse[];
}

export class BankAccountEnvelopeResponse {
  @ApiProperty({ type: () => BankAccountResponse })
  account!: BankAccountResponse;
}

export class ListBankStatementsResponse {
  @ApiProperty({ type: () => [BankStatementResponse] })
  statements!: BankStatementResponse[];
}

export class BankStatementWithLinesResponse {
  @ApiProperty({ type: () => BankStatementResponse })
  statement!: BankStatementResponse;

  @ApiProperty({ type: () => [BankStatementLineResponse] })
  lines!: BankStatementLineResponse[];
}

export class ImportBankStatementResponse {
  @ApiProperty({ type: () => BankStatementResponse })
  statement!: BankStatementResponse;

  @ApiProperty({ description: 'Nombre de lignes importées', type: Number })
  linesCount!: number;
}

export class ListProposalsResponse {
  @ApiProperty({ type: () => [AutoMatchProposalResponse] })
  proposals!: AutoMatchProposalResponse[];
}

export class MatchResultResponse {
  @ApiProperty({ enum: ['matched'] })
  status!: 'matched';

  @ApiProperty({ nullable: true, type: String, format: 'uuid' })
  matchGroupId!: string | null;

  @ApiProperty({
    description: 'Taux FX appliqué si conversion devise (DECIMAL en string)',
    nullable: true,
    type: String,
  })
  fxRateApplied!: string | null;
}

export class UnmatchResultResponse {
  @ApiProperty({ enum: ['unmatched'] })
  status!: 'unmatched';
}
