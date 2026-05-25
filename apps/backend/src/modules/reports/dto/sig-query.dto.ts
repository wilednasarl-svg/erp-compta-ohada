import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, Matches } from 'class-validator';

/**
 * Query parameters pour le rapport SIG (Soldes Intermédiaires de
 * Gestion) au format SYSCOHADA AUDCIF. La comparaison N-1 est
 * optionnelle (mêmes conventions que `ProfitLossQueryDto`).
 */
export class SigQueryDto {
  @ApiProperty({ example: '2026-01-01', description: 'Début de la période N (inclusive)' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'fromDate must be YYYY-MM-DD' })
  fromDate!: string;

  @ApiProperty({ example: '2026-12-31', description: 'Fin de la période N (inclusive)' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'toDate must be YYYY-MM-DD' })
  toDate!: string;

  @ApiProperty({ required: false, example: '2025-01-01', description: 'Début comparaison N-1' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'compareFromDate must be YYYY-MM-DD',
  })
  compareFromDate?: string;

  @ApiProperty({ required: false, example: '2025-12-31', description: 'Fin comparaison N-1' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'compareToDate must be YYYY-MM-DD',
  })
  compareToDate?: string;
}
