import {
  Body,
  Controller,
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
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import { asTenantId } from '../../../common/persistence/tenant-scope';
import type { CurrentOrgContext, CurrentUserContext } from '../../../common/types/request-context';
import { CurrentOrg } from '../../auth/decorators/current-org.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RequirePermission } from '../../rbac/decorators/require-permission.decorator';
import { PermissionsGuard } from '../../rbac/guards/permissions.guard';
import { TenantGuard } from '../../rbac/guards/tenant.guard';
import { ConvertAmountQueryDto } from '../dto/convert-amount-query.dto';
import { CreateExchangeRateDto } from '../dto/create-exchange-rate.dto';
import { ListRatesQueryDto } from '../dto/list-rates-query.dto';
import {
  ExchangeRateEnvelopeResponse,
  FxConversionEnvelopeResponse,
  ListExchangeRatesResponse,
} from '../dto/responses';
import {
  toExchangeRateEnvelope,
  toFxConversionEnvelope,
  toListExchangeRates,
} from '../mappers/multi-currency-response.mapper';
import { ExchangeRatesService } from '../services/exchange-rates.service';

@ApiTags('Exchange Rates')
@ApiBearerAuth('bearer')
@Controller('organizations/:id/exchange-rates')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class ExchangeRatesController {
  constructor(private readonly rates: ExchangeRatesService) {}

  @Get()
  @RequirePermission('fx.read')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: ListExchangeRatesResponse })
  async list(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
    @Query() query: ListRatesQueryDto,
  ): Promise<ListExchangeRatesResponse> {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    const items = await this.rates.list(asTenantId(tokenOrgId), query);
    return toListExchangeRates(items);
  }

  @Post()
  @RequirePermission('fx.write')
  @HttpCode(HttpStatus.CREATED)
  @ApiCreatedResponse({ type: ExchangeRateEnvelopeResponse })
  async post(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
    @CurrentUser('id') actorUserId: CurrentUserContext['id'] | undefined,
    @Body() body: CreateExchangeRateDto,
    @Req() _req: Request,
  ): Promise<ExchangeRateEnvelopeResponse> {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    const rate = await this.rates.postRate(asTenantId(tokenOrgId), {
      fromCurrencyCode: body.fromCurrencyCode,
      toCurrencyCode: body.toCurrencyCode,
      rateDate: body.rateDate,
      rate: body.rate,
      source: body.source,
      sourceRef: body.sourceRef ?? null,
      actorId: actorUserId ?? null,
    });
    return toExchangeRateEnvelope(rate);
  }

  @Get('convert')
  @RequirePermission('fx.read')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: FxConversionEnvelopeResponse })
  async convert(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
    @Query() query: ConvertAmountQueryDto,
  ): Promise<FxConversionEnvelopeResponse> {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    const result = await this.rates.convert(asTenantId(tokenOrgId), {
      amount: query.amount,
      fromCurrencyCode: query.fromCurrencyCode,
      toCurrencyCode: query.toCurrencyCode,
      asOfDate: query.asOfDate,
    });
    return toFxConversionEnvelope(result);
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
