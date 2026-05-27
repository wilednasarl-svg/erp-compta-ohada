import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import { buildAuditRequestContext } from '../../../common/http/request-context.helper';
import { asTenantId } from '../../../common/persistence/tenant-scope';
import type {
  CurrentOrgContext,
  CurrentUserContext,
} from '../../../common/types/request-context';
import { CurrentOrg } from '../../auth/decorators/current-org.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AuditTrailService } from '../../audit/services/audit-trail.service';
import { RequirePermission } from '../../rbac/decorators/require-permission.decorator';
import { PermissionsGuard } from '../../rbac/guards/permissions.guard';
import { TenantGuard } from '../../rbac/guards/tenant.guard';
import { AgingQueryDto } from '../dto/aging-query.dto';
import {
  AgingEnvelopeResponse,
  CashflowEnvelopeResponse,
  ConsolidatedEnvelopeResponse,
  EvolutionEnvelopeResponse,
  SummaryEnvelopeResponse,
  TopAccountsEnvelopeResponse,
} from '../dto/responses';
import { ConsolidatedQueryDto } from '../dto/consolidated-query.dto';
import { SummaryQueryDto } from '../dto/summary-query.dto';
import { TopAccountsQueryDto } from '../dto/top-accounts-query.dto';
import { DashboardAgingService } from '../services/dashboard-aging.service';
import { DashboardAnalyticsService } from '../services/dashboard-analytics.service';
import { DashboardConsolidatedService } from '../services/dashboard-consolidated.service';
import { DashboardSummaryService } from '../services/dashboard-summary.service';
import { DayDashboardService, type DaySummary } from '../services/day-dashboard.service';

/**
 * `DashboardsController` (Module 19 wave 1) — endpoints d'agrégation
 * orientés UI dashboards comptables. Pas d'export PNG/PDF en wave 1 ;
 * la réponse JSON est consommée par Recharts / Chart.js côté Next.js.
 *
 *   GET /organizations/:id/dashboards/summary?exerciseId=...
 *     → overview KPIs (cash, AR, AP, revenue/expenses YTD, ratios,
 *        breakdown par classe OHADA).
 *
 *   GET /organizations/:id/dashboards/aging?exerciseId=...&type=clients|fournisseurs
 *     → buckets 0-30, 31-60, 61-90, >90 + détail par partenaire.
 *
 * RBAC : permission `dashboards.read` (migration 0076), attribuée à
 * tous les rôles métier avec autorité comptable (admin / expert /
 * chef_mission / comptable / auditeur / client_readonly).
 *
 * Audit : chaque view émet un événement `dashboards.{view_summary,
 * view_aging}` via AuditTrailService — utile pour analyser quels
 * écrans sont consultés et par qui.
 */
