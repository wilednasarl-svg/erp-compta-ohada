import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

/**
 * Optional overrides for `POST /documents/:id/create-entry`. With no body
 * the SYSCOHADA purchase defaults apply (601 / 4452 / 401, journal AC);
 * the UI typically lets the user pick the charge account before posting.
 */
export class CreateEntryFromOcrDto {
  @ApiPropertyOptional({ description: 'Code journal (défaut AC)', pattern: '^[A-Z0-9-]{1,8}$' })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z0-9-]{1,8}$/)
  journalCode?: string;

  @ApiPropertyOptional({ description: 'Compte de charge/immo pour le HT (défaut 601000)' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{3,8}$/)
  chargeAccount?: string;

  @ApiPropertyOptional({ description: 'Compte de TVA déductible (défaut 445200)' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{3,8}$/)
  vatAccount?: string;

  @ApiPropertyOptional({ description: 'Compte fournisseur (défaut 401000)' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  supplierAccount?: string;
}
