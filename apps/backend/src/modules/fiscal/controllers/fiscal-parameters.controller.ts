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
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import { asTenantId } from '../../../common/persistence/tenant-scope';
import type { CurrentOrgContext } from '../../../common/types/request-context';
import { CurrentOrg } from '../../auth/decorators/current-org.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RequirePermission } from '../../rbac/decorators/require-permission.decorator';
import { PermissionsGuard } from '../../rbac/guards/permissions.guard';
import { TenantGuard } from '../../rbac/guards/tenant.guard';
import { CreateFiscalParameterDto } from '../dto/create-fiscal-parameter.dto';
import { UpdateFiscalParameterDto } from '../dto/update-fiscal-parameter.dto';
import { SeedDefaultsDto } from '../dto/seed-defaults.dto';
import {
  FiscalParameterEnvelopeResponse,
  ListFiscalParametersResponse,
  SeedDefaultsResultResponse,
} from '../dto/responses';
import {
  toFiscalParameterEnvelope,
  toListFiscalParameters,
} from '../mappers/fiscal-response.mapper';
import { FiscalParametersService } from '../services/fiscal-parameters.service';
import type { FiscalDeclarationKind } from '../types/fiscal.types';

@ApiTags('Fiscal — Paramètres (taux)')
@ApiBearerAuth('bearer')
@Controller('organizations/:id/fiscal/parameters')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class FiscalParametersController {
  constructor(private readonly params: FiscalParametersService) {}

  @Get()
  @RequirePermission('fiscal.read')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: ListFiscalParametersResponse })
  async list(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
    @Query('activeOnly') activeOnly?: string,
    @Query('declarationKind') declarationKind?: FiscalDeclarationKind,
  ): Promise<ListFiscalParametersResponse> {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    const params = await this.params.list(asTenantId(tokenOrgId), {
      activeOnly: activeOnly === 'true',
      declarationKind,
    });
    return toListFiscalParameters(params);
  }

  @Get(':parameterId')
  @RequirePermission('fiscal.read')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: FiscalParameterEnvelopeResponse })
  async getOne(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @Param('parameterId', new ParseUUIDPipe({ version: '4' })) parameterId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
  ): Promise<FiscalParameterEnvelopeResponse> {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    const param = await this.params.findById(parameterId, asTenantId(tokenOrgId));
    return toFiscalParameterEnvelope(param);
  }

  @Post()
  @RequirePermission('fiscal.write')
  @HttpCode(HttpStatus.CREATED)
  @ApiCreatedResponse({ type: FiscalParameterEnvelopeResponse })
  async create(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
    @Body() dto: CreateFiscalParameterDto,
  ): Promise<FiscalParameterEnvelopeResponse> {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    const param = await this.params.create(asTenantId(tokenOrgId), {
      taxCode: dto.taxCode,
      label: dto.label,
      declarationKind: dto.declarationKind,
      rate: dto.rate,
      baseKind: dto.baseKind,
      periodicity: dto.periodicity,
      ceiling: dto.ceiling,
      dueDay: dto.dueDay,
      chargeAccount: dto.chargeAccount,
      liabilityAccount: dto.liabilityAccount,
      effectiveFrom: dto.effectiveFrom,
      effectiveTo: dto.effectiveTo,
      isActive: dto.isActive,
      notes: dto.notes,
    });
    return toFiscalParameterEnvelope(param);
  }

  @Patch(':parameterId')
  @RequirePermission('fiscal.write')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: FiscalParameterEnvelopeResponse })
  async update(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @Param('parameterId', new ParseUUIDPipe({ version: '4' })) parameterId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
    @Body() dto: UpdateFiscalParameterDto,
  ): Promise<FiscalParameterEnvelopeResponse> {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    const param = await this.params.update(parameterId, asTenantId(tokenOrgId), dto);
    return toFiscalParameterEnvelope(param);
  }

  @Post('seed-defaults')
  @RequirePermission('fiscal.write')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: SeedDefaultsResultResponse })
  async seedDefaults(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
    @Body() dto: SeedDefaultsDto,
  ): Promise<SeedDefaultsResultResponse> {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    return this.params.seedDefaults(asTenantId(tokenOrgId), dto.fiscalYear);
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
