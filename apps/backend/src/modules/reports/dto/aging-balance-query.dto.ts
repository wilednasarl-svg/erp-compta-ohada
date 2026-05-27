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
    deprecated: true,
    description:
      "DEPRECATED (D1) — les buckets sont désormais figés sur la nomenclature SYSCOHADA Tome 3 Notes 7/17 (0-30 / 31-60 / 61-90 / >90). Paramètre accepté pour rétro-compat mais ignoré.",
    example: '30,60,90',
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
