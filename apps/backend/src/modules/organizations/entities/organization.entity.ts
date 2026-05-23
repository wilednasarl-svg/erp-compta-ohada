import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { InvitationEntity } from './invitation.entity';
import { MembershipEntity } from '../../rbac/entities/membership.entity';

/**
 * `organizations` row (BE-DB-01) — tenant root of the multi-tenant model.
 *
 * Mirrors the schema created in
 * `database/migrations/0001_create_organizations.ts`. `type` discriminates
 * accounting firms (`firm`) from standalone companies (`company`); the
 * underlying CHECK constraint lives in the migration. `slug` is the
 * immutable URL-safe identifier and is globally unique. `deletedAt` enables
 * soft-delete and is indexed for fast "active tenants" filtering.
 */
export type OrganizationType = 'firm' | 'company';

@Entity({ name: 'organizations' })
export class OrganizationEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'text' })
  name!: string;

  @Index('uq_organizations_slug', { unique: true })
  @Column({ type: 'text' })
  slug!: string;

  @Column({ type: 'text' })
  type!: OrganizationType;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @Index('ix_organizations_deleted_at')
  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;

  @OneToMany(() => MembershipEntity, (membership) => membership.organization)
  memberships?: MembershipEntity[];

  @OneToMany(() => InvitationEntity, (invitation) => invitation.organization)
  invitations?: InvitationEntity[];
}
