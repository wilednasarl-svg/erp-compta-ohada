import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class FiscalBracketResponse {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  organizationId!: string;

  @ApiProperty({ example: 'ITS' })
  taxCode!: string;

  @ApiProperty({ example: '2026-01-01' })
  effectiveFrom!: string;

  @ApiProperty({ example: 1 })
  bracketOrder!: number;

  @ApiProperty({ type: String, example: '0.00' })
  fromAmount!: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: '75000.00' })
  toAmount!: string | null;

  @ApiProperty({ type: String, example: '16.0000' })
  rate!: string;
}

export class ListFiscalBracketsResponse {
  @ApiProperty({ type: () => [FiscalBracketResponse] })
  brackets!: FiscalBracketResponse[];
}
