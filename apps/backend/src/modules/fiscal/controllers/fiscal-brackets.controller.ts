import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import { asTenantId } from '../../../common/persistence/tenant-scope';
import type { CurrentOrgContext } from '../../../common/types/request-context';
import { CurrentOrg } from '../../auth/decorators/current-org.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RequirePermission } from '../../rbac/decorators/require-permission.decorator';
import { PermissionsGuard } from '../../rbac/guards/permissions.guard';
import { TenantGuard } from '../../rbac/guards/tenant.guard';
import { ReplaceBracketsDto } from '../dto/replace-brackets.dto';
import { SeedDefaultsDto } from '../dto/seed-defaults.dto';
import { ListFiscalBracketsResponse, SeedDefaultsResultResponse } from '../dto/responses';
import { toListFiscalBrackets } from '../mappers/fiscal-response.mapper';
import { FiscalBracketsService } from '../services/fiscal-brackets.service';

@ApiTags('Fiscal — Barèmes progressifs (ITS)')
@ApiBearerAuth('bearer')
@Controller('organizations/:id/fiscal/brackets')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class FiscalBracketsController {
  constructor(private readonly brackets: FiscalBracketsService) {}

  @Get()
  @RequirePermission('fiscal.read')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: ListFiscalBracketsResponse })
  async list(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
    @Query('taxCode') taxCode = 'ITS',
  ): Promise<ListFiscalBracketsResponse> {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    const brackets = await this.brackets.list(asTenantId(tokenOrgId), taxCode);
    return toListFiscalBrackets(brackets);
  }

  @Put()
  @RequirePermission('fiscal.write')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: ListFiscalBracketsResponse })
  async replace(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
    @Body() dto: ReplaceBracketsDto,
  ): Promise<ListFiscalBracketsResponse> {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    const brackets = await this.brackets.replace(
      asTenantId(tokenOrgId),
      dto.taxCode,
      dto.effectiveFrom,
      dto.brackets.map((b) => ({
        bracketOrder: b.bracketOrder,
        fromAmount: b.fromAmount,
        toAmount: b.toAmount ?? null,
        rate: b.rate,
      })),
    );
    return toListFiscalBrackets(brackets);
  }

  @Post('seed-its-defaults')
  @RequirePermission('fiscal.write')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: SeedDefaultsResultResponse })
  async seedItsDefaults(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
    @Body() dto: SeedDefaultsDto,
  ): Promise<SeedDefaultsResultResponse> {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    return this.brackets.seedItsDefaults(asTenantId(tokenOrgId), dto.fiscalYear);
  }

  private assertOrgMatch(
    pathOrgId: string,
    tokenOrgId: string | undefined,
  ): asserts tokenOrgId is string {
    if (tokenOrgId === undefined || pathOrgId !== tokenOrgId) {
      throw new AppException(ERROR_CODES.ORG_NOT_FOUND, { message: 'Organization not found' });
    }
  }
}
