import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';

import { buildAuditRequestContext } from '../../../common/http/request-context.helper';
import { asTenantId } from '../../../common/persistence/tenant-scope';
import type { CurrentOrgContext, CurrentUserContext } from '../../../common/types/request-context';
import { CurrentOrg } from '../../auth/decorators/current-org.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RequirePermission } from '../../rbac/decorators/require-permission.decorator';
import { PermissionsGuard } from '../../rbac/guards/permissions.guard';
import { TenantGuard } from '../../rbac/guards/tenant.guard';
import { CreateRuleDto } from '../dto/create-rule.dto';
import { ExecuteRuleDto } from '../dto/execute-rule.dto';
import { UpdateRuleDto } from '../dto/update-rule.dto';
import {
  ListRuleExecutionsResponse,
  ListRulesResponse,
  RuleEnvelopeResponse,
  RuleExecutionResultResponse,
} from '../dto/responses';
import {
  toListRuleExecutions,
  toListRules,
  toRuleEnvelope,
  toRuleExecutionResult,
} from '../mappers/rule-response.mapper';
import { RuleEngineService } from '../services/rule-engine.service';
import { RulesService } from '../services/rules.service';
import type { RuleScope } from '../types/rule.types';

/**
 * `RulesController` — Module 5 Rule Engine (wave 1).
 *
 *   POST   /organizations/:id/rules              — créer une règle
 *   GET    /organizations/:id/rules              — lister les règles
 *   GET    /organizations/:id/rules/:ruleId      — détail d'une règle
 *   PATCH  /organizations/:id/rules/:ruleId      — mettre à jour une règle
 *   POST   /organizations/:id/rules/:ruleId/simulate — simuler sur un périmètre
 *   POST   /organizations/:id/rules/:ruleId/apply    — appliquer sur un périmètre
 *   GET    /organizations/:id/rules/:ruleId/executions — historique des exécutions
 *
 * Multi-tenant via TenantGuard + assertOrgMatch implicite dans les services.
 * RBAC : rules.read / rules.write / rules.simulate / rules.apply.
 */
