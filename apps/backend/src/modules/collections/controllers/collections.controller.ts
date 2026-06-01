import {
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import { asTenantId } from '../../../common/persistence/tenant-scope';
import type { CurrentOrgContext } from '../../../common/types/request-context';
import { CurrentOrg } from '../../auth/decorators/current-org.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RequirePermission } from '../../rbac/decorators/require-permission.decorator';
import { PermissionsGuard } from '../../rbac/guards/permissions.guard';
import { TenantGuard } from '../../rbac/guards/tenant.guard';
import {
  DunningCandidatesResponse,
  DunningLetterResponse,
  ReceivablesDetailResponse,
} from '../dto/responses';
import { CollectionsService } from '../services/collections.service';

/**
 * `CollectionsController` — recouvrement client : détail des créances
 * ouvertes, clients à relancer, lettres de relance et export CSV.
 *
 *   GET /organizations/:id/collections/receivables
 *   GET /organizations/:id/collections/candidates
 *   GET /organizations/:id/collections/receivables.csv
 *   GET /organizations/:id/collections/:partnerAccountId/letter
 */
@ApiTags('Recouvrement — Relances clients')
@ApiBearerAuth('bearer')
@Controller('organizations/:id/collections')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class CollectionsController {
  constructor(private readonly collections: CollectionsService) {}

  @Get('receivables')
  @RequirePermission('journals.read')
  @ApiOperation({ summary: 'Détail des créances clients ouvertes (avec retard et tranche)' })
  @ApiOkResponse({ type: ReceivablesDetailResponse })
  async receivables(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @CurrentOrg() org: CurrentOrgContext,
    @Query('referenceDate') referenceDate?: string,
    @Query('partnerAccountId') partnerAccountId?: string,
    @Query('overdueOnly') overdueOnly?: string,
  ): Promise<ReceivablesDetailResponse> {
    this.assertOrgMatch(pathOrgId, org.id);
    const ref = normalizeDate(referenceDate);
    const rows = await this.collections.getReceivablesDetail(asTenantId(org.id), {
      referenceDate: ref,
      partnerAccountId,
      overdueOnly: overdueOnly === 'true',
    });
    return { referenceDate: ref, rows };
  }

  @Get('candidates')
  @RequirePermission('journals.read')
  @ApiOperation({ summary: 'Clients à relancer, regroupés par palier de relance' })
  @ApiOkResponse({ type: DunningCandidatesResponse })
  async candidates(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @CurrentOrg() org: CurrentOrgContext,
    @Query('referenceDate') referenceDate?: string,
  ): Promise<DunningCandidatesResponse> {
    this.assertOrgMatch(pathOrgId, org.id);
    const ref = normalizeDate(referenceDate);
    const candidates = await this.collections.getDunningCandidates(asTenantId(org.id), ref);
    return { referenceDate: ref, candidates };
  }

  @Get('receivables.csv')
  @RequirePermission('journals.read')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="creances-clients.csv"')
  @ApiOperation({ summary: 'Export CSV du détail des créances clients ouvertes' })
  async exportCsv(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @CurrentOrg() org: CurrentOrgContext,
    @Query('referenceDate') referenceDate?: string,
    @Query('overdueOnly') overdueOnly?: string,
  ): Promise<string> {
    this.assertOrgMatch(pathOrgId, org.id);
    return this.collections.exportReceivablesCsv(asTenantId(org.id), {
      referenceDate: normalizeDate(referenceDate),
      overdueOnly: overdueOnly === 'true',
    });
  }

  @Get(':partnerAccountId/letter')
  @RequirePermission('journals.read')
  @ApiOperation({ summary: 'Lettre de relance d’un client (palier déduit du retard)' })
  @ApiOkResponse({ type: DunningLetterResponse })
  async letter(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @Param('partnerAccountId', new ParseUUIDPipe({ version: '4' })) partnerAccountId: string,
    @CurrentOrg() org: CurrentOrgContext,
    @Query('referenceDate') referenceDate?: string,
    @Query('currency') currency?: string,
  ): Promise<DunningLetterResponse> {
    this.assertOrgMatch(pathOrgId, org.id);
    return this.collections.buildLetter(asTenantId(org.id), partnerAccountId, {
      referenceDate: normalizeDate(referenceDate),
      creditorName: org.name,
      currency,
    });
  }

  private assertOrgMatch(pathOrgId: string, tokenOrgId: string | undefined): void {
    if (tokenOrgId === undefined || pathOrgId !== tokenOrgId) {
      throw new AppException(ERROR_CODES.ORG_NOT_FOUND, { message: 'Organization not found' });
    }
  }
}

/** Date de référence ISO `YYYY-MM-DD` ; défaut = aujourd'hui (UTC). */
function normalizeDate(input: string | undefined): string {
  if (input !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(input.trim())) {
    return input.trim();
  }
  return new Date().toISOString().slice(0, 10);
}
