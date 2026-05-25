import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class AnnexeNoteDetailQueryDto {
  @ApiProperty({ example: 'Note 3A', description: 'Code de la note (avec espace)' })
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
