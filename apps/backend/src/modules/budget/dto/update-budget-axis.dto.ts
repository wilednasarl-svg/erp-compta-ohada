import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class UpdateBudgetAxisDto {
  @ApiPropertyOptional({ description: 'Libellé' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  label?: string;

  @ApiPropertyOptional({ description: 'Axe parent (null pour détacher)', nullable: true })
  @IsOptional()
  @IsUUID('4')
  parentId?: string | null;

  @ApiPropertyOptional({ description: 'Statut actif' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
