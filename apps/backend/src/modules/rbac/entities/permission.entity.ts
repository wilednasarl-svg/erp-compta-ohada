import { Column, Entity, Index, OneToMany, PrimaryGeneratedColumn } from 'typeorm';

import { RolePermissionEntity } from './role-permission.entity';

/**
 * `permissions` row (BE-DB-04) — catalog of atomic authorization codes
 * (e.g. `accounting.write`, `organizations.invite`).
 *
 * Mirrors `database/migrations/0004_create_permissions.ts`. Permissions are
 * never granted directly to users — they are linked to roles via
 * `role_permissions` (BE-DB-05) and resolved at request time through
 * `User → Membership(role) → Role → Permission` (see `specs/rbac/spec.md`).
 */
@Entity({ name: 'permissions' })
export class PermissionEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('uq_permissions_code', { unique: true })
  @Column({ type: 'text' })
  code!: string;

  @Column({ type: 'text' })
  description!: string;

  @OneToMany(() => RolePermissionEntity, (rp) => rp.permission)
  rolePermissions?: RolePermissionEntity[];
}
