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
import { ApproveEntryDto } from '../dto/approve-entry.dto';
import { RejectEntryDto } from '../dto/reject-entry.dto';
import { SignEntryDto } from '../dto/sign-entry.dto';
import { SubmitEntryForReviewDto } from '../dto/submit-entry-for-review.dto';
import { EntryWorkflowService } from '../services/entry-workflow.service';
import type {
  EntryWorkflowHistoryView,
  EntryWorkflowView,
} from '../services/entry-workflow.service';

/**
 * Module 14 wave 1 — Workflow d'approbation + signatures électroniques.
 *
 * Endpoints branchés sur le chemin `organizations/:id/entries/:entryId` :
 *   GET  /history             journals.read    — historique workflow + signatures
 *   POST /submit-for-review   journals.write   — draft → in_review
 *   POST /approve             journals.review  — in_review → approved + sig chef_mission
 *   POST /reject              journals.review  — in_review → draft + raison
 *   POST /sign                journals.sign    — approved → locked + sig expert + validate entry
 */
@ApiTags('Journal Entry Workflow')
@ApiBearerAuth('bearer')
@Controller('organizations/:id/entries/:entryId')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class EntryWorkflowController {
  constructor(private readonly workflow: EntryWorkflowService) {}

  @Get('history')
  @RequirePermission('journals.read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Historique workflow + signatures de l ecriture' })
  async getHistory(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @Param('entryId', new ParseUUIDPipe({ version: '4' })) entryId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
  ): Promise<{ status: EntryWorkflowHistoryView }> {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    const status = await this.workflow.getHistory(asTenantId(tokenOrgId), entryId);
    return { status };
  }

  @Post('submit-for-review')
  @RequirePermission('journals.write')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Soumettre une ecriture brouillon au chef de mission' })
  async submit(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @Param('entryId', new ParseUUIDPipe({ version: '4' })) entryId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
    @CurrentUser('id') actorUserId: CurrentUserContext['id'] | undefined,
    @Body() body: SubmitEntryForReviewDto,
    @Req() req: Request,
  ): Promise<{ status: EntryWorkflowView }> {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    this.assertActor(actorUserId);
    const status = await this.workflow.submitForReview({
      organizationId: asTenantId(tokenOrgId),
      entryId,
      actorId: actorUserId,
      comment: body.comment ?? null,
      ctx: this.buildCtx(req, actorUserId, tokenOrgId),
    });
    return { status };
  }

  @Post('approve')
  @RequirePermission('journals.review')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approbation chef de mission + signature niveau 1' })
  async approve(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @Param('entryId', new ParseUUIDPipe({ version: '4' })) entryId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
    @CurrentUser('id') actorUserId: CurrentUserContext['id'] | undefined,
    @Body() body: ApproveEntryDto,
    @Req() req: Request,
  ): Promise<{ status: EntryWorkflowView }> {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    this.assertActor(actorUserId);
    const status = await this.workflow.approve({
      organizationId: asTenantId(tokenOrgId),
      entryId,
      actorId: actorUserId,
      comment: body.comment ?? null,
      ctx: this.buildCtx(req, actorUserId, tokenOrgId),
    });
    return { status };
  }

  @Post('reject')
  @RequirePermission('journals.review')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rejet par le chef de mission ou retour pour rework' })
  async reject(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @Param('entryId', new ParseUUIDPipe({ version: '4' })) entryId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
    @CurrentUser('id') actorUserId: CurrentUserContext['id'] | undefined,
    @Body() body: RejectEntryDto,
    @Req() req: Request,
  ): Promise<{ status: EntryWorkflowView }> {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    this.assertActor(actorUserId);
    const status = await this.workflow.reject({
      organizationId: asTenantId(tokenOrgId),
      entryId,
      actorId: actorUserId,
      reason: body.reason,
      ctx: this.buildCtx(req, actorUserId, tokenOrgId),
    });
    return { status };
  }

  @Post('sign')
  @RequirePermission('journals.sign')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Signature expert-comptable: lock + validate entry' })
  async sign(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @Param('entryId', new ParseUUIDPipe({ version: '4' })) entryId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
    @CurrentUser('id') actorUserId: CurrentUserContext['id'] | undefined,
    @Body() body: SignEntryDto,
    @Req() req: Request,
  ): Promise<{ status: EntryWorkflowView }> {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    this.assertActor(actorUserId);
    const status = await this.workflow.sign({
      organizationId: asTenantId(tokenOrgId),
      entryId,
      actorId: actorUserId,
      comment: body.comment ?? null,
      ctx: this.buildCtx(req, actorUserId, tokenOrgId),
    });
    return { status };
  }

  // ─── Helpers ────────────────────────────────────────────────────────

  private buildCtx(req: Request, userId: string, organizationId: string) {
    return { ...buildAuditRequestContext(req), userId, organizationId };
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
