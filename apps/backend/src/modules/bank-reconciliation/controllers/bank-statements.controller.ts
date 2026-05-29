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
import { ImportBankStatementDto } from '../dto/import-bank-statement.dto';
import {
  BankStatementWithLinesResponse,
  ImportBankStatementResponse,
  ListBankStatementsResponse,
} from '../dto/responses';
import {
  toBankStatementWithLines,
  toImportBankStatement,
  toListBankStatements,
} from '../mappers/bank-response.mapper';
import { BankStatementsService } from '../services/bank-statements.service';

@ApiTags('BankStatements')
@ApiBearerAuth('bearer')
@Controller('organizations/:id/bank-accounts/:bankAccountId/statements')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class BankStatementsController {
  constructor(private readonly service: BankStatementsService) {}

  @Get()
  @RequirePermission('bank.read')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: ListBankStatementsResponse })
  async list(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @Param('bankAccountId', new ParseUUIDPipe({ version: '4' })) bankAccountId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
  ): Promise<ListBankStatementsResponse> {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    const statements = await this.service.listByBankAccount(bankAccountId, asTenantId(tokenOrgId));
    return toListBankStatements(statements);
  }

  @Get(':statementId')
  @RequirePermission('bank.read')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: BankStatementWithLinesResponse })
  async getOne(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @Param('bankAccountId', new ParseUUIDPipe({ version: '4' })) _bankAccountId: string,
    @Param('statementId', new ParseUUIDPipe({ version: '4' })) statementId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
  ): Promise<BankStatementWithLinesResponse> {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    const { statement, lines } = await this.service.getStatementWithLines(
      statementId,
      asTenantId(tokenOrgId),
    );
    return toBankStatementWithLines(statement, lines);
  }

  @Post('import')
  @RequirePermission('bank.import')
  @HttpCode(HttpStatus.CREATED)
  @ApiCreatedResponse({ type: ImportBankStatementResponse })
  async import(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @Param('bankAccountId', new ParseUUIDPipe({ version: '4' })) bankAccountId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
    @CurrentUser('id') actorUserId: CurrentUserContext['id'] | undefined,
    @Body() body: ImportBankStatementDto,
    @Req() req: Request,
  ): Promise<ImportBankStatementResponse> {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    this.assertActor(actorUserId);
    const result = await this.service.importStatement(
      bankAccountId,
      asTenantId(tokenOrgId),
      body,
      actorUserId,
      buildAuditRequestContext(req),
    );
    return toImportBankStatement(result.statement, result.linesCount);
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
