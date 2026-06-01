import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Length, MaxLength } from 'class-validator';

/** Corps de la requête de comptabilisation d'une ligne de relevé. */
export class GenerateBankEntryDto {
  @ApiProperty({
    description: 'Code SYSCOHADA du compte de contrepartie (charge 6x / produit 7x).',
    example: '631500',
  })
  @IsString()
  @Length(1, 20)
  counterpartAccountCode!: string;

  @ApiProperty({
    description: 'Code du journal de comptabilisation (ex. banque).',
    example: 'BQ',
  })
  @IsString()
  @Length(1, 20)
  journalCode!: string;

  @ApiPropertyOptional({
    description: "Libellé de l'écriture ; défaut = libellé de la ligne de relevé.",
    example: 'Frais de tenue de compte mai 2026',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  label?: string;
}
