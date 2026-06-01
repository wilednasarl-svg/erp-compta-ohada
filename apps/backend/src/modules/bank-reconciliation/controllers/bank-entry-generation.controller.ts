import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiTags } from '@nestjs/swagger';
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
import { GenerateBankEntryDto } from '../dto/generate-bank-entry.dto';
import { GeneratedEntryResponse } from '../dto/responses/generated-entry.response';
import { BankEntryGenerationService } from '../services/bank-entry-generation.service';

/**
 * Comptabilisation des lignes de relevé non rapprochées (agios, frais,
 * virements non saisis) : génère l'écriture manquante et la rapproche.
 *
 *   POST /organizations/:id/bank-reconciliation/statement-lines/:lineId/generate-entry
 */
@ApiTags('BankReconciliation')
@ApiBearerAuth('bearer')
@Controller('organizations/:id/bank-reconciliation')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class BankEntryGenerationController {
  constructor(private readonly service: BankEntryGenerationService) {}

  @Post('statement-lines/:statementLineId/generate-entry')
  @RequirePermission('bank.reconcile')
  @HttpCode(HttpStatus.CREATED)
  @ApiCreatedResponse({ type: GeneratedEntryResponse })
  async generate(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @Param('statementLineId', new ParseUUIDPipe({ version: '4' })) statementLineId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
    @CurrentUser('id') actorUserId: CurrentUserContext['id'] | undefined,
    @Body() body: GenerateBankEntryDto,
    @Req() req: Request,
  ): Promise<GeneratedEntryResponse> {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    this.assertActor(actorUserId);
    const result = await this.service.generateEntryForLine(
      asTenantId(tokenOrgId),
      statementLineId,
      {
        counterpartAccountCode: body.counterpartAccountCode,
        journalCode: body.journalCode,
        label: body.label ?? null,
      },
      actorUserId,
      buildAuditRequestContext(req),
    );
    return result;
  }

  private assertOrgMatch(
    pathOrgId: string,
    tokenOrgId: string | undefined,
  ): asserts tokenOrgId is string {
    if (tokenOrgId === undefined || pathOrgId !== tokenOrgId) {
      throw new AppException(ERROR_CODES.ORG_NOT_FOUND, { message: 'Organization not found' });
    }
  }

  private assertActor(actorUserId: string | undefined): asserts actorUserId is string {
    if (actorUserId === undefined) {
      throw new AppException(ERROR_CODES.AUTH_INVALID_TOKEN, { message: 'Missing actor identity' });
    }
  }
}
