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
import { BreakLetteringDto } from '../dto/break-lettering.dto';
import { CreateLetteringDto } from '../dto/create-lettering.dto';
import type { LetteringStatus } from '../entities/partner-lettering.entity';
import { LetteringService, type LetteringView } from '../services/lettering.service';

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
