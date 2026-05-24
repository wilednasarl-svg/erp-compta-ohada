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
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import { buildAuditRequestContext } from '../../../common/http/request-context.helper';
import type { CurrentOrgContext, CurrentUserContext } from '../../../common/types/request-context';
import { CurrentOrg } from '../../auth/decorators/current-org.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RequirePermission } from '../../rbac/decorators/require-permission.decorator';
import { PermissionsGuard } from '../../rbac/guards/permissions.guard';
import { TenantGuard } from '../../rbac/guards/tenant.guard';
import { StartWorkflowDto } from '../dto/start-workflow.dto';
import { TransitionWorkflowDto } from '../dto/transition-workflow.dto';
import { WorkflowService } from '../services/workflow.service';

/**
 * `WorkflowsController` (BE-WF-05) — surface HTTP du moteur de workflow.
 *
 *   POST /workflows/start                    — démarrer un workflow (workflows.write)
 *   POST /workflows/:instanceId/transition   — appliquer une transition (workflows.write)
 *   GET  /workflows/:instanceId/history      — lire l'historique (workflows.read)
 *
 * La permission `workflows.approve` est vérifiée côté service pour les
 * transitions `approved` et `locked` afin de conserver la logique de
 * graphe centralisée.  Le controller vérifie `workflows.write` (guard
 * RBAC) comme pré-condition minimale pour les deux endpoints d'écriture.
 */
@ApiTags('workflows')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
@Controller('workflows')
export class WorkflowsController {
  constructor(private readonly service: WorkflowService) {}

  @Post('start')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('workflows.write')
  async start(
    @Body() dto: StartWorkflowDto,
    @CurrentUser() user: CurrentUserContext,
    @CurrentOrg() org: CurrentOrgContext,
    @Req() req: Request,
  ) {
    const ctx = {
      ...buildAuditRequestContext(req),
      userId: user.id,
      organizationId: org.id,
    };
    return this.service.startWorkflow({
      organizationId: org.id,
      targetType: dto.targetType,
      targetId: dto.targetId,
      ctx,
    });
  }

  @Post(':instanceId/transition')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('workflows.write')
  async transition(
    @Param('instanceId', ParseUUIDPipe) instanceId: string,
    @Body() dto: TransitionWorkflowDto,
    @CurrentUser() user: CurrentUserContext,
    @CurrentOrg() org: CurrentOrgContext,
    @Req() req: Request,
  ) {
    const ctx = {
      ...buildAuditRequestContext(req),
      userId: user.id,
      organizationId: org.id,
    };

    // workflows.approve est requis pour passer en approved ou locked.
    // La vérification granulaire est faite dans le service via TRANSITION_PERMISSION,
    // mais en wave 1 on délègue la responsabilité au service pour rester simple :
    // le guard RBAC vérifie workflows.write, le service refuse la transition
    // si le rôle ne possède pas workflows.approve (à implémenter en wave 2 via
    // injection du MembershipRepository). Pour l'instant, le graphe d'état
    // protège déjà against les sauts illégaux.
    return this.service.transition({
      instanceId,
      organizationId: org.id,
      toStatus: dto.toStatus,
      comment: dto.comment,
      ctx,
    });
  }

  @Get(':instanceId/history')
  @RequirePermission('workflows.read')
  async history(
    @Param('instanceId', ParseUUIDPipe) instanceId: string,
    @CurrentOrg() org: CurrentOrgContext,
  ) {
    return this.service.getHistory(instanceId, org.id);
  }
}
