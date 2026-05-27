import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
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
import { AdjustEntryDto } from '../dto/adjust-entry.dto';
import { ReclassifyEntryDto } from '../dto/reclassify-entry.dto';
import {
  TransformationEnvelopeResponse,
  TransformationHistoryResponse,
} from '../dto/responses';
import {
  toTransformationEnvelope,
  toTransformationHistory,
} from '../mappers/transformation-response.mapper';
import { TransformationService } from '../services/transformation.service';
import type { AuditContext } from '../../audit/services/audit-trail.service';

/**
 * `TransformationsController` — Module 4 Transformation Engine (wave 1).
 *
 *   POST /organizations/:id/transformations/reclassify
 *     — Reclassement : changer compte / journal / analytique d'une écriture
 *       source sans toucher la ligne d'origine.
 *
 *   POST /organizations/:id/transformations/adjust
 *     — Ajustement : créer une écriture d'ajustement (régularisation)
 *       liée à une écriture source.
 *
 *   GET  /organizations/:id/transformations/entries/:entryId/history
 *     — Historique complet des transformations appliquées à une écriture.
 *
 * Toutes les routes passent par `TenantGuard` + `assertOrgMatch` pour
 * interdire l'accès cross-tenant. La permission minimale est
 * `transformations.read` en lecture, `transformations.write` en mutation.
 */
@ApiTags('Transformations')
@ApiBearerAuth('bearer')
@Controller('organizations/:id/transformations')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class TransformationsController {
  constructor(private readonly transformations: TransformationService) {}

  /**
   * POST /organizations/:id/transformations/reclassify
   *
   * Reclassify a source staging entry by changing its account, journal,
   * partner, or label. The source entry is NOT modified; a new
   * `entry_transformation` record is created capturing the diff.
   */
  @Post('reclassify')
  @RequirePermission('transformations.write')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: "Reclasser une écriture (changer compte, journal, analytique)" })
  @ApiCreatedResponse({ type: TransformationEnvelopeResponse })
  async reclassify(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
    @CurrentUser('id') actorUserId: CurrentUserContext['id'] | undefined,
    @Body() dto: ReclassifyEntryDto,
    @Req() req: Request,
  ): Promise<TransformationEnvelopeResponse> {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    this.assertActor(actorUserId);
    const ctx = this.buildCtx(req, actorUserId, tokenOrgId);

    const transformation = await this.transformations.reclassifyEntry(
      asTenantId(tokenOrgId),
      actorUserId,
      dto,
      ctx,
    );

    return toTransformationEnvelope(transformation);
  }

  /**
   * POST /organizations/:id/transformations/adjust
   *
   * Create an adjustment entry (écriture de régularisation) linked to a
   * source staging entry. Captures an additional debit or credit amount
   * without touching the source.
   */
  @Post('adjust')
  @RequirePermission('transformations.write')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: "Créer une écriture d'ajustement liée à une écriture source" })
  @ApiCreatedResponse({ type: TransformationEnvelopeResponse })
  async adjust(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
    @CurrentUser('id') actorUserId: CurrentUserContext['id'] | undefined,
    @Body() dto: AdjustEntryDto,
    @Req() req: Request,
  ): Promise<TransformationEnvelopeResponse> {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    this.assertActor(actorUserId);
    const ctx = this.buildCtx(req, actorUserId, tokenOrgId);

    const transformation = await this.transformations.adjustEntry(
      asTenantId(tokenOrgId),
      actorUserId,
      dto,
      ctx,
    );

    return toTransformationEnvelope(transformation);
  }

  /**
   * GET /organizations/:id/transformations/entries/:entryId/history
   *
   * Return the full transformation history for a source entry, ordered
   * chronologically. Includes cancelled (undone) transformations to allow
   * full audit / undo-redo reconstruction (vague 2).
   */
  @Get('entries/:entryId/history')
  @RequirePermission('transformations.read')
  @ApiOperation({ summary: "Historique complet des transformations d'une écriture" })
  @ApiOkResponse({ type: TransformationHistoryResponse })
  async getHistory(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
    @Param('entryId', new ParseUUIDPipe({ version: '4' })) entryId: string,
  ): Promise<TransformationHistoryResponse> {
    this.assertOrgMatch(pathOrgId, tokenOrgId);

    const summaries = await this.transformations.getEntryHistory(asTenantId(tokenOrgId), entryId);

    return toTransformationHistory(summaries);
  }

  // ---------------------------------------------------------------------------
  // Private guards
  // ---------------------------------------------------------------------------

  private assertOrgMatch(
    pathOrgId: string,
    tokenOrgId: CurrentOrgContext['id'] | undefined,
  ): asserts tokenOrgId is string {
    if (!tokenOrgId || tokenOrgId !== pathOrgId) {
      throw new Error('Organization mismatch — TenantGuard should have caught this.');
    }
  }

  private assertActor(
    actorUserId: CurrentUserContext['id'] | undefined,
  ): asserts actorUserId is string {
    if (!actorUserId) {
      throw new Error('No authenticated actor — JwtAuthGuard should have caught this.');
    }
  }

  private buildCtx(req: Request, userId: string, organizationId: string): AuditContext {
    const base = buildAuditRequestContext(req);
    return { ...base, userId, organizationId };
  }
}
