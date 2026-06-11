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
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
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
import { CreateJournalDto } from '../dto/create-journal.dto';
import { JournalsService } from '../services/journals.service';

@ApiTags('Journals')
@ApiBearerAuth('bearer')
@Controller('organizations/:id/journals')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class JournalsController {
  constructor(private readonly journalsService: JournalsService) {}

  @Get()
  @RequirePermission('journals.read')
  @ApiOperation({ summary: 'Lister les journaux de l organisation' })
  async list(@Param('id', ParseUUIDPipe) pathOrgId: string, @CurrentOrg() org: CurrentOrgContext) {
    this.assertOrgMatch(pathOrgId, org.id);
    return this.journalsService.listForOrg(asTenantId(org.id));
  }

  @Get(':code')
  @RequirePermission('journals.read')
  @ApiOperation({ summary: 'Trouver un journal par code' })
  async getByCode(
    @Param('id', ParseUUIDPipe) pathOrgId: string,
    @Param('code') code: string,
    @CurrentOrg() org: CurrentOrgContext,
  ) {
    this.assertOrgMatch(pathOrgId, org.id);
    return this.journalsService.findByCode(asTenantId(org.id), code);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('journals.write')
  @ApiOperation({ summary: 'Creer un journal personnalise (ex: BQ-01)' })
  async create(
    @Param('id', ParseUUIDPipe) pathOrgId: string,
    @CurrentOrg() org: CurrentOrgContext,
    @CurrentUser() user: CurrentUserContext,
    @Body() dto: CreateJournalDto,
    @Req() req: Request,
  ) {
    this.assertOrgMatch(pathOrgId, org.id);
    const ctx = { ...buildAuditRequestContext(req), userId: user.id, organizationId: org.id };
    return this.journalsService.createCustom(asTenantId(org.id), dto, user.id, ctx);
  }

  /**
   * Garde-fou tenant : l'org de l'URL DOIT correspondre à l'org du token.
   * Sans cela, le contrôleur opérait silencieusement sur l'org du token en
   * ignorant celle de l'URL — source d'incohérences (liste d'une org,
   * création dans une autre) quand les deux divergent. Aligné sur
   * `ImportsController.assertOrgMatch`.
   */
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
