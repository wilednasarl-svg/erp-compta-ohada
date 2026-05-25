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
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
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
import { TvaCodesService } from '../services/tva-codes.service';
import { CreateTvaCodeDto } from '../dto/create-tva-code.dto';
import { UpdateTvaCodeDto } from '../dto/update-tva-code.dto';
import {
  ListTvaCodesResponse,
  TvaCodeEnvelopeResponse,
} from '../dto/responses';
import { toEnvelopeCode, toListCodes } from '../mappers/tva-response.mapper';

@ApiTags('TvaCodes')
@ApiBearerAuth('bearer')
@Controller('organizations/:id/tva/codes')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class TvaCodesController {
  constructor(private readonly tvaCodes: TvaCodesService) {}

  @Get()
  @RequirePermission('tva.read')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: ListTvaCodesResponse })
  async list(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
    @Query('activeOnly') activeOnly?: string,
  ): Promise<ListTvaCodesResponse> {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    const codes = await this.tvaCodes.listForOrg(asTenantId(tokenOrgId), {
      activeOnly: activeOnly === 'true',
    });
    return toListCodes(codes);
  }

  @Get(':codeId')
  @RequirePermission('tva.read')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: TvaCodeEnvelopeResponse })
  async getOne(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @Param('codeId', new ParseUUIDPipe({ version: '4' })) codeId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
  ): Promise<TvaCodeEnvelopeResponse> {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    const code = await this.tvaCodes.findById(codeId, asTenantId(tokenOrgId));
    return toEnvelopeCode(code);
  }

  @Post()
  @RequirePermission('tva.write')
  @HttpCode(HttpStatus.CREATED)
  @ApiCreatedResponse({ type: TvaCodeEnvelopeResponse })
  async create(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
    @CurrentUser('id') actorUserId: CurrentUserContext['id'] | undefined,
    @Body() body: CreateTvaCodeDto,
    @Req() req: Request,
  ): Promise<TvaCodeEnvelopeResponse> {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    this.assertActor(actorUserId);
    const code = await this.tvaCodes.create(
      asTenantId(tokenOrgId),
      body,
      actorUserId,
      buildAuditRequestContext(req),
    );
    return toEnvelopeCode(code);
  }

  @Patch(':codeId')
  @RequirePermission('tva.write')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: TvaCodeEnvelopeResponse })
  async update(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @Param('codeId', new ParseUUIDPipe({ version: '4' })) codeId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
    @CurrentUser('id') actorUserId: CurrentUserContext['id'] | undefined,
    @Body() body: UpdateTvaCodeDto,
    @Req() req: Request,
  ): Promise<TvaCodeEnvelopeResponse> {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    this.assertActor(actorUserId);
    const code = await this.tvaCodes.update(
      codeId,
      asTenantId(tokenOrgId),
      body,
      actorUserId,
      buildAuditRequestContext(req),
    );
    return toEnvelopeCode(code);
  }

  // ─── Helpers ────────────────────────────────────────────────────────

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
