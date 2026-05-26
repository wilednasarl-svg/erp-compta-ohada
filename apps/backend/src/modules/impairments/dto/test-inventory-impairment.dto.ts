import { IsDateString, IsNotEmpty, IsOptional, IsString, IsUUID, Matches } from 'class-validator';

/**
 * DTO `POST /impairments/inventory/test` (controller en wave 2 hors-périmètre).
 */
export class TestInventoryImpairmentDto {
  @IsUUID()
  inventoryItemId!: string;

  @IsDateString({ strict: true })
  testDate!: string;

  /**
   * Net Realizable Value : valeur de marché − frais de commercialisation
   * estimés (SYSCOHADA chap. 14).
   */
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d+(\.\d{1,2})?$/, {
    message: 'nrv must be a non-negative decimal with up to 2 fraction digits',
  })
  nrv!: string;

  @IsOptional()
  @IsString()
  note?: string;
}
