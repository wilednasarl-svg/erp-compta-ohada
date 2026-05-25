import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class SuggestColumnsDto {
  @ApiProperty({
    description: 'Liste des en-têtes de colonnes du fichier (ordre conservé)',
    example: ['Date', 'N° Compte', 'Libellé', 'Débit', 'Crédit'],
    type: [String],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  headers!: string[];

  @ApiPropertyOptional({
    description: 'Lignes échantillon pour inférence par valeurs (N premières lignes)',
    type: [[String]] as unknown as () => unknown,
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  sampleRows?: string[][];
}
