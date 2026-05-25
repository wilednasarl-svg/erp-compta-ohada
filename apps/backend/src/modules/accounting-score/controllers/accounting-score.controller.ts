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
import { GetScoreQueryDto } from '../dto/get-score-query.dto';
import { RecalculateScoreDto } from '../dto/recalculate-score.dto';
import { AccountingScoreService } from '../services/accounting-score.service';

@ApiTags('Accounting Score')
@ApiBearerAuth('bearer')
@Controller('organizations/:id/accounting-score')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class AccountingScoreController {
  constructor(private readonly scores: AccountingScoreService) {}

  @Post('recalculate')
  @RequirePermission('accounting_score.recalculate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Recalculer le score de santé comptable d'un exercice" })
  async recalculate(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
    @CurrentUser('id') actorUserId: CurrentUserContext['id'] | undefined,
    @Body() body: RecalculateScoreDto,
    @Req() req: Request,
  ) {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    this.assertActor(actorUserId);
    const { entity, result } = await this.scores.recalculate({
      organizationId: asTenantId(tokenOrgId),
      exerciseId: body.exerciseId,
      actorId: actorUserId,
      ctx: buildAuditRequestContext(req),
      referenceDate: body.referenceDate,
    });
    return {
      score: {
        id: entity.id,
        exerciseId: entity.exerciseId,
        score: entity.score,
        grade: entity.grade,
        breakdown: result.breakdown,
        calculatedAt: entity.calculatedAt,
        calculatedBy: entity.calculatedBy,
      },
    };
  }

  @Get()
  @RequirePermission('accounting_score.read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Lire le dernier score calculé pour un exercice' })
  async getLatest(
    @Param('id', new ParseUUIDPipe({ version: '4' })) pathOrgId: string,
    @Query() query: GetScoreQueryDto,
    @CurrentOrg('id') tokenOrgId: CurrentOrgContext['id'] | undefined,
  ) {
    this.assertOrgMatch(pathOrgId, tokenOrgId);
    const entity = await this.scores.getLatest(asTenantId(tokenOrgId), query.exerciseId);
    if (!entity) {
      return { score: null };
    }
    return {
      score: {
        id: entity.id,
        exerciseId: entity.exerciseId,
        score: entity.score,
        grade: entity.grade,
        breakdown: entity.breakdown,
        calculatedAt: entity.calculatedAt,
        calculatedBy: entity.calculatedBy,
      },
    };
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
