import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditModule } from '../audit/audit.module';
import { OrganizationEntity } from '../organizations/entities/organization.entity';
import { OrganizationRepository } from '../organizations/repositories/organization.repository';
import { MembershipEntity } from './entities/membership.entity';
import { PermissionEntity } from './entities/permission.entity';
import { RolePermissionEntity } from './entities/role-permission.entity';
import { RoleEntity } from './entities/role.entity';
import { PermissionsGuard } from './guards/permissions.guard';
import { RolesGuard } from './guards/roles.guard';
import { TenantGuard } from './guards/tenant.guard';
import { MembershipRepository } from './repositories/membership.repository';
import { PermissionRepository } from './repositories/permission.repository';
import { RolePermissionRepository } from './repositories/role-permission.repository';
import { RoleRepository } from './repositories/role.repository';
import { MembershipsService } from './services/memberships.service';
import { PermissionsCacheService } from './services/permissions-cache.service';

/**
 * `RbacModule` — owns the RBAC catalog (`roles`, `permissions`,
 * `role_permissions`), the tenant-spine `memberships` table, and the
 * authorization guards built on top:
 *
 *  - `TenantGuard`      (BE-RBAC-02) — validates the org_id claim + emits
 *                                       `auth.cross_tenant_attempt`.
 *  - `RolesGuard`       (BE-RBAC-03) — opt-in role allow-list.
 *  - `PermissionsGuard` (BE-RBAC-04) — deny-by-default permission check.
 *
 * `TenantGuard` consumes `AuthEventsService` for cross-tenant audit;
 * hence the explicit `AuditModule` import.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      RoleEntity,
      PermissionEntity,
      RolePermissionEntity,
      MembershipEntity,
      OrganizationEntity,
    ]),
    // forwardRef because AuditModule now imports RbacModule (for
    // TenantGuard / PermissionsGuard used by AuditLogsController).
    forwardRef(() => AuditModule),
  ],
  providers: [
    RoleRepository,
    PermissionRepository,
    RolePermissionRepository,
    MembershipRepository,
    OrganizationRepository,
    MembershipsService,
    PermissionsCacheService,
    TenantGuard,
    RolesGuard,
    PermissionsGuard,
  ],
  exports: [
    RoleRepository,
    PermissionRepository,
    RolePermissionRepository,
    MembershipRepository,
    MembershipsService,
    PermissionsCacheService,
    TenantGuard,
    RolesGuard,
    PermissionsGuard,
    TypeOrmModule,
  ],
})
export class RbacModule {}
