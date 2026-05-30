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
import type { CurrentOrgContext, CurrentUserContext } from '../../../common/types/request-context';
import { CurrentOrg } from '../../auth/decorators/current-org.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RequirePermission } from '../../rbac/decorators/require-permission.decorator';
import { PermissionsGuard } from '../../rbac/guards/permissions.guard';
import { TenantGuard } from '../../rbac/guards/tenant.guard';
import { GenerateDeclarationDto } from '../dto/generate-declaration.dto';
import { GenerateAutoDeclarationDto } from '../dto/generate-auto-declaration.dto';
import { UpdateDeclarationDto } from '../dto/update-declaration.dto';
import { TransitionDeclarationDto } from '../dto/transition-declaration.dto';
import {
  FiscalDeclarationEnvelopeResponse,
  ListFiscalDeclarationsResponse,
} from '../dto/responses';
import {
  toFiscalDeclarationEnvelope,
  toListFiscalDeclarations,
} from '../mappers/fiscal-response.mapper';
import { FiscalDeclarationsService } from '../services/fiscal-declarations.service';
import type { FiscalDeclarationStatus } from '../types/fiscal.types';

@ApiTags('Fiscal — Déclarations & échéancier')
@ApiBearerAuth('bearer')
@Controller('organizations/:id/fiscal/declarations')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class FiscalDeclarationsController {
  constructor(private readonly declarations: FiscalDeclarationsService) {}

  @Get()
  @RequirePermission('fiscal.read')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: ListFiscalDeclarationsResponse })
  async list(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
    @Query('periodYear') periodYear?: string,
    @Query('periodMonth') periodMonth?: string,
    @Query('taxCode') taxCode?: string,
    @Query('status') status?: FiscalDeclarationStatus,
    @Query('dueBefore') dueBefore?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ): Promise<ListFiscalDeclarationsResponse> {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    const { rows, total } = await this.declarations.list(asTenantId(tokenOrgId), {
      periodYear: periodYear ? Number(periodYear) : undefined,
      periodMonth: periodMonth ? Number(periodMonth) : undefined,
      taxCode,
      status,
      dueBefore,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
    return toListFiscalDeclarations(rows, total);
  }

  @Get(':declarationId')
  @RequirePermission('fiscal.read')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: FiscalDeclarationEnvelopeResponse })
  async getOne(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @Param('declarationId', new ParseUUIDPipe({ version: '4' })) declarationId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
  ): Promise<FiscalDeclarationEnvelopeResponse> {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    const decl = await this.declarations.findById(declarationId, asTenantId(tokenOrgId));
    return toFiscalDeclarationEnvelope(decl);
  }

  @Post('generate')
  @RequirePermission('fiscal.write')
  @HttpCode(HttpStatus.CREATED)
  @ApiCreatedResponse({ type: FiscalDeclarationEnvelopeResponse })
  async generate(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
    @CurrentUser('id') userId: CurrentUserContext['id'] | undefined,
    @Body() dto: GenerateDeclarationDto,
  ): Promise<FiscalDeclarationEnvelopeResponse> {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    const decl = await this.declarations.generate(asTenantId(tokenOrgId), {
      taxCode: dto.taxCode,
      periodYear: dto.periodYear,
      periodMonth: dto.periodMonth,
      baseAmount: dto.baseAmount,
      comment: dto.comment,
      createdById: userId ?? null,
    });
    return toFiscalDeclarationEnvelope(decl);
  }

  @Post('generate-auto')
  @RequirePermission('fiscal.write')
  @HttpCode(HttpStatus.CREATED)
  @ApiCreatedResponse({ type: FiscalDeclarationEnvelopeResponse })
  async generateAuto(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
    @CurrentUser('id') userId: CurrentUserContext['id'] | undefined,
    @Body() dto: GenerateAutoDeclarationDto,
  ): Promise<FiscalDeclarationEnvelopeResponse> {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    const decl = await this.declarations.generateAuto(asTenantId(tokenOrgId), {
      taxCode: dto.taxCode,
      periodYear: dto.periodYear,
      periodMonth: dto.periodMonth,
      baseOverride: dto.baseOverride,
      comment: dto.comment,
      createdById: userId ?? null,
    });
    return toFiscalDeclarationEnvelope(decl);
  }

  @Patch(':declarationId')
  @RequirePermission('fiscal.write')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: FiscalDeclarationEnvelopeResponse })
  async update(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @Param('declarationId', new ParseUUIDPipe({ version: '4' })) declarationId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
    @Body() dto: UpdateDeclarationDto,
  ): Promise<FiscalDeclarationEnvelopeResponse> {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    const decl = await this.declarations.update(declarationId, asTenantId(tokenOrgId), dto);
    return toFiscalDeclarationEnvelope(decl);
  }

  @Post(':declarationId/transition')
  @RequirePermission('fiscal.write')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: FiscalDeclarationEnvelopeResponse })
  async transition(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @Param('declarationId', new ParseUUIDPipe({ version: '4' })) declarationId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
    @CurrentUser('id') userId: CurrentUserContext['id'] | undefined,
    @Body() dto: TransitionDeclarationDto,
  ): Promise<FiscalDeclarationEnvelopeResponse> {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    const decl = await this.declarations.transition(
      declarationId,
      asTenantId(tokenOrgId),
      dto.targetStatus,
      userId ?? null,
    );
    return toFiscalDeclarationEnvelope(decl);
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
