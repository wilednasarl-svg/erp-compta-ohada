import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import type {
  FiscalBaseKind,
  FiscalDeclarationKind,
  FiscalPeriodicity,
} from '../../types/fiscal.types';

export class FiscalParameterResponse {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  organizationId!: string;

  @ApiProperty({ example: 'TVA' })
  taxCode!: string;

  @ApiProperty()
  label!: string;

  @ApiProperty({ example: 'fiscal' })
  declarationKind!: FiscalDeclarationKind;

  @ApiProperty({ type: String, example: '18.0000' })
  rate!: string;

  @ApiProperty({ example: 'vat_net' })
  baseKind!: FiscalBaseKind;

  @ApiProperty({ example: 'monthly' })
  periodicity!: FiscalPeriodicity;

  @ApiPropertyOptional({ type: String, nullable: true })
  ceiling!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  floorAmount!: string | null;

  @ApiProperty({ example: 15 })
  dueDay!: number;

  @ApiPropertyOptional({ nullable: true })
  chargeAccount!: string | null;

  @ApiPropertyOptional({ nullable: true })
  liabilityAccount!: string | null;

  @ApiProperty({ example: '2026-01-01' })
  effectiveFrom!: string;

  @ApiPropertyOptional({ nullable: true })
  effectiveTo!: string | null;

  @ApiProperty({ type: Boolean })
  isActive!: boolean;

  @ApiPropertyOptional({ nullable: true })
  notes!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;
}

export class FiscalParameterEnvelopeResponse {
  @ApiProperty({ type: () => FiscalParameterResponse })
  parameter!: FiscalParameterResponse;
}

export class ListFiscalParametersResponse {
  @ApiProperty({ type: () => [FiscalParameterResponse] })
  parameters!: FiscalParameterResponse[];
}

export class SeedDefaultsResultResponse {
  @ApiProperty({ example: 10, description: 'Nombre de paramètres créés' })
  created!: number;
}
