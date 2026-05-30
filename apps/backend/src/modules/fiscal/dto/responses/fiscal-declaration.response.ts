import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import {
  FISCAL_DECLARATION_STATUSES,
  type FiscalDeclarationStatus,
} from '../../types/fiscal.types';

export class FiscalDeclarationResponse {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  organizationId!: string;

  @ApiProperty({ example: 'TVA' })
  taxCode!: string;

  @ApiPropertyOptional({ nullable: true })
  label!: string | null;

  @ApiProperty({ example: 2026 })
  periodYear!: number;

  @ApiPropertyOptional({ nullable: true, example: 3 })
  periodMonth!: number | null;

  @ApiProperty({ type: String, example: '45000000.00' })
  baseAmount!: string;

  @ApiProperty({ type: String, example: '18.0000' })
  rate!: string;

  @ApiProperty({ type: String, example: '8100000.00' })
  amountDue!: string;

  @ApiProperty({ example: 'XOF' })
  currency!: string;

  @ApiProperty({ example: '2026-04-15' })
  dueDate!: string;

  @ApiProperty({ enum: FISCAL_DECLARATION_STATUSES as readonly string[] })
  status!: FiscalDeclarationStatus;

  @ApiPropertyOptional({ nullable: true })
  reference!: string | null;

  @ApiPropertyOptional({ nullable: true })
  justificatifUrl!: string | null;

  @ApiPropertyOptional({ nullable: true })
  chargeAccount!: string | null;

  @ApiPropertyOptional({ nullable: true })
  liabilityAccount!: string | null;

  @ApiPropertyOptional({ nullable: true })
  comment!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;
}

export class FiscalDeclarationEnvelopeResponse {
  @ApiProperty({ type: () => FiscalDeclarationResponse })
  declaration!: FiscalDeclarationResponse;
}

export class ListFiscalDeclarationsResponse {
  @ApiProperty({ type: () => [FiscalDeclarationResponse] })
  declarations!: FiscalDeclarationResponse[];

  @ApiProperty({ example: 50 })
  total!: number;
}
