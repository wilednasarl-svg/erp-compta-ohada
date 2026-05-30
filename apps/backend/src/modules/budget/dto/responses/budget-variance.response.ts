import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Une ligne d'écart réalisé vs budget pour une dimension donnée. */
export class BudgetVarianceRowResponse {
  @ApiPropertyOptional({
    nullable: true,
    description: 'Clé de la dimension (compte, id axe, mois…)',
  })
  dimension!: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Libellé lisible de la dimension' })
  dimensionLabel!: string | null;

  @ApiProperty({ type: String, description: 'Montant budgété (base XOF)', example: '1500000.00' })
  budget!: string;

  @ApiProperty({ type: String, description: 'Montant réalisé (base XOF)', example: '1620000.00' })
  actual!: string;

  @ApiProperty({ type: String, description: 'Écart = réalisé − budget', example: '120000.00' })
  variance!: string;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    description: 'Écart en % du budget (null si budget = 0)',
    example: 8,
  })
  variancePct!: number | null;

  @ApiProperty({
    type: Boolean,
    description: 'Écart favorable au résultat (tient compte du sens du compte SYSCOHADA)',
  })
  favorable!: boolean;

  @ApiProperty({
    type: Number,
    description: 'Taux de réalisation = réalisé / budget × 100',
    example: 108,
  })
  realizationPct!: number | null;
}

export class BudgetVarianceReportResponse {
  @ApiProperty({ example: 2026 })
  fiscalYear!: number;

  @ApiProperty({ example: 'BI', description: 'Scénario budgétaire de référence' })
  budgetScenario!: string;

  @ApiProperty({ example: 'account', description: "Dimension d'agrégation" })
  groupBy!: string;

  @ApiProperty({ type: () => [BudgetVarianceRowResponse] })
  rows!: BudgetVarianceRowResponse[];

  @ApiProperty({ type: String, description: 'Total budget (base XOF)' })
  totalBudget!: string;

  @ApiProperty({ type: String, description: 'Total réalisé (base XOF)' })
  totalActual!: string;

  @ApiProperty({ type: String, description: 'Écart total' })
  totalVariance!: string;
}
