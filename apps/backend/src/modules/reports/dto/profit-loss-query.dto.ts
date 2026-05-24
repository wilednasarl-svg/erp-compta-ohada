import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, Matches } from 'class-validator';

export class ProfitLossQueryDto {
  @ApiProperty({ example: '2026-01-01', description: 'Start of the period (inclusive)' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'fromDate must be YYYY-MM-DD' })
  fromDate!: string;

  @ApiProperty({ example: '2026-12-31', description: 'End of the period (inclusive)' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'toDate must be YYYY-MM-DD' })
  toDate!: string;

  @ApiProperty({
    required: false,
    example: '2025-01-01',
    description:
      'Optional prior-period start date. Provide both `compareFromDate` and `compareToDate` to get an N vs N-1 comparison with absolute variation and % evolution per section and account.',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'compareFromDate must be YYYY-MM-DD' })
  compareFromDate?: string;

  @ApiProperty({
    required: false,
    example: '2025-12-31',
    description: 'Optional prior-period end date — pair with `compareFromDate`.',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'compareToDate must be YYYY-MM-DD' })
  compareToDate?: string;
}
