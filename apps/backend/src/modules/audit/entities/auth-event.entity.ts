import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { UserEntity } from '../../auth/entities/user.entity';
import { OrganizationEntity } from '../../organizations/entities/organization.entity';

/**
 * `auth_events` row (BE-DB-10) — append-only journal of authentication and
 * tenant-lifecycle events documented in `specs/auth/spec.md`.
 *
 * Mirrors `database/migrations/0010_create_auth_events.ts`. Both `userId`
 * and `organizationId` are nullable: a failed login by an unknown email
 * has no user; an event before "select organization" has no org. The
 * service writes through `AuthEventsService.record(...)` (BE-AUDIT-*).
 * Mutation/deletion is intentionally NOT supported by this repository —
 * the spec mandates an append-only journal.
 */
export type AuthEventType =
  | 'auth.signup'
  | 'auth.login_success'
  | 'auth.login_failed'
  | 'auth.logout'
  | 'auth.refresh_token_reuse_detected'
  | 'auth.mfa_challenge_issued'
  | 'auth.mfa_enabled'
  | 'auth.mfa_disabled'
  | 'auth.mfa_verification_failed'
  | 'auth.password_changed'
  | 'auth.cross_tenant_attempt'
  | 'organizations.role_changed'
  | 'organizations.invitation_sent'
  | 'organizations.invitation_accepted'
  | 'organizations.updated';

@Entity({ name: 'auth_events' })
@Index('ix_auth_events_user_id_created_at', ['userId', 'createdAt'])
@Index('ix_auth_events_organization_id_created_at', ['organizationId', 'createdAt'])
@Index('ix_auth_events_event_type_created_at', ['eventType', 'createdAt'])
export class AuthEventEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId!: string | null;

  @Column({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId!: string | null;

  // `event_type` is `text` at the DB layer (Module 7 extends the catalog
  // without a schema migration), so the column type is plain `string`.
  // `AuthEventType` is the canonical set of Module 1 codes — emitters should
  // narrow to that type at the call site.
  @Column({ name: 'event_type', type: 'text' })
  eventType!: string;

  @Column({ name: 'ip_address', type: 'inet', nullable: true })
  ipAddress!: string | null;

  @Column({ name: 'user_agent', type: 'text', nullable: true })
  userAgent!: string | null;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @ManyToOne(() => UserEntity, (user) => user.authEvents, {
    onDelete: 'SET NULL',
    nullable: true,
  })
  @JoinColumn({ name: 'user_id' })
  user?: UserEntity | null;

  @ManyToOne(() => OrganizationEntity, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'organization_id' })
  organization?: OrganizationEntity | null;
}