@ApiTags('Dashboards')
@ApiBearerAuth('bearer')
@Controller('organizations/:id/dashboards')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class DashboardsController {
  private static readonly MODULE = 'dashboards' as const;

  constructor(
    private readonly summary: DashboardSummaryService,
    private readonly aging: DashboardAgingService,
    private readonly analytics: DashboardAnalyticsService,
    private readonly consolidated: DashboardConsolidatedService,
    private readonly dayDashboard: DayDashboardService,
    private readonly audit: AuditTrailService,
  ) {}

  @Get('summary')
  @RequirePermission('dashboards.read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Vue overview KPIs comptables pour un exercice' })
  @ApiOkResponse({ type: SummaryEnvelopeResponse })
  async getSummary(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
    @CurrentUser('id') actorUserId: CurrentUserContext['id'] | undefined,
    @Query() query: SummaryQueryDto,
    @Req() req: Request,
  ): Promise<SummaryEnvelopeResponse> {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    this.assertActor(actorUserId);
    const result = await this.summary.getSummary(asTenantId(tokenOrgId), query.exerciseId);

    // Audit fire-and-forget (swallow-and-warn dans AuditTrailService).
    void this.audit.record({
      module: DashboardsController.MODULE,
      action: 'view_summary',
      entityType: 'accounting_period',
      entityId: query.exerciseId,
      metadata: {
        companyId: query.companyId ?? null,
        periodStart: result.periodStart,
        periodEnd: result.periodEnd,
      },
      ctx: {
        ...buildAuditRequestContext(req),
        userId: actorUserId,
        organizationId: tokenOrgId,
      },
    });

    return { summary: result };
  }

  @Get('consolidated')
  @RequirePermission('dashboards.read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Vue consolidée KPIs comptables pour plusieurs organisations' })
  @ApiOkResponse({ type: ConsolidatedEnvelopeResponse })
  async getConsolidated(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
    @CurrentUser('id') actorUserId: CurrentUserContext['id'] | undefined,
    @Query() query: ConsolidatedQueryDto,
    @Req() req: Request,
  ): Promise<ConsolidatedEnvelopeResponse> {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    this.assertActor(actorUserId);
    const result = await this.consolidated.getConsolidatedSummary(
      actorUserId,
      query.organizationIds,
      query.year,
    );

    // Audit fire-and-forget
    void this.audit.record({
      module: DashboardsController.MODULE,
      action: 'view_consolidated_summary',
      entityType: 'organization', // Using the primary path org as entity context
      entityId: pathOrgId,
      metadata: {
        organizationsCount: result.organizationsCount,
        year: query.year,
      },
      ctx: {
        ...buildAuditRequestContext(req),
        userId: actorUserId,
        organizationId: tokenOrgId,
      },
    });

    return { consolidated: result };
  }

  @Get('aging')
  @RequirePermission('dashboards.read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Aging clients ou fournisseurs avec buckets et partenaires' })
  @ApiOkResponse({ type: AgingEnvelopeResponse })
  async getAging(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
    @CurrentUser('id') actorUserId: CurrentUserContext['id'] | undefined,
    @Query() query: AgingQueryDto,
    @Req() req: Request,
  ): Promise<AgingEnvelopeResponse> {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    this.assertActor(actorUserId);
    const result = await this.aging.getAging(asTenantId(tokenOrgId), {
      exerciseId: query.exerciseId,
      type: query.type,
      asOfDate: query.asOfDate,
    });

    void this.audit.record({
      module: DashboardsController.MODULE,
      action: 'view_aging',
      entityType: 'accounting_period',
      entityId: query.exerciseId,
      metadata: {
        type: query.type,
        asOfDate: result.asOfDate,
        partnersCount: result.partnerBreakdown.length,
      },
      ctx: {
        ...buildAuditRequestContext(req),
        userId: actorUserId,
        organizationId: tokenOrgId,
      },
    });

    return { aging: result };
  }

  // ─── Wave 2 — analytics ───────────────────────────────────────────

  @Get('cashflow')
  @RequirePermission('dashboards.read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Évolution mensuelle des flux de trésorerie' })
  @ApiOkResponse({ type: CashflowEnvelopeResponse })
  async getCashflow(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
    @CurrentUser('id') actorUserId: CurrentUserContext['id'] | undefined,
    @Query() query: SummaryQueryDto,
    @Req() req: Request,
  ): Promise<CashflowEnvelopeResponse> {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    this.assertActor(actorUserId);
    const result = await this.analytics.getCashflow(asTenantId(tokenOrgId), query.exerciseId);

    void this.audit.record({
      module: DashboardsController.MODULE,
      action: 'view_cashflow',
      entityType: 'accounting_period',
      entityId: query.exerciseId,
      metadata: { pointsCount: result.points.length },
      ctx: {
        ...buildAuditRequestContext(req),
        userId: actorUserId,
        organizationId: tokenOrgId,
      },
    });

    return { cashflow: result };
  }

  @Get('evolution')
  @RequirePermission('dashboards.read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Évolution mensuelle produits / charges / résultat' })
  @ApiOkResponse({ type: EvolutionEnvelopeResponse })
  async getEvolution(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
    @CurrentUser('id') actorUserId: CurrentUserContext['id'] | undefined,
    @Query() query: SummaryQueryDto,
    @Req() req: Request,
  ): Promise<EvolutionEnvelopeResponse> {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    this.assertActor(actorUserId);
    const result = await this.analytics.getEvolution(asTenantId(tokenOrgId), query.exerciseId);

    void this.audit.record({
      module: DashboardsController.MODULE,
      action: 'view_evolution',
      entityType: 'accounting_period',
      entityId: query.exerciseId,
      metadata: { pointsCount: result.points.length },
      ctx: {
        ...buildAuditRequestContext(req),
        userId: actorUserId,
        organizationId: tokenOrgId,
      },
    });

    return { evolution: result };
  }

  @Get('top-accounts')
  @RequirePermission('dashboards.read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Top N comptes par flux dans une catégorie' })
  @ApiOkResponse({ type: TopAccountsEnvelopeResponse })
  async getTopAccounts(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
    @CurrentUser('id') actorUserId: CurrentUserContext['id'] | undefined,
    @Query() query: TopAccountsQueryDto,
    @Req() req: Request,
  ): Promise<TopAccountsEnvelopeResponse> {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    this.assertActor(actorUserId);
    const result = await this.analytics.getTopAccounts(asTenantId(tokenOrgId), {
      exerciseId: query.exerciseId,
      category: query.category,
      limit: query.limit,
    });

    void this.audit.record({
      module: DashboardsController.MODULE,
      action: 'view_top_accounts',
      entityType: 'accounting_period',
      entityId: query.exerciseId,
      metadata: { category: query.category, limit: query.limit ?? 10, rowsCount: result.rows.length },
      ctx: {
        ...buildAuditRequestContext(req),
        userId: actorUserId,
        organizationId: tokenOrgId,
      },
    });

    return { topAccounts: result };
  }

  @Get('day-summary')
  @RequirePermission('dashboards.read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Comptages du jour : travail en attente, snapshot exercice, score, activité récente' })
  async getDaySummary(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
    @CurrentUser('id') actorUserId: CurrentUserContext['id'] | undefined,
  ): Promise<{ daySummary: DaySummary }> {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    this.assertActor(actorUserId);
    const result = await this.dayDashboard.getDaySummary(asTenantId(tokenOrgId));
    return { daySummary: result };
  }

  // ─── Helpers ────────────────────────────────────────────────────────

  private assertOrgMatch(
    pathOrgId: string,
    tokenOrgId: string | undefined,
  ): asserts tokenOrgId is string {
    if (tokenOrgId === undefined || pathOrgId !== tokenOrgId) {
      throw new AppException(ERROR_CODES.ORG_NOT_FOUND, {
        message: 'Organization not found',
      });
    }
  }

  private assertActor(actorUserId: string | undefined): asserts actorUserId is string {
    if (actorUserId === undefined) {
      throw new AppException(ERROR_CODES.AUTH_INVALID_TOKEN, {
        message: 'Authenticated user is required',
      });
    }
  }
}
