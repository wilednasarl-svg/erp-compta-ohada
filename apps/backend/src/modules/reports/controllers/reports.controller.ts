import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { asTenantId } from '../../../common/persistence/tenant-scope';
import type { CurrentOrgContext } from '../../../common/types/request-context';
import { CurrentOrg } from '../../auth/decorators/current-org.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RequirePermission } from '../../rbac/decorators/require-permission.decorator';
import { PermissionsGuard } from '../../rbac/guards/permissions.guard';
import { TenantGuard } from '../../rbac/guards/tenant.guard';
import { BalanceSheetQueryDto } from '../dto/balance-sheet-query.dto';
import { GeneralLedgerQueryDto } from '../dto/general-ledger-query.dto';
import { ProfitLossQueryDto } from '../dto/profit-loss-query.dto';
import { TrialBalanceQueryDto } from '../dto/trial-balance-query.dto';
import {
  ReportsService,
  type BalanceSheetReport,
  type GeneralLedgerReport,
  type ProfitLossReport,
  type TrialBalanceReport,
} from '../services/reports.service';

/**
 * `ReportsController` — Module 9 wave 1 read-only financial reports.
 *
 *   GET /organizations/:id/reports/trial-balance               (journals.reports)
 *   GET /organizations/:id/reports/general-ledger/:accountId   (journals.reports)
 *
 * Both endpoints require `journals.reports`. Tenant is resolved from
 * the JWT via TenantGuard and forwarded to the service as a branded
 * TenantId.
 */
@ApiTags('Reports')
@ApiBearerAuth('bearer')
@Controller('organizations/:id/reports')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('trial-balance')
  @RequirePermission('journals.reports')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Balance générale (par compte, sur la période)' })
  async trialBalance(
    @Param('id', new ParseUUIDPipe({ version: '4' })) _id: string,
    @Query() query: TrialBalanceQueryDto,
    @CurrentOrg() org: CurrentOrgContext,
  ): Promise<{ report: TrialBalanceReport }> {
    const report = await this.reports.getTrialBalance(asTenantId(org.id), {
      fromDate: query.fromDate,
      toDate: query.toDate,
      accountClass: query.accountClass,
      accountCodeFrom: query.accountCodeFrom,
      accountCodeTo: query.accountCodeTo,
      hideEmpty: query.hideEmpty,
    });
    return { report };
  }

  @Get('general-ledger/:accountId')
  @RequirePermission('journals.reports')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Grand livre d un compte (chronologique + cumul)' })
  async generalLedger(
    @Param('id', new ParseUUIDPipe({ version: '4' })) _id: string,
    @Param('accountId', new ParseUUIDPipe({ version: '4' })) accountId: string,
    @Query() query: GeneralLedgerQueryDto,
    @CurrentOrg() org: CurrentOrgContext,
  ): Promise<{ report: GeneralLedgerReport }> {
    const report = await this.reports.getGeneralLedger(asTenantId(org.id), {
      accountId,
      fromDate: query.fromDate,
      toDate: query.toDate,
    });
    return { report };
  }

  @Get('profit-loss')
  @RequirePermission('journals.reports')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Compte de résultat (classes 6 charges + 7 produits) sur la période',
  })
  async profitLoss(
    @Param('id', new ParseUUIDPipe({ version: '4' })) _id: string,
    @Query() query: ProfitLossQueryDto,
    @CurrentOrg() org: CurrentOrgContext,
  ): Promise<{ report: ProfitLossReport }> {
    const report = await this.reports.getProfitLoss(asTenantId(org.id), {
      fromDate: query.fromDate,
      toDate: query.toDate,
    });
    return { report };
  }

  @Get('balance-sheet')
  @RequirePermission('journals.reports')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Bilan OHADA (actif/passif ventilés selon SYSCOHADA AUDCIF) à une date',
  })
  async balanceSheet(
    @Param('id', new ParseUUIDPipe({ version: '4' })) _id: string,
    @Query() query: BalanceSheetQueryDto,
    @CurrentOrg() org: CurrentOrgContext,
  ): Promise<{ report: BalanceSheetReport }> {
    const report = await this.reports.getBalanceSheet(asTenantId(org.id), {
      asAtDate: query.asAtDate,
    });
    return { report };
  }
}
