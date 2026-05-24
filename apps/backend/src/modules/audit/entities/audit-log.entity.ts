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
 * Canonical Module 7 audit log row (BE-AUDIT-10) — backed by the same
 * physical `auth_events` table as the legacy `AuthEventEntity`.
 *
 * Why two entities over one table
 * -------------------------------
 *  - `AuthEventEntity` keeps Module 1's narrow, typed surface
 *    (`AuthEventType` union, `event_type` text column only). Its
 *    repository remains the sanctioned writer for the Module 1 call
 *    sites that don't have `before`/`after`/`entity_id` semantics
 *    (login, signup, MFA, invitation, …) — those stay one-liners.
 *  - `AuditLogEntity` exposes ALL columns so Module 7's generic
 *    services (`AuditTrailService`, `AuditLogsController`) and the
 *    Module 2+ call sites that DO have entity/before/after semantics
 *    work against a single, type-safe shape.
 *
 * Both entities are mapped to `auth_events` via `@Entity({ name: ... })`.
 * TypeORM treats them as separate `Repository<T>` instances, but a row
 * written through one is fully readable through the other — the
 * underlying schema (post-0019) is a strict superset of the legacy
 * fields.
 *
 * Module catalog
 * --------------
 * Kept here as a string-literal union for compile-time grep / call-site
 * autocompletion. The DB column is plain TEXT so adding a new module
 * (e.g. `transformations`, `workflows`) is a one-line union extension —
 * no migration. The known-set MUST stay in sync with the catalog
 * documented in `docs/produit/audit-events.md`.
 */
export type AuditModule =
  | 'auth'
  | 'organizations'
  | 'rbac'
  | 'chart_of_accounts'
  | 'accounting'
  | 'imports'
  | 'transformations'
  | 'rules'
  | 'workflows'
  | 'journals'
  | 'reports'
  | 'documents'
  | 'ai'
  | '_legacy';

@Entity({ name: 'auth_events' })
@Index('ix_auth_events_org_module_created_at', ['organizationId', 'module', 'createdAt'])
@Index('ix_auth_events_org_module_action_created_at', [
  'organizationId',
  'module',
  'action',
  'createdAt',
])
export class AuditLogEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // `user_id` is nullable: a failed login by an unknown email, a
  // scheduled job, or an admin script all legitimately have no actor.
  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId!: string | null;

  // `organization_id` is nullable: tenant-less events (signup before
  // org selection, cross-tenant attack telemetry) carry NULL. The
  // tenant-scoped read filter on `/audit/logs` therefore skips these
  // rows for non-system viewers.
  @Column({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId!: string | null;

  // Legacy compound code preserved for back-compat with the
  // `AuthEventsController` projection. Writers populate it as
  // `${module}.${action}` so it stays a 1:1 view over the split
  // columns below.
  @Column({ name: 'event_type', type: 'text' })
  eventType!: string;

  @Column({ name: 'module', type: 'text' })
  module!: string;

  @Column({ name: 'action', type: 'text' })
  action!: string;

  @Column({ name: 'entity_type', type: 'text', nullable: true })
  entityType!: string | null;

  @Column({ name: 'entity_id', type: 'uuid', nullable: true })
  entityId!: string | null;

  @Column({ name: 'before', type: 'jsonb', nullable: true })
  before!: Record<string, unknown> | null;

  @Column({ name: 'after', type: 'jsonb', nullable: true })
  after!: Record<string, unknown> | null;

  @Column({ name: 'ip_address', type: 'inet', nullable: true })
  ipAddress!: string | null;

  @Column({ name: 'user_agent', type: 'text', nullable: true })
  userAgent!: string | null;

  @Column({ name: 'request_id', type: 'text', nullable: true })
  requestId!: string | null;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @ManyToOne(() => UserEntity, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'user_id' })
  user?: UserEntity | null;

  @ManyToOne(() => OrganizationEntity, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'organization_id' })
  organization?: OrganizationEntity | null;
}
