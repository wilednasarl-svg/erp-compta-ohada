import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class AnnexeNoteDetailQueryDto {
  @ApiProperty({ example: 'N3A', description: 'Code canonique de la note (ex: N3A, N7, N16A, N20)' })
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  noteCode!: string;

  @ApiProperty({ example: '2026-12-31' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  asAtDate!: string;

  @ApiProperty({ example: '2026-01-01' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  fiscalYearStartDate!: string;
}
