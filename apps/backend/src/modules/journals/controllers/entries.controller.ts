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
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
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
import { CancelEntryDto } from '../dto/cancel-entry.dto';
import { CreateEntryDto } from '../dto/create-entry.dto';
import { ListEntriesQueryDto } from '../dto/list-entries-query.dto';
import {
  JournalEntryDetailResponse,
  ListEntriesResponse,
} from '../dto/responses';
import {
  toJournalEntryDetail,
  toListEntries,
} from '../mappers/journal-response.mapper';
import { EntriesService } from '../services/entries.service';
import type { JournalEntryStatus } from '../types/journal.types';

@ApiTags('Journal Entries')
@ApiBearerAuth('bearer')
@Controller('organizations/:id/entries')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class EntriesController {
  constructor(private readonly entries: EntriesService) {}

  @Get()
  @RequirePermission('journals.read')
  @ApiOperation({ summary: 'Lister les ecritures comptables' })
  @ApiOkResponse({ type: ListEntriesResponse })
  async list(
    @Param('id', ParseUUIDPipe) _id: string,
    @CurrentOrg() org: CurrentOrgContext,
    @Query() query: ListEntriesQueryDto,
  ): Promise<ListEntriesResponse> {
    const result = await this.entries.listForOrg(asTenantId(org.id), {
      status: query.status as JournalEntryStatus | undefined,
      journalId: query.journalId,
      periodId: query.periodId,
      page: query.page,
      pageSize: query.pageSize,
    });
    return toListEntries(result.entries, result.total);
  }

  @Get(':entryId')
  @RequirePermission('journals.read')
  @ApiOperation({ summary: 'Detail d une ecriture avec ses lignes' })
  @ApiOkResponse({ type: JournalEntryDetailResponse })
  async getOne(
    @Param('id', ParseUUIDPipe) _id: string,
    @Param('entryId', ParseUUIDPipe) entryId: string,
    @CurrentOrg() org: CurrentOrgContext,
  ): Promise<JournalEntryDetailResponse> {
    const view = await this.entries.getEntry(asTenantId(org.id), entryId);
    return toJournalEntryDetail(view);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('journals.write')
  @ApiOperation({ summary: 'Creer une ecriture en brouillon' })
  @ApiCreatedResponse({ type: JournalEntryDetailResponse })
  async createDraft(
    @Param('id', ParseUUIDPipe) _id: string,
    @CurrentOrg() org: CurrentOrgContext,
    @CurrentUser() user: CurrentUserContext,
    @Body() dto: CreateEntryDto,
    @Req() req: Request,
  ): Promise<JournalEntryDetailResponse> {
    const ctx = { ...buildAuditRequestContext(req), userId: user.id, organizationId: org.id };
    const view = await this.entries.createDraft(asTenantId(org.id), dto, user.id, ctx);
    return toJournalEntryDetail(view);
  }

  @Post(':entryId/validate')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('journals.validate')
  @ApiOperation({ summary: 'Valider une ecriture brouillon (rend immutable)' })
  @ApiOkResponse({ type: JournalEntryDetailResponse })
  async validate(
    @Param('id', ParseUUIDPipe) _id: string,
    @Param('entryId', ParseUUIDPipe) entryId: string,
    @CurrentOrg() org: CurrentOrgContext,
    @CurrentUser() user: CurrentUserContext,
    @Req() req: Request,
  ): Promise<JournalEntryDetailResponse> {
    const ctx = { ...buildAuditRequestContext(req), userId: user.id, organizationId: org.id };
    const view = await this.entries.validate(asTenantId(org.id), entryId, user.id, ctx);
    return toJournalEntryDetail(view);
  }

  @Post(':entryId/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('journals.validate')
  @ApiOperation({ summary: 'Contre-passer une ecriture validee' })
  @ApiOkResponse({ type: JournalEntryDetailResponse })
  async cancel(
    @Param('id', ParseUUIDPipe) _id: string,
    @Param('entryId', ParseUUIDPipe) entryId: string,
    @CurrentOrg() org: CurrentOrgContext,
    @CurrentUser() user: CurrentUserContext,
    @Body() dto: CancelEntryDto,
    @Req() req: Request,
  ): Promise<JournalEntryDetailResponse> {
    const ctx = { ...buildAuditRequestContext(req), userId: user.id, organizationId: org.id };
    const view = await this.entries.cancel(asTenantId(org.id), entryId, dto.reason, user.id, ctx);
    return toJournalEntryDetail(view);
  }

  @Delete(':entryId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('journals.write')
  @ApiOperation({ summary: 'Supprimer un brouillon (refus si valide)' })
  @ApiNoContentResponse()
  async deleteDraft(
    @Param('id', ParseUUIDPipe) _id: string,
    @Param('entryId', ParseUUIDPipe) entryId: string,
    @CurrentOrg() org: CurrentOrgContext,
    @CurrentUser() user: CurrentUserContext,
    @Req() req: Request,
  ): Promise<void> {
    const ctx = { ...buildAuditRequestContext(req), userId: user.id, organizationId: org.id };
    await this.entries.deleteDraft(asTenantId(org.id), entryId, user.id, ctx);
  }
}
