import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, Matches } from 'class-validator';

/**
 * Paramètres du téléchargement de la liasse DSF SYSCOHADA — W5.3.
 *
 * `exerciseId` identifie l'exercice comptable (utilisé pour résoudre
 * la page de garde via `DsfIdentificationService` + le contexte des
 * notes annexes). `fromDate` / `toDate` bornent la période des
 * états financiers (Bilan, CR, TFT) et doivent encadrer l'exercice.
 */
export class DsfPackageQueryDto {
  @ApiProperty({ example: '11111111-2222-4333-8444-555555555555' })
  @IsString()
  @IsUUID('4')
  exerciseId!: string;

  @ApiProperty({ example: '2026-01-01' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  fromDate!: string;

  @ApiProperty({ example: '2026-12-31' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  toDate!: string;

  @ApiProperty({
    required: false,
    description: 'Début exercice fiscal (Bilan). Défaut = fromDate.',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  fiscalYearStartDate?: string;
}
