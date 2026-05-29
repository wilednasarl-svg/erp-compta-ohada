import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

/**
 * Paramètres d'une évaluation de conformité SYSCOHADA. Les deux bornes sont
 * requises : l'origine de l'exercice sert de borne basse (et d'origine du
 * bilan) et la date d'arrêté de borne haute (et de date du bilan).
 */
export class ComplianceQueryDto {
  @ApiProperty({
    example: '2026-01-01',
    description: 'Début de l’exercice évalué (YYYY-MM-DD).',
  })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'fiscalYearStartDate must be YYYY-MM-DD' })
  fiscalYearStartDate!: string;

  @ApiProperty({
    example: '2026-12-31',
    description: 'Date d’arrêté de l’évaluation (YYYY-MM-DD, incluse).',
  })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'asAtDate must be YYYY-MM-DD' })
  asAtDate!: string;
}
