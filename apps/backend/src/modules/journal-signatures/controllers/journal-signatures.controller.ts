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
import { SubmitForReviewDto } from '../dto/submit-for-review.dto';
import { JournalSignatureService } from '../services/journal-signature.service';
import type { JournalEntryWorkflowView } from '../services/journal-signature.service';

/**
 * Module 14 wave 1 — Workflow d'approbation et signatures électroniques.
 *
 * Endpoints :
 *   GET  /organizations/:id/entries/:entryId/signature   journals.read    — état + signatures
 *   POST /organizations/:id/entries/:entryId/submit-for-review   journals.write   — draft → in_review
 *   POST /organizations/:id/entries/:entryId/approve     journals.review  — in_review → approved + sig chef_mission
 *   POST /organizations/:id/entries/:entryId/reject      journals.review  — in_review → draft + raison
 *   POST /organizations/:id/entries/:entryId/sign        journals.sign    — approved → locked + sig expert + validate entry
 */
@ApiTags('Journal Entry Signatures')
@ApiBearerAuth('bearer')
@Controller('organizations/:id/entries/:entryId')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class JournalSignaturesController {
  constructor(private readonly signatures: JournalSignatureService) {}

  @Get('signature')
  @RequirePermission('journals.read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'État du workflow d approbation et signatures de l écriture' })
  async getStatus(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @Param('entryId', new ParseUUIDPipe({ version: '4' })) entryId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
  ): Promise<{ status: JournalEntryWorkflowView | null }> {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    const status = await this.signatures.getStatus(asTenantId(tokenOrgId), entryId);
    return { status };
  }

  @Post('submit-for-review')
  @RequirePermission('journals.write')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Soumettre une écriture brouillon au chef de mission' })
  async submit(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @Param('entryId', new ParseUUIDPipe({ version: '4' })) entryId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
    @CurrentUser('id') actorUserId: CurrentUserContext['id'] | undefined,
    @Body() body: SubmitForReviewDto,
    @Req() req: Request,
  ): Promise<{ status: JournalEntryWorkflowView }> {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    this.assertActor(actorUserId);
    const status = await this.signatures.submitForReview(
      asTenantId(tokenOrgId),
      entryId,
      body.comment ?? null,
      actorUserId,
      this.buildCtx(req, actorUserId, tokenOrgId),
    );
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
  ): Promise<{ status: JournalEntryWorkflowView }> {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    this.assertActor(actorUserId);
    const status = await this.signatures.approve(
      asTenantId(tokenOrgId),
      entryId,
      body.comment ?? null,
      actorUserId,
      this.buildCtx(req, actorUserId, tokenOrgId),
    );
    return { status };
  }

  @Post('reject')
  @RequirePermission('journals.review')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rejet par le chef de mission (retour en draft)' })
  async reject(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @Param('entryId', new ParseUUIDPipe({ version: '4' })) entryId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
    @CurrentUser('id') actorUserId: CurrentUserContext['id'] | undefined,
    @Body() body: RejectEntryDto,
    @Req() req: Request,
  ): Promise<{ status: JournalEntryWorkflowView }> {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    this.assertActor(actorUserId);
    const status = await this.signatures.reject(
      asTenantId(tokenOrgId),
      entryId,
      body.reason,
      actorUserId,
      this.buildCtx(req, actorUserId, tokenOrgId),
    );
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
  ): Promise<{ status: JournalEntryWorkflowView }> {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    this.assertActor(actorUserId);
    const status = await this.signatures.sign(
      asTenantId(tokenOrgId),
      entryId,
      body.comment ?? null,
      actorUserId,
      this.buildCtx(req, actorUserId, tokenOrgId),
    );
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
