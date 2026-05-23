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

import { OrganizationEntity } from './organization.entity';
import { UserEntity } from '../../auth/entities/user.entity';
import { RoleEntity } from '../../rbac/entities/role.entity';

/**
 * `invitations` row (BE-DB-07) — tenant-scoped invitation issued by an admin
 * to onboard a new (or existing) user.
 *
 * Mirrors `database/migrations/0007_create_invitations.ts`. `tokenHash` holds
 * the SHA-256 hash of the single-use token; the plaintext only ever appears
 * in the outgoing email. Lifecycle is `pending` → `accepted` | `expired` |
 * `revoked`. `expiresAt` is set by the service to `now() + 7 days`.
 *
 * This table carries `organizationId`, so every repository method exposed
 * for it MUST require that scope (see `invitation.repository.ts`).
 */
export type InvitationStatus = 'pending' | 'accepted' | 'expired' | 'revoked';

@Entity({ name: 'invitations' })
@Index('ix_invitations_org_email_status', ['organizationId', 'email', 'status'])
export class InvitationEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('ix_invitations_organization_id')
  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ type: 'citext' })
  email!: string;

  @Column({ name: 'role_id', type: 'uuid' })
  roleId!: string;

  @Index('uq_invitations_token_hash', { unique: true })
  @Column({ name: 'token_hash', type: 'text' })
  tokenHash!: string;

  @Column({ type: 'text', default: 'pending' })
  status!: InvitationStatus;

  @Column({ name: 'invited_by', type: 'uuid' })
  invitedBy!: string;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ name: 'accepted_at', type: 'timestamptz', nullable: true })
  acceptedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @ManyToOne(() => OrganizationEntity, (organization) => organization.invitations, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'organization_id' })
  organization?: OrganizationEntity;

  @ManyToOne(() => RoleEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'role_id' })
  role?: RoleEntity;

  @ManyToOne(() => UserEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'invited_by' })
  inviter?: UserEntity;
}
