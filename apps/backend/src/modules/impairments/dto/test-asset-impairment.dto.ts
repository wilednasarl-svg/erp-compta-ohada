import { IsDateString, IsNotEmpty, IsOptional, IsString, IsUUID, Matches } from 'class-validator';

/**
 * DTO `POST /impairments/assets/test` (controller en wave 2 hors-périmètre).
 * Exposé ici pour fixer le contrat (utilisé par les tests).
 */
export class TestAssetImpairmentDto {
  @IsUUID()
  assetId!: string;

  @IsDateString({ strict: true })
  testDate!: string;

  /**
   * Valeur actuelle saisie (Net Realizable Value côté immo : valeur
   * vénale ou valeur d'usage la plus haute, SYSCOHADA chap. 12).
   * Format `NUMERIC(15,2)` → string "0.00".
   */
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d+(\.\d{1,2})?$/, {
    message: 'recoverableAmount must be a non-negative decimal with up to 2 fraction digits',
  })
  recoverableAmount!: string;

  @IsOptional()
  @IsString()
  note?: string;
}
