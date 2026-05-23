import { Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';

import { PermissionEntity } from './permission.entity';
import { RoleEntity } from './role.entity';

/**
 * `role_permissions` row (BE-DB-05) — RBAC join table materializing the
 * many-to-many between `roles` and `permissions`.
 *
 * Mirrors `database/migrations/0005_create_role_permissions.ts`. Composite
 * primary key `(role_id, permission_id)` enforces uniqueness; both FKs
 * cascade on delete. The seed in the migration reproduces verbatim the
 * default mapping documented in `specs/rbac/spec.md`.
 */
@Entity({ name: 'role_permissions' })
export class RolePermissionEntity {
  @PrimaryColumn({ name: 'role_id', type: 'uuid' })
  roleId!: string;

  @Index('ix_role_permissions_permission_id')
  @PrimaryColumn({ name: 'permission_id', type: 'uuid' })
  permissionId!: string;

  @ManyToOne(() => RoleEntity, (role) => role.rolePermissions, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'role_id' })
  role?: RoleEntity;

  @ManyToOne(() => PermissionEntity, (permission) => permission.rolePermissions, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'permission_id' })
  permission?: PermissionEntity;
}
