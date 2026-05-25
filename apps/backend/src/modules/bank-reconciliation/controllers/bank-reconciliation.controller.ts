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
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
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
import { MatchStatementLineDto } from '../dto/match-statement-line.dto';
import { BankReconciliationService } from '../services/bank-reconciliation.service';

@ApiTags('BankReconciliation')
@ApiBearerAuth('bearer')
@Controller('organizations/:id/bank-reconciliation')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class BankReconciliationController {
  constructor(private readonly service: BankReconciliationService) {}

  @Get('bank-accounts/:bankAccountId/proposals')
  @RequirePermission('bank.reconcile')
  @HttpCode(HttpStatus.OK)
  async proposeMatches(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @Param('bankAccountId', new ParseUUIDPipe({ version: '4' })) bankAccountId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
  ) {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    const proposals = await this.service.proposeMatches(bankAccountId, asTenantId(tokenOrgId));
    return { proposals };
  }

  @Post('statement-lines/:statementLineId/match')
  @RequirePermission('bank.reconcile')
  @HttpCode(HttpStatus.CREATED)
  async match(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @Param('statementLineId', new ParseUUIDPipe({ version: '4' })) statementLineId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
    @CurrentUser('id') actorUserId: CurrentUserContext['id'] | undefined,
    @Body() body: MatchStatementLineDto,
    @Req() req: Request,
  ) {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    this.assertActor(actorUserId);
    const [entryLineId] = body.journalEntryLineIds;
    await this.service.applyMatch(
      asTenantId(tokenOrgId),
      statementLineId,
      entryLineId,
      'manual',
      null,
      actorUserId,
      buildAuditRequestContext(req),
    );
    return { status: 'matched' };
  }

  @Delete('matches/:matchId')
  @RequirePermission('bank.reconcile')
  @HttpCode(HttpStatus.OK)
  async unmatch(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @Param('matchId', new ParseUUIDPipe({ version: '4' })) matchId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
    @CurrentUser('id') actorUserId: CurrentUserContext['id'] | undefined,
    @Req() req: Request,
  ) {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    this.assertActor(actorUserId);
    await this.service.unmatch(
      asTenantId(tokenOrgId),
      matchId,
      actorUserId,
      buildAuditRequestContext(req),
    );
    return { status: 'unmatched' };
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