@ApiTags('Rules')
@ApiBearerAuth('bearer')
@Controller('organizations/:id/rules')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class RulesController {
  constructor(
    private readonly rulesService: RulesService,
    private readonly ruleEngine: RuleEngineService,
  ) {}

  // ---------------------------------------------------------------------------
  // CRUD
  // ---------------------------------------------------------------------------

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('rules.write')
  @ApiOperation({ summary: "Créer une règle d'automatisation" })
  @ApiCreatedResponse({ type: RuleEnvelopeResponse })
  async createRule(
    @Param('id', ParseUUIDPipe) _orgId: string,
    @CurrentOrg() org: CurrentOrgContext,
    @CurrentUser() user: CurrentUserContext,
    @Body() dto: CreateRuleDto,
    @Req() req: Request,
  ): Promise<RuleEnvelopeResponse> {
    const ctx = { ...buildAuditRequestContext(req), userId: user.id, organizationId: org.id };
    const entity = await this.rulesService.createRule(asTenantId(org.id), user.id, dto, ctx);
    return toRuleEnvelope(entity);
  }

  @Get()
  @RequirePermission('rules.read')
  @ApiOperation({ summary: "Lister les règles de l'organisation" })
  @ApiOkResponse({ type: ListRulesResponse })
  async listRules(
    @Param('id', ParseUUIDPipe) _orgId: string,
    @CurrentOrg() org: CurrentOrgContext,
  ): Promise<ListRulesResponse> {
    const entities = await this.rulesService.listRules(asTenantId(org.id));
    return toListRules(entities);
  }

  @Get(':ruleId')
  @RequirePermission('rules.read')
  @ApiOperation({ summary: "Détail d'une règle" })
  @ApiOkResponse({ type: RuleEnvelopeResponse })
  async getRule(
    @Param('id', ParseUUIDPipe) _orgId: string,
    @Param('ruleId', ParseUUIDPipe) ruleId: string,
    @CurrentOrg() org: CurrentOrgContext,
  ): Promise<RuleEnvelopeResponse> {
    const entity = await this.rulesService.getRule(asTenantId(org.id), ruleId);
    return toRuleEnvelope(entity);
  }

  @Patch(':ruleId')
  @RequirePermission('rules.write')
  @ApiOperation({ summary: 'Mettre à jour une règle (nom, conditions, actions, statut, priorité)' })
  @ApiOkResponse({ type: RuleEnvelopeResponse })
  async updateRule(
    @Param('id', ParseUUIDPipe) _orgId: string,
    @Param('ruleId', ParseUUIDPipe) ruleId: string,
    @CurrentOrg() org: CurrentOrgContext,
    @CurrentUser() user: CurrentUserContext,
    @Body() dto: UpdateRuleDto,
    @Req() req: Request,
  ): Promise<RuleEnvelopeResponse> {
    const ctx = { ...buildAuditRequestContext(req), userId: user.id, organizationId: org.id };
    const entity = await this.rulesService.updateRule(asTenantId(org.id), user.id, ruleId, dto, ctx);
    return toRuleEnvelope(entity);
  }

  // ---------------------------------------------------------------------------
  // Execution
  // ---------------------------------------------------------------------------

  @Post(':ruleId/simulate')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('rules.simulate')
  @ApiOperation({
    summary: 'Simuler une règle sur un périmètre — aucune transformation créée',
  })
  @ApiOkResponse({ type: RuleExecutionResultResponse })
  async simulate(
    @Param('id', ParseUUIDPipe) _orgId: string,
    @Param('ruleId', ParseUUIDPipe) ruleId: string,
    @CurrentOrg() org: CurrentOrgContext,
    @CurrentUser() user: CurrentUserContext,
    @Body() dto: ExecuteRuleDto,
    @Req() req: Request,
  ): Promise<RuleExecutionResultResponse> {
    const ctx = { ...buildAuditRequestContext(req), userId: user.id, organizationId: org.id };
    const scope: RuleScope = {
      journal: dto.journal,
      dateFrom: dto.dateFrom,
      dateTo: dto.dateTo,
      importSessionId: dto.importSessionId,
    };
    const result = await this.ruleEngine.simulateRules(asTenantId(org.id), ruleId, scope, user.id, ctx);
    return toRuleExecutionResult(result);
  }

  @Post(':ruleId/apply')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('rules.apply')
  @ApiOperation({
    summary: 'Appliquer une règle — crée des transformations via TransformationService',
  })
  @ApiOkResponse({ type: RuleExecutionResultResponse })
  async apply(
    @Param('id', ParseUUIDPipe) _orgId: string,
    @Param('ruleId', ParseUUIDPipe) ruleId: string,
    @CurrentOrg() org: CurrentOrgContext,
    @CurrentUser() user: CurrentUserContext,
    @Body() dto: ExecuteRuleDto,
    @Req() req: Request,
  ): Promise<RuleExecutionResultResponse> {
    const ctx = { ...buildAuditRequestContext(req), userId: user.id, organizationId: org.id };
    const scope: RuleScope = {
      journal: dto.journal,
      dateFrom: dto.dateFrom,
      dateTo: dto.dateTo,
      importSessionId: dto.importSessionId,
    };
    const result = await this.ruleEngine.applyRules(asTenantId(org.id), ruleId, scope, user.id, ctx);
    return toRuleExecutionResult(result);
  }

  // ---------------------------------------------------------------------------
  // Execution history
  // ---------------------------------------------------------------------------

  @Get(':ruleId/executions')
  @RequirePermission('rules.read')
  @ApiOperation({ summary: "Historique des exécutions d'une règle" })
  @ApiOkResponse({ type: ListRuleExecutionsResponse })
  async executionHistory(
    @Param('id', ParseUUIDPipe) _orgId: string,
    @Param('ruleId', ParseUUIDPipe) ruleId: string,
    @CurrentOrg() org: CurrentOrgContext,
  ): Promise<ListRuleExecutionsResponse> {
    const entities = await this.rulesService.getExecutionHistory(asTenantId(org.id), ruleId);
    return toListRuleExecutions(entities);
  }
}
