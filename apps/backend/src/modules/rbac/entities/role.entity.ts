import { Column, Entity, Index, OneToMany, PrimaryGeneratedColumn } from 'typeorm';

import { MembershipEntity } from './membership.entity';
import { RolePermissionEntity } from './role-permission.entity';

/**
 * `roles` row (BE-DB-03) — catalog of the six business roles seeded by
 * the migration.
 *
 * Mirrors `database/migrations/0003_create_roles.ts`. `code` is the stable
 * machine identifier consumed by `@Roles(...)` and `@RequirePermission(...)`
 * decorators (BE-RBAC-*). `isSystem = true` rows are seeded and must never
 * be deleted or renamed via the API (enforced at the service layer; the
 * data layer simply exposes the flag).
 */
export type SystemRoleCode =
  | 'admin'
  | 'expert_comptable'
  | 'chef_mission'
  | 'comptable'
  | 'auditeur'
  | 'client_readonly';

@Entity({ name: 'roles' })
export class RoleEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // `code` is `text` at the DB layer (no enum), so the column type is plain
  // `string`. `SystemRoleCode` is the canonical set of seeded codes — service
  // / guard code that consumes this entity should narrow with that type.
  @Index('uq_roles_code', { unique: true })
  @Column({ type: 'text' })
  code!: string;

  @Column({ type: 'text' })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ name: 'is_system', type: 'boolean', default: true })
  isSystem!: boolean;

  @OneToMany(() => RolePermissionEntity, (rp) => rp.role)
  rolePermissions?: RolePermissionEntity[];

  @OneToMany(() => MembershipEntity, (membership) => membership.role)
  memberships?: MembershipEntity[];
}
