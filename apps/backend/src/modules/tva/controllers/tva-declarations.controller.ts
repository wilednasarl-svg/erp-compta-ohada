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
import { TvaDeclarationsService } from '../services/tva-declarations.service';
import { ComputeDeclarationDto } from '../dto/compute-declaration.dto';
import { CancelDeclarationDto } from '../dto/cancel-declaration.dto';
import {
  ListTvaDeclarationsResponse,
  TvaDeclarationEnvelopeResponse,
} from '../dto/responses';
import {
  toEnvelopeDeclaration,
  toListDeclarations,
} from '../mappers/tva-response.mapper';

@ApiTags('TvaDeclarations')
@ApiBearerAuth('bearer')
@Controller('organizations/:id/tva/declarations')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class TvaDeclarationsController {
  constructor(private readonly tvaDeclarations: TvaDeclarationsService) {}

  @Get()
  @RequirePermission('tva.read')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: ListTvaDeclarationsResponse })
  async list(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
    @Query('status') status?: 'draft' | 'calculated' | 'cancelled',
    @Query('year') year?: string,
  ): Promise<ListTvaDeclarationsResponse> {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    const parsedYear = year ? parseInt(year, 10) : undefined;
    const declarations = await this.tvaDeclarations.listForOrg(asTenantId(tokenOrgId), {
      status,
      periodYear: isNaN(parsedYear as number) ? undefined : parsedYear,
    });
    return toListDeclarations(declarations);
  }

  @Get(':declarationId')
  @RequirePermission('tva.read')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: TvaDeclarationEnvelopeResponse })
  async getOne(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @Param('declarationId', new ParseUUIDPipe({ version: '4' })) declarationId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
  ): Promise<TvaDeclarationEnvelopeResponse> {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    const declaration = await this.tvaDeclarations.findById(declarationId, asTenantId(tokenOrgId));
    return toEnvelopeDeclaration(declaration);
  }

  @Post()
  @RequirePermission('tva.write')
  @HttpCode(HttpStatus.CREATED)
  @ApiCreatedResponse({ type: TvaDeclarationEnvelopeResponse })
  async compute(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
    @CurrentUser('id') actorUserId: CurrentUserContext['id'] | undefined,
    @Body() body: ComputeDeclarationDto,
    @Req() req: Request,
  ): Promise<TvaDeclarationEnvelopeResponse> {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    this.assertActor(actorUserId);
    const declaration = await this.tvaDeclarations.computeDeclaration(
      asTenantId(tokenOrgId),
      { periodYear: body.year, periodMonth: body.month },
      actorUserId,
      buildAuditRequestContext(req),
    );
    return toEnvelopeDeclaration(declaration);
  }

  @Post(':declarationId/cancel')
  @RequirePermission('tva.write')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: TvaDeclarationEnvelopeResponse })
  async cancel(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @Param('declarationId', new ParseUUIDPipe({ version: '4' })) declarationId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
    @CurrentUser('id') actorUserId: CurrentUserContext['id'] | undefined,
    @Body() body: CancelDeclarationDto,
    @Req() req: Request,
  ): Promise<TvaDeclarationEnvelopeResponse> {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    this.assertActor(actorUserId);
    const declaration = await this.tvaDeclarations.cancelDeclaration(
      declarationId,
      asTenantId(tokenOrgId),
      { reason: body.reason },
      actorUserId,
      buildAuditRequestContext(req),
    );
    return toEnvelopeDeclaration(declaration);
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
