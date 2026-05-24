import {
  ArrayMinSize,
  IsArray,
  IsISO8601,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class CreateEntryLineDto {
  @ApiProperty({ description: 'Code compte SYSCOHADA (ex: 621000)' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{3,8}$/)
  accountCode!: string;

  @ApiProperty({ description: 'Montant debit (>0 si debit, 0 sinon)', minimum: 0 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  debit!: number;

  @ApiProperty({ description: 'Montant credit (>0 si credit, 0 sinon)', minimum: 0 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  credit!: number;

  @ApiPropertyOptional({ description: 'Libelle de la ligne' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string | null;
}

export class CreateEntryDto {
  @ApiProperty({ description: 'Code journal (ex: BQ)', pattern: '^[A-Z0-9-]{1,8}$' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^[A-Z0-9-]{1,8}$/)
  journalCode!: string;

  @ApiProperty({ description: 'Date comptable ISO YYYY-MM-DD', example: '2026-01-15' })
  @IsISO8601({ strict: true })
  entryDate!: string;

  @ApiProperty({ description: 'Libelle de la piece' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  description!: string;

  @ApiPropertyOptional({ description: 'Reference externe (n de facture, etc.)' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reference?: string | null;

  @ApiProperty({ type: [CreateEntryLineDto], description: 'Lignes debit/credit' })
  @IsArray()
  @ArrayMinSize(2)
  @ValidateNested({ each: true })
  @Type(() => CreateEntryLineDto)
  lines!: CreateEntryLineDto[];
}
