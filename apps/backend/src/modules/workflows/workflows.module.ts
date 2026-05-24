import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { RbacModule } from '../rbac/rbac.module';
import { WorkflowsController } from './controllers/workflows.controller';
import {
  WorkflowDefinitionEntity,
  WorkflowEventEntity,
  WorkflowInstanceEntity,
} from './entities';
import { WorkflowDefinitionRepository } from './repositories/workflow-definition.repository';
import { WorkflowEventRepository } from './repositories/workflow-event.repository';
import { WorkflowInstanceRepository } from './repositories/workflow-instance.repository';
import { WorkflowService } from './services/workflow.service';

/**
 * `WorkflowsModule` (Module 6 — vague 1).
 *
 * Wires :
 *   - TypeORM repositories pour les 3 tables workflow.
 *   - `WorkflowService` (orchestration de la machine d'états).
 *   - `WorkflowsController` (surface HTTP RBAC-gated).
 *
 * Importe `AuthModule` + `RbacModule` so `JwtAuthGuard`, `TenantGuard`
 * et `PermissionsGuard` résolvent dans le contexte DI du controller
 * (cf. mémoire `nest-useguards-requires-module-imports`).
 * Importe `AuditModule` pour `AuditTrailService`.
 *
 * Exporte `WorkflowService` pour que d'autres modules (ex: ImportsModule)
 * puissent appeler `assertNotLocked` sans recréer le service.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      WorkflowDefinitionEntity,
      WorkflowInstanceEntity,
      WorkflowEventEntity,
    ]),
    AuthModule,
    RbacModule,
    AuditModule,
  ],
  controllers: [WorkflowsController],
  providers: [
    WorkflowDefinitionRepository,
    WorkflowInstanceRepository,
    WorkflowEventRepository,
    WorkflowService,
  ],
  exports: [WorkflowService],
})
export class WorkflowsModule {}
