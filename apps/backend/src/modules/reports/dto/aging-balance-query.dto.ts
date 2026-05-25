import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, Matches } from 'class-validator';

export class AgingBalanceQueryDto {
  @ApiProperty({ enum: ['CLIENT', 'FOURNISSEUR'] })
  @IsString()
  @IsIn(['CLIENT', 'FOURNISSEUR'])
  side!: 'CLIENT' | 'FOURNISSEUR';

  @ApiProperty({ example: '2026-12-31' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  asAtDate!: string;

  @ApiProperty({
    required: false,
    description: "Bornes des buckets en jours, séparées par virgule. Défaut '30,60,90,180'.",
    example: '30,60,90,180',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (typeof value !== 'string' || value.trim() === '') return undefined;
    return value
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n));
  })
  bucketBoundaries?: number[];
}
