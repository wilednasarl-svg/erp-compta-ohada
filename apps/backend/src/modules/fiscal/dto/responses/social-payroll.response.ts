import { ApiProperty } from '@nestjs/swagger';

export class SocialPayrollLineResponse {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  organizationId!: string;

  @ApiProperty({ example: 2026 })
  periodYear!: number;

  @ApiProperty({ example: 3 })
  periodMonth!: number;

  @ApiProperty({ example: 'MAT-001' })
  employeeRef!: string;

  @ApiProperty({ type: String, example: '350000.00' })
  grossSalary!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;
}

export class ListSocialPayrollLinesResponse {
  @ApiProperty({ type: () => [SocialPayrollLineResponse] })
  lines!: SocialPayrollLineResponse[];
}

export class SocialPayrollLineEnvelopeResponse {
  @ApiProperty({ type: () => SocialPayrollLineResponse })
  line!: SocialPayrollLineResponse;
}

export class SocialContributionLineResponse {
  @ApiProperty({ example: 'CNPS_RETRAITE_EMP' })
  taxCode!: string;

  @ApiProperty()
  label!: string;

  @ApiProperty({
    type: String,
    description: 'Base (Σ bruts plafonnés par tête, ou Σ bruts pour ITS)',
  })
  base!: string;

  @ApiProperty({ type: String, description: 'Montant dû (calculé par tête)' })
  amountDue!: string;

  @ApiProperty({ enum: ['progressive', 'flat'] })
  mode!: 'progressive' | 'flat';
}

export class SocialPeriodSummaryResponse {
  @ApiProperty({ example: 2026 })
  periodYear!: number;

  @ApiProperty({ example: 3 })
  periodMonth!: number;

  @ApiProperty({ example: 42 })
  employeeCount!: number;

  @ApiProperty({ type: String, example: '18000000.00' })
  grossTotal!: string;

  @ApiProperty({ type: () => [SocialContributionLineResponse] })
  contributions!: SocialContributionLineResponse[];

  @ApiProperty({ type: String, description: 'Total des charges sociales dues' })
  totalDue!: string;
}
