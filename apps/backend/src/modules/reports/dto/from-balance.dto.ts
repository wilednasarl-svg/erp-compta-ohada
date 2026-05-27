import { Type } from 'class-transformer';
import { IsArray, IsISO8601, IsOptional, IsString, ValidateNested } from 'class-validator';

export class FromBalanceRowDto {
  @IsString()
  code!: string;

  @IsString()
  label!: string;

  @IsString()
  debit!: string;

  @IsString()
  credit!: string;
}

export class FromBalanceBodyDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FromBalanceRowDto)
  rows!: FromBalanceRowDto[];

  @IsISO8601()
  asAtDate!: string;

  @IsISO8601()
  @IsOptional()
  fiscalYearStartDate?: string;
}
