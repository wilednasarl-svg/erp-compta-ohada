import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, Length, Matches } from 'class-validator';

import { type SubsidyReleaseMethod } from '../types/subsidy.types';

const AMOUNT_PATTERN = /^\d{1,15}(\.\d{1,2})?$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const RELEASE_METHODS: readonly SubsidyReleaseMethod[] = ['on_depreciation', 'linear_10y', 'manual'];

/**
 * W4.4 — Payload de création d'une subvention d'investissement.
 *
 * La création pose immédiatement l'écriture d'octroi via EntriesService :
 *   D `grantDebitAccount` (par défaut 4494 — créance bailleur, ou 521 si
 *      encaissement immédiat) / C 1411 (subvention d'investissement reçue).
 */
export class CreateSubsidyDto {
  /** Asset financé par la subvention (null = subvention non liée). */
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsUUID()
  readonly assetId?: string | null;

  /** Nom du bailleur / organisme accordant la subvention. */
  @ApiProperty({ example: 'Agence Française de Développement' })
  @IsString()
  @Length(1, 255)
  readonly grantorName!: string;

  /** Date d'octroi (ISO YYYY-MM-DD). */
  @ApiProperty({ example: '2026-01-10' })
  @Matches(DATE_PATTERN, { message: 'grantDate doit être au format YYYY-MM-DD' })
  readonly grantDate!: string;

  /** Montant total octroyé (NUMERIC 15,2 — chaîne "0.00", > 0). */
  @ApiProperty({ example: '20000000.00' })
  @IsString()
  @Matches(AMOUNT_PATTERN, { message: 'totalAmount doit être un montant positif (max 2 décimales)' })
  readonly totalAmount!: string;

  /** Méthode de reprise au résultat. */
  @ApiProperty({ enum: RELEASE_METHODS, example: 'on_depreciation' })
  @IsIn(RELEASE_METHODS as readonly string[])
  readonly releaseMethod!: SubsidyReleaseMethod;

  /** Compte débité à l'octroi (4494 par défaut, 521 si encaissement direct). */
  @ApiPropertyOptional({ example: '4494' })
  @IsOptional()
  @IsString()
  @Length(1, 20)
  readonly grantDebitAccount?: string;

  /** Code du journal cible (défaut OD si non fourni). */
  @ApiPropertyOptional({ example: 'OD' })
  @IsOptional()
  @IsString()
  @Length(1, 20)
  readonly journalCode?: string;

  /** Note libre. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(0, 500)
  readonly note?: string;
}
