import {
  Body,
  Controller,
  Delete,
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

import { buildAuditRequestContext } from '../../../common/http/request-context.helper';
import { asTenantId } from '../../../common/persistence/tenant-scope';
import type { CurrentOrgContext, CurrentUserContext } from '../../../common/types/request-context';
import { CurrentOrg } from '../../auth/decorators/current-org.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RequirePermission } from '../../rbac/decorators/require-permission.decorator';
import { PermissionsGuard } from '../../rbac/guards/permissions.guard';
import { TenantGuard } from '../../rbac/guards/tenant.guard';
import { AutoLetterByInvoiceDto } from '../dto/auto-letter-by-invoice.dto';
import { BreakLetteringDto } from '../dto/break-lettering.dto';
import { CreateLetteringDto } from '../dto/create-lettering.dto';
import type { LetteringStatus } from '../entities/partner-lettering.entity';
import {
  LetteringService,
  type AutoLetterByInvoiceResult,
  type AutoLetterPreviewResult,
  type LetteringView,
} from '../services/lettering.service';

/**
 * `LetteringsController` — REST surface for partner-account
 * reconciliation (Module 8 wave 2).
 *
 *   POST   /organizations/:id/letterings           — create
 *   GET    /organizations/:id/letterings           — list (filterable)
 *   GET    /organizations/:id/letterings/:lid      — detail (incl. lineIds)
 *   DELETE /organizations/:id/letterings/:lid      — break (audit + unlet)
 */
@ApiTags('Letterings')
@ApiBearerAuth('bearer')
@Controller('organizations/:id/letterings')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class LetteringsController {
  constructor(private readonly letterings: LetteringService) {}

  @Post()
  @RequirePermission('journals.lettering')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Créer un lettrage (réconciliation tiers)' })
  async create(
    @Param('id', new ParseUUIDPipe({ version: '4' })) _id: string,
    @Body() dto: CreateLetteringDto,
    @CurrentOrg() org: CurrentOrgContext,
    @CurrentUser('id') actorUserId: CurrentUserContext['id'],
    @Req() req: Request,
  ): Promise<{ lettering: LetteringView }> {
    const lettering = await this.letterings.create(
      asTenantId(org.id),
      { journalEntryLineIds: dto.journalEntryLineIds },
      actorUserId,
      buildAuditRequestContext(req),
    );
    return { lettering };
  }

  @Post('auto-by-invoice')
  @RequirePermission('journals.lettering')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Lettrage automatique par N° de facture',
    description:
      'Rapproche automatiquement les lignes non lettrées des comptes tiers ' +
      'partageant le même N° de facture, lorsque le groupe est équilibré.',
  })
  async autoByInvoice(
    @Param('id', new ParseUUIDPipe({ version: '4' })) _id: string,
    @Body() dto: AutoLetterByInvoiceDto,
    @CurrentOrg() org: CurrentOrgContext,
    @CurrentUser('id') actorUserId: CurrentUserContext['id'],
    @Req() req: Request,
  ): Promise<{ result: AutoLetterByInvoiceResult }> {
    const result = await this.letterings.autoLetterByInvoice(
      asTenantId(org.id),
      { partnerAccountId: dto.partnerAccountId },
      actorUserId,
      buildAuditRequestContext(req),
    );
    return { result };
  }

  @Get('auto-by-invoice/preview')
  @RequirePermission('journals.read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Prévisualisation du lettrage automatique par N° de facture (dry-run)',
    description:
      'Calcule les factures qui seraient lettrées (mêmes règles que le lettrage ' +
      'automatique) sans rien créer. Permet de valider avant de lettrer.',
  })
  async previewAutoByInvoice(
    @Param('id', new ParseUUIDPipe({ version: '4' })) _id: string,
    @CurrentOrg() org: CurrentOrgContext,
    @Query('partnerAccountId') partnerAccountId?: string,
  ): Promise<{ preview: AutoLetterPreviewResult }> {
    const preview = await this.letterings.previewAutoLetterByInvoice(asTenantId(org.id), {
      partnerAccountId,
    });
    return { preview };
  }

  @Get()
  @RequirePermission('journals.read')
  @ApiOperation({ summary: 'Lister les lettrages' })
  async list(
    @Param('id', new ParseUUIDPipe({ version: '4' })) _id: string,
    @CurrentOrg() org: CurrentOrgContext,
    @Query('partnerAccountId') partnerAccountId?: string,
    @Query('status') status?: LetteringStatus,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ): Promise<{ letterings: LetteringView[] }> {
    const letterings = await this.letterings.listForOrg(asTenantId(org.id), {
      partnerAccountId,
      status,
      limit: limit !== undefined ? Number.parseInt(limit, 10) : undefined,
      offset: offset !== undefined ? Number.parseInt(offset, 10) : undefined,
    });
    return { letterings };
  }

  @Get(':letteringId')
  @RequirePermission('journals.read')
  @ApiOperation({ summary: 'Détail d un lettrage (avec lignes)' })
  async getOne(
    @Param('id', new ParseUUIDPipe({ version: '4' })) _id: string,
    @Param('letteringId', new ParseUUIDPipe({ version: '4' })) letteringId: string,
    @CurrentOrg() org: CurrentOrgContext,
  ): Promise<{ lettering: LetteringView }> {
    const lettering = await this.letterings.getById(asTenantId(org.id), letteringId);
    return { lettering };
  }

  @Delete(':letteringId')
  @RequirePermission('journals.lettering')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Délétrer (rupture du lettrage avec motif)' })
  async breakLettering(
    @Param('id', new ParseUUIDPipe({ version: '4' })) _id: string,
    @Param('letteringId', new ParseUUIDPipe({ version: '4' })) letteringId: string,
    @Body() dto: BreakLetteringDto,
    @CurrentOrg() org: CurrentOrgContext,
    @CurrentUser('id') actorUserId: CurrentUserContext['id'],
    @Req() req: Request,
  ): Promise<void> {
    await this.letterings.breakLettering(
      asTenantId(org.id),
      letteringId,
      dto.reason,
      actorUserId,
      buildAuditRequestContext(req),
    );
  }
}
