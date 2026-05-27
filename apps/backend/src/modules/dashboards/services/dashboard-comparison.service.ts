import { Injectable } from '@nestjs/common';
import { asTenantId } from '../../../common/persistence/tenant-scope';
import { AccountingPeriodRepository } from '../../journals/repositories/accounting-period.repository';
import { OrganizationRepository } from '../../organizations/repositories/organization.repository';
import { DashboardSummaryService } from './dashboard-summary.service';
import type { DashboardComparisonSummary, DashboardComparisonData } from '../types/dashboard-types';

@Injectable()
export class DashboardComparisonService {
  constructor(
    private readonly periods: AccountingPeriodRepository,
    private readonly summaryService: DashboardSummaryService,
    private readonly organizations: OrganizationRepository,
  ) {}

  async getComparisonSummary(
    orgId: string,
    years: number[],
  ): Promise<DashboardComparisonSummary> {
    const orgData = await this.organizations.findActiveById(orgId);
    if (!orgData) {
      return {
        organizationId: orgId,
        organizationName: 'Unknown',
        currency: 'XOF',
        yearsData: [],
      };
    }

    const yearsData: DashboardComparisonData[] = [];

    for (const year of years) {
      const targetDate = `${year}-12-31`;
      const period = await this.periods.findContainingDate(orgId, targetDate, 'ANNUAL');
      
      if (!period) {
        // If there's no period for this year, we still return a 0ed result for consistent comparison
        yearsData.push({
          year,
          periodStart: `${year}-01-01`,
          periodEnd: `${year}-12-31`,
          metrics: {
            cashBalance: '0.00',
            receivables: '0.00',
            payables: '0.00',
            revenue: '0.00',
            expenses: '0.00',
            netResult: '0.00',
          },
        });
        continue;
      }

      const summary = await this.summaryService.getSummary(asTenantId(orgId), period.id);

      yearsData.push({
        year,
        periodStart: summary.periodStart,
        periodEnd: summary.periodEnd,
        metrics: {
          cashBalance: Number(summary.cashBalance).toFixed(2),
          receivables: Number(summary.receivables).toFixed(2),
          payables: Number(summary.payables).toFixed(2),
          revenue: Number(summary.revenueYtd).toFixed(2),
          expenses: Number(summary.expensesYtd).toFixed(2),
          netResult: Number(summary.netResultYtd).toFixed(2),
        },
      });
    }

    // Sort by year
    yearsData.sort((a, b) => a.year - b.year);

    return {
      organizationId: orgId,
      organizationName: orgData.name,
      currency: yearsData.length > 0 && yearsData[0].metrics.revenue !== '0.00' 
        ? 'XOF' // Could use real currency from summary but XOF is standard for now
        : 'XOF',
      yearsData,
    };
  }
}
