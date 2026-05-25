import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class SuggestAccountDto {
  @ApiProperty({
    description: "Libellé / description de l'écriture pour laquelle on cherche un compte",
    example: 'Loyer bureau juin 2026',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  description!: string;

  @ApiPropertyOptional({ description: 'Nom du tiers (fournisseur, client) si connu' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  partner?: string;

  @ApiPropertyOptional({
    description: "Côté de l'écriture (debit/credit). Optionnel — filtre les patterns ambigus.",
    enum: ['debit', 'credit'],
  })
  @IsOptional()
  @IsIn(['debit', 'credit'])
  side?: 'debit' | 'credit';
}
