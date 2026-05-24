import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CancelDeclarationDto {
  @ApiPropertyOptional({ description: "Motif d'annulation", example: "Erreur de saisie d'écriture" })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
