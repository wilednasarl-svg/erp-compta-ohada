import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';

export class TaxBracketInputDto {
  @ApiProperty({ example: 1, description: 'Ordre de la tranche (1 = première)' })
  @IsInt()
  @Min(1)
  bracketOrder!: number;

  @ApiProperty({ example: '0.00', description: 'Borne inférieure' })
  @IsNumberString({ no_symbols: false })
  @Matches(/^\d{1,16}(\.\d{1,2})?$/)
  fromAmount!: string;

  @ApiPropertyOptional({
    example: '75000.00',
    nullable: true,
    description: 'Borne supérieure ; null = tranche ouverte (dernière)',
  })
  @IsOptional()
  @IsNumberString({ no_symbols: false })
  @Matches(/^\d{1,16}(\.\d{1,2})?$/)
  toAmount?: string | null;

  @ApiProperty({ example: '16.0000', description: 'Taux marginal en %' })
  @IsNumberString({ no_symbols: false })
  @Matches(/^\d{1,4}(\.\d{1,4})?$/)
  rate!: string;
}

export class ReplaceBracketsDto {
  @ApiProperty({ example: 'ITS' })
  @Matches(/^[A-Z0-9_]{1,32}$/)
  @IsNotEmpty()
  taxCode!: string;

  @ApiProperty({ example: '2026-01-01', description: "Date d'effet du barème" })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  effectiveFrom!: string;

  @ApiProperty({ type: () => [TaxBracketInputDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => TaxBracketInputDto)
  brackets!: TaxBracketInputDto[];
}
