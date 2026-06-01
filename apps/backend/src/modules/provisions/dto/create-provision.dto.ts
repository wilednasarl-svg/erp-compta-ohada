import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';

import { PROVISION_TYPES, type ProvisionType } from '../types/provision.types';

const AMOUNT_PATTERN = /^\d{1,15}(\.\d{1,2})?$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * W3.1 — Payload de creation d'une provision.
 *
 * `initialAmount` est aussi la dotation initiale : la creation pose
 * automatiquement une ecriture comptable D 691x|697x / C 19x via
 * `EntriesService`. La provision part directement avec
 * `currentAmount = initialAmount` et `status = 'active'`.
 */
export class CreateProvisionDto {
  @ApiProperty({ enum: PROVISION_TYPES, example: 'litige' })
  @IsIn(PROVISION_TYPES as readonly string[])
  readonly type!: ProvisionType;

  @ApiProperty({ example: 'Litige prud’homal salarié X' })
  @IsString()
  @Length(1, 255)
  readonly label!: string;

  /** Montant initialement provisionne (en monnaie locale, > 0). */
  @ApiProperty({ example: '5000000.00', description: 'Montant > 0 (string décimal)' })
  @IsString()
  @Matches(AMOUNT_PATTERN, {
    message: 'initialAmount doit être un montant positif (max 2 décimales)',
  })
  readonly initialAmount!: string;

  /** Date d'effet comptable (ISO YYYY-MM-DD). */
  @ApiProperty({ example: '2026-01-15' })
  @Matches(DATE_PATTERN, { message: 'effectiveDate doit être au format YYYY-MM-DD' })
  readonly effectiveDate!: string;

  /** Code du journal cible (defaut OD si non fourni). */
  @ApiPropertyOptional({ example: 'OD' })
  @IsOptional()
  @IsString()
  @Length(1, 20)
  readonly journalCode?: string;

  /** Note libre attachee au mouvement de dotation. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(0, 500)
  readonly note?: string;
}
