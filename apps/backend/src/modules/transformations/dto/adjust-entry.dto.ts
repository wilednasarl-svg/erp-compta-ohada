import { IsOptional, IsString, IsUUID, Matches, MinLength } from 'class-validator';

/** Regex pour montant décimal positif. Ex: "1500.00" ou "1500". */
const DECIMAL_POSITIVE = /^\d+(\.\d{1,2})?$/;

export class AdjustEntryDto {
  @IsUUID()
  sourceEntryId!: string;

  /**
   * Montant de l'ajustement au débit. Exactement l'un des deux
   * (adjustmentDebit OU adjustmentCredit) doit être non-null et positif.
   */
  @IsOptional()
  @Matches(DECIMAL_POSITIVE, { message: 'adjustmentDebit must be a positive decimal' })
  adjustmentDebit?: string;

  @IsOptional()
  @Matches(DECIMAL_POSITIVE, { message: 'adjustmentCredit must be a positive decimal' })
  adjustmentCredit?: string;

  /** Libellé de l'écriture d'ajustement. */
  @IsString()
  @MinLength(1)
  adjustmentLabel!: string;

  /** Note explicative sur la raison de l'ajustement. */
  @IsOptional()
  @IsString()
  notes?: string;
}
