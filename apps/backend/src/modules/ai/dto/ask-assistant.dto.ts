import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class AskAssistantDto {
  @ApiProperty({
    description:
      'Question en français (max 500 chars). Provider rule-based v1 couvre 5 patterns canoniques.',
    example: 'Pourquoi le compte 6132 augmente ?',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  question!: string;

  @ApiPropertyOptional({
    description:
      'UUID de la période fiscale à utiliser comme contexte par défaut (anomalies, top risque, etc.).',
  })
  @IsOptional()
  @IsUUID()
  periodId?: string;
}
