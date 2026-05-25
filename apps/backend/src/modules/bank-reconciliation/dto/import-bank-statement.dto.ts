import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsString, Matches } from 'class-validator';

/**
 * DTO for `POST /organizations/:id/bank-accounts/:bankAccountId/statements/import`.
 *
 * Wave 1 : CSV file content passed as a base64-encoded string in `fileContent`.
 * Multer-style multipart upload arrives in wave 2.
 */
export class ImportBankStatementDto {
  @ApiProperty({ example: 'releve_bicici_2026-03.csv' })
  @IsString()
  fileName!: string;

  @ApiProperty({ description: 'Base64-encoded CSV file content.' })
  @IsString()
  fileContent!: string;

  @ApiProperty({ example: '2026-03-01' })
  @IsDateString()
  periodStart!: string;

  @ApiProperty({ example: '2026-03-31' })
  @IsDateString()
  periodEnd!: string;

  @ApiProperty({ example: '15000000.00' })
  @IsString()
  @Matches(/^-?\d+(\.\d{1,2})?$/)
  openingBalance!: string;

  @ApiProperty({ example: '12500000.00' })
  @IsString()
  @Matches(/^-?\d+(\.\d{1,2})?$/)
  closingBalance!: string;
}
