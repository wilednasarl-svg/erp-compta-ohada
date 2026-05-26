import {
  IsEnum,
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

import {
  ALL_REGULARIZATION_TYPES,
  type RegularizationType,
} from '../types/regularization.types';

/**
 * W3.5 — Payload d'ajout d'une entrée à un batch en `draft`.
 *
 * Les comptes sont passés en clair (code SYSCOHADA). La cohérence
 * fonctionnelle (476 pour cca, 408 pour cap_charge, etc.) est laissée
 * à l'appelant ; le service se contente d'orienter le D/C selon
 * `REGULARIZATION_LINE_MAPPING`.
 */
export class AddEntryDto {
  @IsEnum(
    ALL_REGULARIZATION_TYPES.reduce<Record<string, string>>((acc, t) => {
      acc[t] = t;
      return acc;
    }, {}),
  )
  type!: RegularizationType;

  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  expenseRevenueAccount!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  regularizationAccount!: string;

  /** Montant HT (ou montant pur TVA pour cap_tva/par_tva). Decimal en string. */
  @IsNumberString({ no_symbols: false }, { message: 'amount must be a decimal string' })
  amount!: string;

  /** TVA associée (informationnelle, optionnelle). Decimal en string. */
  @IsOptional()
  @IsNumberString({ no_symbols: false }, { message: 'tvaAmount must be a decimal string' })
  tvaAmount?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  label?: string;
}
