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
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
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
import { CreateBankAccountDto } from '../dto/create-bank-account.dto';
import { BankAccountEnvelopeResponse, ListBankAccountsResponse } from '../dto/responses';
import { toBankAccountEnvelope, toListBankAccounts } from '../mappers/bank-response.mapper';
import { BankAccountsService } from '../services/bank-accounts.service';

@ApiTags('BankAccounts')
@ApiBearerAuth('bearer')
@Controller('organizations/:id/bank-accounts')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class BankAccountsController {
  constructor(private readonly service: BankAccountsService) {}

  @Get()
  @RequirePermission('bank.read')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: ListBankAccountsResponse })
  async list(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
  ): Promise<ListBankAccountsResponse> {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    const accounts = await this.service.listForOrg(asTenantId(tokenOrgId));
    return toListBankAccounts(accounts);
  }

  @Get(':bankAccountId')
  @RequirePermission('bank.read')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: BankAccountEnvelopeResponse })
  async getOne(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @Param('bankAccountId', new ParseUUIDPipe({ version: '4' })) bankAccountId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
  ): Promise<BankAccountEnvelopeResponse> {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    const account = await this.service.findById(bankAccountId, asTenantId(tokenOrgId));
    return toBankAccountEnvelope(account);
  }

  @Post()
  @RequirePermission('bank.admin')
  @HttpCode(HttpStatus.CREATED)
  @ApiCreatedResponse({ type: BankAccountEnvelopeResponse })
  async create(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
    @CurrentUser('id') actorUserId: CurrentUserContext['id'] | undefined,
    @Body() body: CreateBankAccountDto,
    @Req() req: Request,
  ): Promise<BankAccountEnvelopeResponse> {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    this.assertActor(actorUserId);
    const account = await this.service.create(
      asTenantId(tokenOrgId),
      body,
      actorUserId,
      buildAuditRequestContext(req),
    );
    return toBankAccountEnvelope(account);
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
