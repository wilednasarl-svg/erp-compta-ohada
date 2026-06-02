import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, IsUUID, Matches } from 'class-validator';

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

  /**
   * Contournement explicite du garde-fou de validation pré-dépôt.
   *
   * Par défaut (`false`), la génération est REFUSÉE (422) si la validation
   * rend un verdict `BLOCK` (bilan déséquilibré, comptes non classés…),
   * pour ne jamais produire une liasse comptablement incohérente. Le
   * comptable peut passer `acknowledgeBlocking=true` pour obtenir un
   * brouillon en connaissance de cause (les anomalies bloquantes restent
   * non corrigées).
   */
  @ApiPropertyOptional({
    description:
      'Forcer la génération malgré un verdict de validation BLOCK (brouillon). Défaut: false.',
    default: false,
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => value === true || value === 'true')
  @IsBoolean()
  acknowledgeBlocking?: boolean;
}
