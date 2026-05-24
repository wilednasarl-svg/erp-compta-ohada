import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

export class BalanceSheetQueryDto {
  @ApiProperty({
    example: '2026-12-31',
    description: 'Cumulative balance as at this date (inclusive)',
  })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'asAtDate must be YYYY-MM-DD' })
  asAtDate!: string;
}
