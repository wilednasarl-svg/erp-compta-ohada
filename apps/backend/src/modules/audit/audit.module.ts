import { forwardRef, Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module';
import { RbacModule } from '../rbac/rbac.module';
import { AuditLogsController } from './controllers/audit-logs.controller';
import { AuditLogEntity } from './entities/audit-log.entity';
import { AuthEventEntity } from './entities/auth-event.entity';
import { AuditLogRepository } from './repositories/audit-log.repository';
import { AuthEventRepository } from './repositories/auth-event.repository';
import { AuditTrailService } from './services/audit-trail.service';
import { AuthEventsService } from './services/auth-events.service';

/**
 * `AuditModule` — owns the unified `auth_events` / audit log journal.
 *
 * Two layered write surfaces, ONE physical table
 * ----------------------------------------------
 *   - `AuthEventsService` (BE-AUDIT-01) — typed Module 1 wrapper for
 *     the `auth.*` / `organizations.*` event union. Delegates to
 *     `AuditTrailService`.
 *   - `AuditTrailService` (BE-AUDIT-12) — generic Module 7 surface
 *     consumed by every other module (chart of accounts, imports,
 *     transformations, …). Carries `module`, `action`, `entityType`,
 *     `entityId`, `before`, `after`, `metadata`, `requestId`.
 *
 * Both write through `AuditLogRepository` against the enriched
 * `auth_events` schema (migration 0019). The legacy
 * `AuthEventRepository` is kept for the read path of
 * `GET /organizations/:id/auth-events` (Module 1's auth-events view)
 * but is no longer in the write path.
 *
 * Two TypeORM entities (`AuthEventEntity`, `AuditLogEntity`) map to
 * the same `auth_events` table: the legacy entity exposes the Module 1
 * surface, the new entity exposes the full audit-log shape. Both are
 * registered with `TypeOrmModule.forFeature(...)` so each repository
 * gets its own `Repository<T>` injection.
 *
 * Re-exports
 * ----------
 *   - `AuditTrailService` — every consumer module imports this.
 *   - `AuthEventsService` — kept for Module 1 back-compat.
 *   - `AuthEventRepository` — read access for the legacy
 *     `AuthEventsController` in `OrganizationsModule`.
 *   - `AuditLogRepository` — read access for `AuditLogsController`
 *     and any future module-internal read.
 *   - `TypeOrmModule` — re-exported so downstream modules that wire
 *     their own `Repository<AuditLogEntity>` injection (rare) can
 *     pick it up without re-registering the entity.
 *
 * `@Global()` : `AuthEventsService` est consommé par `TenantGuard` (RBAC),
 * lui-même appliqué via `@UseGuards` dans ~51 contrôleurs répartis sur des
 * modules qui n'importent pas tous `AuditModule`. Sans le rendre global,
 * Nest échoue au boot (« can't resolve dependencies of TenantGuard …
 * AuthEventsService … in the CollectionsModule context ») → 502. Le rendre
 * global expose ses `exports` dans tous les contextes de module.
 */
@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([AuthEventEntity, AuditLogEntity]),
    // AuditLogsController utilise @UseGuards(JwtAuthGuard, TenantGuard,
    // PermissionsGuard). Sans ces imports, Nest crash au boot car
    // JwtTokenService et MembershipRepository ne sont pas dans le
    // contexte DI de AuditModule. forwardRef est requis car AuthModule
    // et RbacModule importent eux-mêmes AuditModule (dépendance
    // circulaire pour AuthEventsService / TenantGuard audit).
    forwardRef(() => AuthModule),
    forwardRef(() => RbacModule),
  ],
  controllers: [AuditLogsController],
  providers: [AuthEventRepository, AuditLogRepository, AuditTrailService, AuthEventsService],
  exports: [
    AuthEventRepository,
    AuditLogRepository,
    AuditTrailService,
    AuthEventsService,
    TypeOrmModule,
  ],
})
export class AuditModule {}
