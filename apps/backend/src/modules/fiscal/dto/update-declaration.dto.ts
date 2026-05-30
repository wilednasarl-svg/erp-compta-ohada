import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumberString, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class UpdateDeclarationDto {
  @ApiPropertyOptional({ description: 'Base imposable (recalcule le montant dû au taux figé)' })
  @IsOptional()
  @IsNumberString({ no_symbols: false })
  @Matches(/^-?\d{1,16}(\.\d{1,2})?$/)
  baseAmount?: string;

  @ApiPropertyOptional({ description: 'Référence de dépôt (e-impôts / CNPS)' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reference?: string;

  @ApiPropertyOptional({ description: 'Lien justificatif (GED)' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  justificatifUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}
