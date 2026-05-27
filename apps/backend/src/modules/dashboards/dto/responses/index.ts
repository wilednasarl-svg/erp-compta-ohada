import { ApiProperty } from '@nestjs/swagger';

import type {
  AgingType,
  DashboardAging,
  DashboardCashflow,
  DashboardEvolution,
  DashboardSummary,
  DashboardTopAccounts,
  TopAccountCategory,
} from '../../types/dashboard-types';

export class DashboardSummaryResponse implements DashboardSummary {
  @ApiProperty({ format: 'uuid' })
  organizationId!: string;
  @ApiProperty({ format: 'uuid' })
  exerciseId!: string;
  @ApiProperty()
  periodStart!: string;
  @ApiProperty()
  periodEnd!: string;
  @ApiProperty()
  currency!: string;
  @ApiProperty({ description: 'Solde net trésorerie (DECIMAL string)' })
  cashBalance!: string;
  @ApiProperty({ description: 'Créances clients nettes (DECIMAL string)' })
  receivables!: string;
  @ApiProperty({ description: 'Dettes fournisseurs nettes (DECIMAL string)' })
  payables!: string;
  @ApiProperty({ description: 'Produits YTD (DECIMAL string)' })
  revenueYtd!: string;
  @ApiProperty({ description: 'Charges YTD (DECIMAL string)' })
  expensesYtd!: string;
  @ApiProperty({ description: 'Résultat net YTD (DECIMAL string)' })
  netResultYtd!: string;
  @ApiProperty({ nullable: true, type: Number })
  grossMarginRatio!: number | null;
  @ApiProperty({ nullable: true, type: Number })
  liquidityRatio!: number | null;
  @ApiProperty({ type: 'object', isArray: true, description: 'Breakdown par classe OHADA' })
  accountClassBreakdown!: DashboardSummary['accountClassBreakdown'];
}

export class SummaryEnvelopeResponse {
  @ApiProperty({ type: () => DashboardSummaryResponse })
  summary!: DashboardSummaryResponse;
}

export class DashboardAgingResponse implements DashboardAging {
  @ApiProperty({ format: 'uuid' })
  organizationId!: string;
  @ApiProperty({ enum: ['clients', 'fournisseurs'] })
  type!: AgingType;
  @ApiProperty()
  asOfDate!: string;
  @ApiProperty()
  currency!: string;
  @ApiProperty({ type: 'object', isArray: true, description: 'Buckets 0-30, 31-60, 61-90, >90' })
  buckets!: DashboardAging['buckets'];
  @ApiProperty()
  totalOutstanding!: string;
  @ApiProperty({ type: 'object', isArray: true, description: 'Détail par partenaire' })
  partnerBreakdown!: DashboardAging['partnerBreakdown'];
}

export class AgingEnvelopeResponse {
  @ApiProperty({ type: () => DashboardAgingResponse })
  aging!: DashboardAgingResponse;
}

export class DashboardCashflowResponse implements DashboardCashflow {
  @ApiProperty({ format: 'uuid' })
  organizationId!: string;
  @ApiProperty({ format: 'uuid' })
  exerciseId!: string;
  @ApiProperty()
  periodStart!: string;
  @ApiProperty()
  periodEnd!: string;
  @ApiProperty()
  currency!: string;
  @ApiProperty({ type: 'object', isArray: true, description: 'Points mensuels de trésorerie' })
  points!: DashboardCashflow['points'];
  @ApiProperty({ type: 'object', description: 'Totaux inflow/outflow/netFlow' })
  totals!: DashboardCashflow['totals'];
}

export class CashflowEnvelopeResponse {
  @ApiProperty({ type: () => DashboardCashflowResponse })
  cashflow!: DashboardCashflowResponse;
}

export class DashboardEvolutionResponse implements DashboardEvolution {
  @ApiProperty({ format: 'uuid' })
  organizationId!: string;
  @ApiProperty({ format: 'uuid' })
  exerciseId!: string;
  @ApiProperty()
  periodStart!: string;
  @ApiProperty()
  periodEnd!: string;
  @ApiProperty()
  currency!: string;
  @ApiProperty({ type: 'object', isArray: true, description: 'Points mensuels P&L' })
  points!: DashboardEvolution['points'];
  @ApiProperty({ type: 'object', description: 'Totaux revenue/expenses/netResult' })
  totals!: DashboardEvolution['totals'];
}

export class EvolutionEnvelopeResponse {
  @ApiProperty({ type: () => DashboardEvolutionResponse })
  evolution!: DashboardEvolutionResponse;
}

export class DashboardTopAccountsResponse implements DashboardTopAccounts {
  @ApiProperty({ format: 'uuid' })
  organizationId!: string;
  @ApiProperty({ format: 'uuid' })
  exerciseId!: string;
  @ApiProperty({ enum: ['expenses', 'revenue'] })
  category!: TopAccountCategory;
  @ApiProperty()
  periodStart!: string;
  @ApiProperty()
  periodEnd!: string;
  @ApiProperty()
  currency!: string;
  @ApiProperty()
  totalAmount!: string;
  @ApiProperty({ type: 'object', isArray: true, description: 'Lignes top N comptes' })
  rows!: DashboardTopAccounts['rows'];
}

export class TopAccountsEnvelopeResponse {
  @ApiProperty({ type: () => DashboardTopAccountsResponse })
  topAccounts!: DashboardTopAccountsResponse;
}

export class ConsolidatedMetricsResponse {
  @ApiProperty({ description: 'Solde net trésorerie (DECIMAL string)' })
  cashBalance!: string;
  @ApiProperty({ description: 'Créances clients nettes (DECIMAL string)' })
  receivables!: string;
  @ApiProperty({ description: 'Dettes fournisseurs nettes (DECIMAL string)' })
  payables!: string;
  @ApiProperty({ description: 'Produits (DECIMAL string)' })
  revenue!: string;
  @ApiProperty({ description: 'Charges (DECIMAL string)' })
  expenses!: string;
  @ApiProperty({ description: 'Résultat net (DECIMAL string)' })
  netResult!: string;
}

export class ConsolidatedOrganizationDataResponse {
  @ApiProperty({ format: 'uuid' })
  organizationId!: string;
  @ApiProperty()
  organizationName!: string;
  @ApiProperty({ type: () => ConsolidatedMetricsResponse })
  metrics!: ConsolidatedMetricsResponse;
}

export class ConsolidatedSummaryResponse {
  @ApiProperty()
  year!: number;
  @ApiProperty()
  organizationsCount!: number;
  @ApiProperty()
  currency!: string;
  @ApiProperty({ type: () => ConsolidatedMetricsResponse })
  metrics!: ConsolidatedMetricsResponse;
  @ApiProperty({ type: () => ConsolidatedOrganizationDataResponse, isArray: true })
  organizationsData!: readonly ConsolidatedOrganizationDataResponse[];
}

export class ConsolidatedEnvelopeResponse {
  @ApiProperty({ type: () => ConsolidatedSummaryResponse })
  consolidated!: ConsolidatedSummaryResponse;
}
