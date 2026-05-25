import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import { buildAuditRequestContext } from '../../../common/http/request-context.helper';
import { asTenantId } from '../../../common/persistence/tenant-scope';
import type { CurrentOrgContext, CurrentUserContext } from '../../../common/types/request-context';
import { CurrentOrg } from '../../auth/decorators/current-org.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RequirePermission } from '../../rbac/decorators/require-permission.decorator';
import { PermissionsGuard } from '../../rbac/guards/permissions.guard';
import { TenantGuard } from '../../rbac/guards/tenant.guard';
import { AskAssistantDto } from '../dto/ask-assistant.dto';
import { ListAnomaliesQueryDto } from '../dto/list-anomalies-query.dto';
import { ScanAnomaliesDto } from '../dto/scan-anomalies.dto';
import { SuggestAccountDto } from '../dto/suggest-account.dto';
import { SuggestColumnsDto } from '../dto/suggest-columns.dto';
import { AiAnomalyService } from '../services/ai-anomaly.service';
import { AiAssistantService } from '../services/ai-assistant.service';
import { AiMappingService } from '../services/ai-mapping.service';
import { AiSuggestionService } from '../services/ai-suggestion.service';

@ApiTags('AI Engine')
@ApiBearerAuth('bearer')
@Controller('organizations/:id/ai')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class AiController {
  constructor(
    private readonly anomalies: AiAnomalyService,
    private readonly suggestions: AiSuggestionService,
    private readonly mapping: AiMappingService,
    private readonly assistant: AiAssistantService,
  ) {}

  @Post('anomalies/scan')
  @RequirePermission('ai.scan')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Scanner une période et détecter les anomalies GL' })
  async scan(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
    @CurrentUser('id') actorUserId: CurrentUserContext['id'] | undefined,
    @Body() body: ScanAnomaliesDto,
    @Req() req: Request,
  ) {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    this.assertActor(actorUserId);
    const stats = await this.anomalies.scanExerciseForAnomalies({
      organizationId: asTenantId(tokenOrgId),
      periodId: body.periodId,
      actorId: actorUserId,
      ctx: buildAuditRequestContext(req),
    });
    return { stats };
  }

  @Get('anomalies')
  @RequirePermission('ai.read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Liste paginée des anomalies détectées' })
  async list(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @Query() query: ListAnomaliesQueryDto,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
  ) {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    const { anomalies, total } = await this.anomalies.listForOrg(asTenantId(tokenOrgId), {
      periodId: query.periodId,
      entryId: query.entryId,
      accountId: query.accountId,
      anomalyType: query.anomalyType,
      minScore: query.minScore,
      page: query.page,
      pageSize: query.pageSize,
    });
    return {
      anomalies,
      meta: { total, page: query.page ?? 1, pageSize: query.pageSize ?? 50 },
    };
  }

  @Post('suggestions/entry')
  @RequirePermission('ai.suggest')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Suggérer un compte pour une écriture (heuristique)' })
  async suggest(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
    @CurrentUser('id') actorUserId: CurrentUserContext['id'] | undefined,
    @Body() body: SuggestAccountDto,
    @Req() req: Request,
  ) {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    this.assertActor(actorUserId);
    const suggestion = await this.suggestions.suggestAccountForEntry(
      {
        organizationId: asTenantId(tokenOrgId),
        description: body.description,
        partner: body.partner ?? null,
        side: body.side,
      },
      actorUserId,
      buildAuditRequestContext(req),
    );
    return { suggestion };
  }

  // ─── Wave 2 — AI Mapping ────────────────────────────────────────────

  @Post('mapping/suggest-columns')
  @RequirePermission('ai.suggest')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Suggérer un mapping de colonnes pour un fichier Sage importé',
  })
  async suggestColumns(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
    @CurrentUser('id') actorUserId: CurrentUserContext['id'] | undefined,
    @Body() body: SuggestColumnsDto,
    @Req() req: Request,
  ) {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    this.assertActor(actorUserId);
    const result = await this.mapping.suggestColumns(
      {
        organizationId: asTenantId(tokenOrgId),
        headers: body.headers,
        sampleRows: body.sampleRows,
      },
      actorUserId,
      buildAuditRequestContext(req),
    );
    return result;
  }

  // ─── Wave 2 — AI Assistant (Q&A) ────────────────────────────────────

  @Post('assistant/ask')
  @RequirePermission('ai.suggest')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Question en langage naturel — provider rule-based v1 (wave 2)' })
  async ask(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
    @CurrentUser('id') actorUserId: CurrentUserContext['id'] | undefined,
    @Body() body: AskAssistantDto,
    @Req() req: Request,
  ) {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    this.assertActor(actorUserId);
    const answer = await this.assistant.ask(
      {
        organizationId: asTenantId(tokenOrgId),
        question: body.question,
        periodId: body.periodId,
      },
      actorUserId,
      buildAuditRequestContext(req),
    );
    return { answer };
  }

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
