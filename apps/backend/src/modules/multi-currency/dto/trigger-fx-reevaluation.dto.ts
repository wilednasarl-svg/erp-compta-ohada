import {
  ArrayMinSize,
  IsArray,
  IsISO8601,
  IsNumberString,
  IsString,
  Length,
  Matches,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Solde FX (par compte de tiers ou de trésorerie) au jour de la clôture,
 * exprimé en devise d'origine + contre-valeur XOF déjà comptabilisée.
 *
 * Le service compare la contre-valeur XOF recalculée (`amountCurrency ×
 * tauxClôture`) au `currentAmountXof` historique pour produire l'écart
 * de conversion.
 *
 * Wave 1 : la composition de cette liste est à la charge du caller —
 * la dérivation automatique depuis `journal_entry_lines` est listée en
 * TODO follow-up car les lignes ne portent pas encore de colonne
 * `currency` / `currency_amount` (cf. README W3.4).
 */
export class FxBalanceItemDto {
  @IsString()
  @Matches(/^[1-9]\d{2,9}$/, {
    message: 'accountCode must be a SYSCOHADA-style numeric account code (3-10 digits).',
  })
  accountCode!: string;

  @IsString()
  @Length(3, 3)
  @Matches(/^[A-Z]{3}$/, { message: 'currency must be a 3-letter ISO 4217 code.' })
  currency!: string;

  /**
   * Solde en devise d'origine à la date de clôture. Signé : positif =
   * créance (débit net), négatif = dette (crédit net).
   */
  @IsNumberString({ no_symbols: false })
  amountCurrency!: string;

  /** Contre-valeur XOF déjà comptabilisée (somme historique). Signé. */
  @IsNumberString({ no_symbols: false })
  currentAmountXof!: string;
}

export class TriggerFxReevaluationDto {
  @IsISO8601({ strict: true })
  closingDate!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => FxBalanceItemDto)
  balances!: FxBalanceItemDto[];
}
