import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';

import { BILL_KINDS, type BillKind } from '../types/bill.types';

const AMOUNT_PATTERN = /^\d{1,15}(\.\d{1,2})?$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * W4.6 — Payload d'emission d'un effet de commerce.
 *
 * `kind=receivable` : effet a recevoir sur un client. L'ecriture posee
 *   sera D 412 / C `partnerAccountCode` (411x). `kind=payable` : effet a
 *   payer — D `partnerAccountCode` (401x) / C 402.
 */
export class CreateBillDto {
  @ApiProperty({ enum: BILL_KINDS, example: 'receivable' })
  @IsIn(BILL_KINDS as readonly string[])
  readonly kind!: BillKind;

  /** Compte de la creance/dette d'origine (411x client ou 401x fournisseur). */
  @ApiProperty({ example: '411DUP' })
  @IsString()
  @Length(1, 20)
  readonly partnerAccountCode!: string;

  @ApiProperty({ example: 'Dupont SARL' })
  @IsString()
  @Length(1, 255)
  readonly partnerName!: string;

  /** Numero/reference de l'effet. */
  @ApiProperty({ example: 'LCR-2026-001' })
  @IsString()
  @Length(1, 100)
  readonly billNumber!: string;

  /** Date d'emission de l'effet (ISO YYYY-MM-DD). */
  @ApiProperty({ example: '2026-02-01' })
  @Matches(DATE_PATTERN, { message: 'issueDate doit être au format YYYY-MM-DD' })
  readonly issueDate!: string;

  /** Date d'echeance (ISO YYYY-MM-DD). */
  @ApiProperty({ example: '2026-05-01' })
  @Matches(DATE_PATTERN, { message: 'dueDate doit être au format YYYY-MM-DD' })
  readonly dueDate!: string;

  /** Montant nominal en monnaie locale (> 0). */
  @ApiProperty({ example: '3000000.00' })
  @IsString()
  @Matches(AMOUNT_PATTERN, { message: 'nominalAmount doit être un montant positif (max 2 décimales)' })
  readonly nominalAmount!: string;

  /** Code du journal cible (defaut OD si non fourni). */
  @ApiPropertyOptional({ example: 'OD' })
  @IsOptional()
  @IsString()
  @Length(1, 20)
  readonly journalCode?: string;

  /** Note libre attachee a l'effet et a l'evenement d'emission. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(0, 500)
  readonly note?: string;
}
