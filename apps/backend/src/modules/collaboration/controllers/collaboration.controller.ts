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
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import { buildAuditRequestContext } from '../../../common/http/request-context.helper';
import { asTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import type {
  CurrentOrgContext,
  CurrentUserContext,
} from '../../../common/types/request-context';
import { CurrentOrg } from '../../auth/decorators/current-org.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RequirePermission } from '../../rbac/decorators/require-permission.decorator';
import { PermissionsGuard } from '../../rbac/guards/permissions.guard';
import { TenantGuard } from '../../rbac/guards/tenant.guard';
import { AddCollaborationCommentDto } from '../dto/add-collaboration-comment.dto';
import { CreateCollaborationRequestDto } from '../dto/create-collaboration-request.dto';
import { ListCollaborationRequestsQueryDto } from '../dto/list-collaboration-requests-query.dto';
import { UpdateCollaborationStatusDto } from '../dto/update-collaboration-status.dto';
import {
  CollaborationRequestsService,
  type CollaborationViewScope,
  type CommentView,
  type ListRequestsResult,
  type RequestView,
} from '../services/collaboration-requests.service';

/**
 * `CollaborationController` (BE-COLLAB-05) — surface REST gated RBAC
 * pour le Module 21 wave 1.
 *
 *   POST   /collaboration/requests                 — créer (collaboration.write)
 *   GET    /collaboration/requests                 — lister scope-aware (collaboration.read)
 *   GET    /collaboration/requests/:id             — détail (collaboration.read)
 *   PATCH  /collaboration/requests/:id/status      — changer statut (write OU respond)
 *   GET    /collaboration/requests/:id/comments    — lister commentaires (collaboration.read)
 *   POST   /collaboration/requests/:id/comments    — ajouter commentaire (write OU respond)
 *
 * Permissions :
 *   - `collaboration.read`    : tout le monde (cabinet + client).
 *   - `collaboration.write`   : EXCLUSIF cabinet — création de demande.
 *   - `collaboration.respond` : porté par les deux faces (cabinet et
 *     client_readonly). Le scope `client` se charge de borner la
 *     visibilité côté service via `CollaborationViewScope`.
 *
 * Le scope d'affichage (`cabinet` vs `client`) est dérivé du `role` du
 * `CurrentOrgContext` — cf. `deriveViewScope`. Les rôles cabinet voient
 * tout l'org ; `client_readonly` ne voit que ses demandes assignées.
 */
@ApiTags('Collaboration')
@ApiBearerAuth('bearer')
@Controller('collaboration/requests')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class CollaborationController {
  constructor(private readonly service: CollaborationRequestsService) {}

  @Post()
  @RequirePermission('collaboration.write')
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() body: CreateCollaborationRequestDto,
    @CurrentOrg() org: CurrentOrgContext | undefined,
    @CurrentUser('id') actorUserId: CurrentUserContext['id'] | undefined,
    @Req() req: Request,
  ): Promise<{ request: RequestView }> {
    const scope = this.assertActorScope(org, actorUserId);
    const request = await this.service.createRequest(
      scope.organizationId,
      scope.actorUserId,
      {
        title: body.title,
        description: body.description ?? null,
        assigneeId: body.assigneeId ?? null,
        linkedEntryId: body.linkedEntryId ?? null,
        linkedDocumentId: body.linkedDocumentId ?? null,
        dueDate: body.dueDate ?? null,
      },
      buildAuditRequestContext(req),
    );
    return { request };
  }

  @Get()
  @RequirePermission('collaboration.read')
  @HttpCode(HttpStatus.OK)
  async list(
    @Query() query: ListCollaborationRequestsQueryDto,
    @CurrentOrg() org: CurrentOrgContext | undefined,
    @CurrentUser('id') actorUserId: CurrentUserContext['id'] | undefined,
  ): Promise<ListRequestsResult> {
    const scope = this.assertActorScope(org, actorUserId);
    return this.service.listForActor(
      scope.organizationId,
      scope.actorUserId,
      this.deriveViewScope(org),
      {
        status: query.status,
        assigneeId: query.assigneeId,
        requesterId: query.requesterId,
        linkedEntryId: query.linkedEntryId,
        linkedDocumentId: query.linkedDocumentId,
      },
      {
        page: query.page ?? 1,
        pageSize: query.pageSize ?? 20,
      },
    );
  }

  @Get(':id')
  @RequirePermission('collaboration.read')
  @HttpCode(HttpStatus.OK)
  async getOne(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentOrg() org: CurrentOrgContext | undefined,
    @CurrentUser('id') actorUserId: CurrentUserContext['id'] | undefined,
  ): Promise<{ request: RequestView }> {
    const scope = this.assertActorScope(org, actorUserId);
    const request = await this.service.getForActor(
      scope.organizationId,
      id,
      scope.actorUserId,
      this.deriveViewScope(org),
    );
    return { request };
  }

  /**
   * `collaboration.write` (cabinet) ET `collaboration.respond` (client)
   * peuvent muter le statut ; le service applique en plus la machine
   * d'états (`isStatusTransitionAllowed`) et la visibilité scope-aware.
   */
  @Patch(':id/status')
  @RequirePermission('collaboration.respond')
  @HttpCode(HttpStatus.OK)
  async updateStatus(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: UpdateCollaborationStatusDto,
    @CurrentOrg() org: CurrentOrgContext | undefined,
    @CurrentUser('id') actorUserId: CurrentUserContext['id'] | undefined,
    @Req() req: Request,
  ): Promise<{ request: RequestView }> {
    const scope = this.assertActorScope(org, actorUserId);
    const request = await this.service.updateStatus(
      scope.organizationId,
      id,
      scope.actorUserId,
      this.deriveViewScope(org),
      body.status,
      buildAuditRequestContext(req),
    );
    return { request };
  }

  @Get(':id/comments')
  @RequirePermission('collaboration.read')
  @HttpCode(HttpStatus.OK)
  async listComments(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentOrg() org: CurrentOrgContext | undefined,
    @CurrentUser('id') actorUserId: CurrentUserContext['id'] | undefined,
  ): Promise<{ comments: ReadonlyArray<CommentView> }> {
    const scope = this.assertActorScope(org, actorUserId);
    const comments = await this.service.listComments(
      scope.organizationId,
      id,
      scope.actorUserId,
      this.deriveViewScope(org),
    );
    return { comments };
  }

  @Post(':id/comments')
  @RequirePermission('collaboration.respond')
  @HttpCode(HttpStatus.CREATED)
  async addComment(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: AddCollaborationCommentDto,
    @CurrentOrg() org: CurrentOrgContext | undefined,
    @CurrentUser('id') actorUserId: CurrentUserContext['id'] | undefined,
    @Req() req: Request,
  ): Promise<{ comment: CommentView }> {
    const scope = this.assertActorScope(org, actorUserId);
    const comment = await this.service.addComment(
      scope.organizationId,
      id,
      scope.actorUserId,
      this.deriveViewScope(org),
      body.body,
      buildAuditRequestContext(req),
    );
    return { comment };
  }

  // ─── Helpers ────────────────────────────────────────────────────────

  private assertActorScope(
    org: CurrentOrgContext | undefined,
    actorUserId: string | undefined,
  ): { organizationId: TenantId; actorUserId: string } {
    if (org === undefined || org.id.length === 0) {
      throw new AppException(ERROR_CODES.ORG_NOT_FOUND, {
        message: 'Organization not found',
      });
    }
    if (actorUserId === undefined || actorUserId.length === 0) {
      throw new AppException(ERROR_CODES.AUTH_INVALID_TOKEN, {
        message: 'Authenticated user is required',
      });
    }
    return { organizationId: asTenantId(org.id), actorUserId };
  }

  /**
   * Le rôle JWT dicte le scope visuel. Seul `client_readonly` est rabattu
   * en `client` (visibilité limitée aux demandes assignées). Tout autre
   * rôle (admin / expert_comptable / chef_mission / comptable / auditeur)
   * est cabinet → voit toute l'org.
   *
   * Si un nouveau rôle « client » est ajouté plus tard, ÉTENDRE ce
   * switch — sinon il sera traité comme cabinet par défaut, ce qui
   * serait une fuite de visibilité.
   */
  private deriveViewScope(org: CurrentOrgContext | undefined): CollaborationViewScope {
    if (org === undefined) return 'cabinet';
    return org.role === 'client_readonly' ? 'client' : 'cabinet';
  }
}
