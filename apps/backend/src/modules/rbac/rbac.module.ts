import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { MembershipEntity } from './entities/membership.entity';
import { PermissionEntity } from './entities/permission.entity';
import { RolePermissionEntity } from './entities/role-permission.entity';
import { RoleEntity } from './entities/role.entity';
import { MembershipRepository } from './repositories/membership.repository';
import { PermissionRepository } from './repositories/permission.repository';
import { RolePermissionRepository } from './repositories/role-permission.repository';
import { RoleRepository } from './repositories/role.repository';

/**
 * `RbacModule` — owns the RBAC catalog (`roles`, `permissions`,
 * `role_permissions`) and the tenant-spine `memberships` table. Guards and
 * decorators (`@RequirePermission`, `@Roles`, `RolesGuard`,
 * `PermissionsGuard`) land in BE-RBAC-*.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      RoleEntity,
      PermissionEntity,
      RolePermissionEntity,
      MembershipEntity,
    ]),
  ],
  providers: [RoleRepository, PermissionRepository, RolePermissionRepository, MembershipRepository],
  exports: [
    RoleRepository,
    PermissionRepository,
    RolePermissionRepository,
    MembershipRepository,
    TypeOrmModule,
  ],
})
export class RbacModule {}
