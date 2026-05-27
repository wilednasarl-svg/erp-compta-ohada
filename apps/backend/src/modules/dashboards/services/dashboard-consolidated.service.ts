import { Injectable, BadRequestException } from '@nestjs/common';
import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import { asTenantId } from '../../../common/persistence/tenant-scope';
import { MembershipRepository } from '../../rbac/repositories/membership.repository';
import { PermissionsCacheService } from '../../rbac/services/permissions-cache.service';
import { AccountingPeriodRepository } from '../../journals/repositories/accounting-period.repository';
import { DashboardSummaryService } from './dashboard-summary.service';
import { OrganizationRepository } from '../../organizations/repositories/organization.repository';
import type { DashboardConsolidatedSummary, DashboardSummary } from '../types/dashboard-types';

@Injectable()
export class DashboardConsolidatedService {
  constructor(
    private readonly memberships: MembershipRepository,
    private readonly permissionsCache: PermissionsCacheService,
    private readonly periods: AccountingPeriodRepository,
    private readonly summaryService: DashboardSummaryService,
    private readonly organizations: OrganizationRepository,
  ) {}

  async getConsolidatedSummary(
    userId: string,
    orgIds: string[],
    year: number,
  ): Promise<DashboardConsolidatedSummary> {
    if (orgIds.length === 0) {
      throw new BadRequestException('At least one organization is required for consolidation');
    }

    const summaries: (DashboardSummary & { orgName: string })[] = [];

    for (const orgId of orgIds) {
      // 1. Verify membership
      const membership = await this.memberships.findActiveByUserAndOrganization(userId, orgId);
      if (!membership) {
        throw new AppException(ERROR_CODES.ORG_NOT_FOUND, {
          message: `User is not a member of organization ${orgId}`,
        });
      }

      // 2. Verify permission
      const hasPermission = await this.permissionsCache.roleHasPermission(
        membership.roleId,
        'dashboards.read',
      );
      if (!hasPermission) {
        throw new AppException(ERROR_CODES.FORBIDDEN_PERMISSION, {
          message: `User lacks dashboards.read permission in organization ${orgId}`,
        });
      }

      // 3. Find the annual root period for this year
      // Find a period that contains December 31st of the requested year
      const targetDate = `${year}-12-31`;
      const period = await this.periods.findContainingDate(orgId, targetDate, 'ANNUAL');
      
      if (!period) {
        // Skip organizations that don't have an exercise for this year, or maybe throw?
        // Let's just skip them to allow consolidation of those that do.
        continue;
      }

      const orgData = await this.organizations.findActiveById(orgId);
      if (!orgData) {
        continue;
      }

      // 4. Fetch the summary for this organization
      const summary = await this.summaryService.getSummary(asTenantId(orgId), period.id);
      summaries.push({ ...summary, orgName: orgData.name });
    }

    if (summaries.length === 0) {
       return {
          year,
          organizationsCount: 0,
          currency: 'XOF',
          metrics: {
            cashBalance: '0.00',
            receivables: '0.00',
            payables: '0.00',
            revenue: '0.00',
            expenses: '0.00',
            netResult: '0.00',
          },
          organizationsData: [],
       };
    }

    // 5. Aggregate
    let sumCash = 0;
    let sumReceivables = 0;
    let sumPayables = 0;
    let sumRevenue = 0;
    let sumExpenses = 0;
    let currency = summaries[0].currency;

    const organizationsData = summaries.map(s => {
      const rev = Number(s.revenueYtd);
      const exp = Number(s.expensesYtd);
      return {
        organizationId: s.organizationId,
        organizationName: s.orgName,
        metrics: {
          cashBalance: Number(s.cashBalance).toFixed(2),
          receivables: Number(s.receivables).toFixed(2),
          payables: Number(s.payables).toFixed(2),
          revenue: rev.toFixed(2),
          expenses: exp.toFixed(2),
          netResult: (rev - exp).toFixed(2),
        }
      };
    });

    for (const s of summaries) {
      sumCash += Number(s.cashBalance);
      sumReceivables += Number(s.receivables);
      sumPayables += Number(s.payables);
      sumRevenue += Number(s.revenueYtd);
      sumExpenses += Number(s.expensesYtd);
    }

    const netResultYtd = sumRevenue - sumExpenses;

    return {
      year,
      organizationsCount: summaries.length,
      currency,
      metrics: {
        cashBalance: sumCash.toFixed(2),
        receivables: sumReceivables.toFixed(2),
        payables: sumPayables.toFixed(2),
        revenue: sumRevenue.toFixed(2),
        expenses: sumExpenses.toFixed(2),
        netResult: netResultYtd.toFixed(2),
      },
      organizationsData,
    };
  }
}
