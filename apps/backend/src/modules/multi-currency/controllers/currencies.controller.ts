import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import { asTenantId } from '../../../common/persistence/tenant-scope';
import type { CurrentOrgContext } from '../../../common/types/request-context';
import { CurrentOrg } from '../../auth/decorators/current-org.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RequirePermission } from '../../rbac/decorators/require-permission.decorator';
import { PermissionsGuard } from '../../rbac/guards/permissions.guard';
import { TenantGuard } from '../../rbac/guards/tenant.guard';
import { CreateCurrencyDto } from '../dto/create-currency.dto';
import { UpdateCurrencyDto } from '../dto/update-currency.dto';
import { CurrenciesService } from '../services/currencies.service';

@ApiTags('Currencies')
@ApiBearerAuth('bearer')
@Controller('organizations/:id/currencies')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class CurrenciesController {
  constructor(private readonly currencies: CurrenciesService) {}

  @Get()
  @RequirePermission('fx.read')
  @HttpCode(HttpStatus.OK)
  async list(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
    @Query('activeOnly') activeOnly?: string,
  ) {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    const items = await this.currencies.listForOrg(asTenantId(tokenOrgId), {
      activeOnly: activeOnly === 'true',
    });
    return { currencies: items };
  }

  @Post()
  @RequirePermission('fx.write')
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
    @Body() body: CreateCurrencyDto,
  ) {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    const currency = await this.currencies.create(asTenantId(tokenOrgId), body);
    return { currency };
  }

  @Patch(':currencyId')
  @RequirePermission('fx.write')
  @HttpCode(HttpStatus.OK)
  async update(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @Param('currencyId', new ParseUUIDPipe({ version: '4' })) currencyId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
    @Body() body: UpdateCurrencyDto,
  ) {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    const currency = await this.currencies.update(currencyId, asTenantId(tokenOrgId), body);
    return { currency };
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
}
