import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { RbacModule } from '../rbac/rbac.module';
import { CollaborationController } from './controllers/collaboration.controller';
import { CollaborationCommentEntity } from './entities/collaboration-comment.entity';
import { CollaborationRequestEntity } from './entities/collaboration-request.entity';
import { CollaborationCommentRepository } from './repositories/collaboration-comment.repository';
import { CollaborationRequestRepository } from './repositories/collaboration-request.repository';
import { CollaborationNotificationsService } from './services/collaboration-notifications.service';
import { CollaborationRequestsService } from './services/collaboration-requests.service';

/**
 * `CollaborationModule` (Module 21 — wave 1).
 *
 * Wires :
 *   - TypeORM repos pour `collaboration_requests` + `collaboration_comments`.
 *   - `CollaborationRequestsService` (orchestration + state-machine
 *     statut + scope-filter cabinet/client).
 *   - `CollaborationNotificationsService` (stub log — wave 2 émettra
 *     emails + websocket).
 *   - `CollaborationController` (REST RBAC-gated).
 *
 * Imports obligatoires (cf. mémoire `nest-useguards-requires-module-imports`) :
 *   - `AuthModule`  : fournit `JwtAuthGuard` + `JwtTokenService`.
 *   - `RbacModule`  : fournit `TenantGuard` + `PermissionsGuard`.
 *   - `AuditModule` : fournit `AuditTrailService` consommé par le
 *                     service principal pour journaliser
 *                     request_created / request_status_changed /
 *                     comment_added.
 *
 * NB intégration documents : la wave 1 référence `linked_document_id`
 * uniquement par FK (ON DELETE SET NULL). Pas d'injection
 * `DocumentRepository` ici — la validation cross-tenant retombe sur la
 * FK Postgres et est mappée en `COLLAB_LINKED_NOT_FOUND` (422) par le
 * service. Wave 2 introduira un endpoint dédié POST
 * `/collaboration/requests/:id/attach-document` qui validera
 * activement la visibilité avant d'écrire.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([CollaborationRequestEntity, CollaborationCommentEntity]),
    AuthModule,
    RbacModule,
    AuditModule,
  ],
  controllers: [CollaborationController],
  providers: [
    CollaborationRequestRepository,
    CollaborationCommentRepository,
    CollaborationNotificationsService,
    CollaborationRequestsService,
  ],
  exports: [CollaborationRequestsService],
})
export class CollaborationModule {}
