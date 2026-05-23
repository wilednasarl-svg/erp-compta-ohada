import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { RoleEntity } from './role.entity';
import { UserEntity } from '../../auth/entities/user.entity';
import { OrganizationEntity } from '../../organizations/entities/organization.entity';

/**
 * `memberships` row (BE-DB-06) — spine of the multi-tenant model. Binds a
 * user to an organization with exactly one role and a lifecycle status.
 *
 * Mirrors `database/migrations/0006_create_memberships.ts`. The UNIQUE
 * `(user_id, organization_id)` constraint enforces "one role per user per
 * org" — promotions/demotions update the row in place. Authorization
 * always walks this row (`User → Membership(role) → Role → Permission`),
 * so every tenant-scoped read MUST filter by `organizationId`.
 */
export type MembershipStatus = 'active' | 'suspended';

@Entity({ name: 'memberships' })
@Index('uq_memberships_user_organization', ['userId', 'organizationId'], { unique: true })
export class MembershipEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('ix_memberships_user_id')
  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Index('ix_memberships_organization_id')
  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'role_id', type: 'uuid' })
  roleId!: string;

  @Column({ type: 'text' })
  status!: MembershipStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @ManyToOne(() => UserEntity, (user) => user.memberships, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user?: UserEntity;

  @ManyToOne(() => OrganizationEntity, (organization) => organization.memberships, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'organization_id' })
  organization?: OrganizationEntity;

  @ManyToOne(() => RoleEntity, (role) => role.memberships, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'role_id' })
  role?: RoleEntity;
}
