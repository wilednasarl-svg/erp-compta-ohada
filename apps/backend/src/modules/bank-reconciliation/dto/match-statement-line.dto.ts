import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsNumber,
  IsOptional,
  IsUUID,
  Min,
} from 'class-validator';

export class MatchStatementLineDto {
  @ApiProperty({
    description:
      'UUIDs of the journal entry lines to match. Wave 2: 1:1 (one) ou 1:N (plusieurs lignes dont la somme signée ≈ le montant relevé ± tolérance).',
    example: ['a1b2c3d4-e5f6-7890-abcd-ef1234567890'],
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  journalEntryLineIds!: string[];

  /**
   * Tolérance absolue (devise du compte bancaire) sur l'écart entre la
   * somme signée des entry lines et le montant du relevé. Par défaut
   * 0.01 côté service.
   */
  @ApiPropertyOptional({
    description:
      "Tolérance absolue (devise du compte) sur la somme des montants. Défaut 0.01.",
    example: 0.5,
    minimum: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  amountTolerance?: number;

  /**
   * Activation explicite du mode multi-lignes côté algorithme. Sans
   * effet sur `applyMatch` (qui accepte toujours plusieurs IDs) ; ce
   * champ est forwardé vers le générateur de propositions.
   */
  @ApiPropertyOptional({
    description: 'Active la génération de propositions multi-lignes (1:N).',
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  enableMultiLine?: boolean;
}
