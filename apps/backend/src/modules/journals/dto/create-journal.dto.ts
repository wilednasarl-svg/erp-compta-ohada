import { IsEnum, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { JournalKind } from '../types/journal.types';

export class CreateJournalDto {
  @ApiProperty({ description: 'Code journal (ex: BQ-01)', pattern: '^[A-Z0-9-]{1,8}$' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^[A-Z0-9-]{1,8}$/)
  code!: string;

  @ApiProperty({ description: 'Libelle du journal' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  label!: string;

  @ApiProperty({ enum: ['AC', 'VE', 'BQ', 'CA', 'OD'], description: 'Classe SYSCOHADA' })
  @IsEnum(['AC', 'VE', 'BQ', 'CA', 'OD'])
  kind!: JournalKind;

  @ApiPropertyOptional({ description: 'Compte par defaut (UUID)' })
  @IsOptional()
  @IsUUID()
  defaultAccountId?: string | null;
}
