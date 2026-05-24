import { Injectable, Logger } from '@nestjs/common';

import { AuditLogEntity, type AuditModule } from '../entities/audit-log.entity';
import { AuditLogRepository } from '../repositories/audit-log.repository';

/**
 * Per-request context captured by `RequestContextMiddleware` and read by
 * audit emitters. Kept as a plain value object (no Express coupling) so
 * service tests can build it without a request stub.
 *
 *   - `userId` / `organizationId` are nullable: scheduled jobs and
 *     tenant-less events (auth signup before org selection,
 *     cross-tenant attack telemetry) legitimately have no actor or
 *     tenant. The underlying columns are nullable for the same reason
 *     (cf. `0010_create_auth_events.ts`).
 *   - `requestId` is the value `RequestIdMiddleware` (BE-BOOT-09)
 *     stamps on every incoming HTTP request. Captured so pino logs
 *     and audit rows can be cross-joined on a single id.
 */
export interface AuditContext {
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
  readonly userId?: string | null;
  readonly organizationId?: string | null;
  readonly requestId?: string | null;
}

/**
 * Public input to `AuditTrailService.record`.
 *
 *   - `module` is constrained to the `AuditModule` union so a typo is
 *     a compile error. The DB column is plain TEXT, so adding a new
 *     module is a one-line union extension — no migration. The
 *     `_legacy` value exists ONLY for the 0019 backfill path; new
 *     emitters must NEVER pass it.
 *   - `action` is free-form (snake_case verb phrase, e.g.
 *     `account_created`, `session_uploaded`).
 *   - `entityType` / `entityId` together identify the business
 *     entity touched by the event. Both nullable for events that have
 *     no single target.
 *   - `before` / `after` should hold ONLY the changed fields, not the
 *     full row — this keeps the JSONB payload small and the audit
 *     view readable. Both nullable for create / read / no-diff events.
 *   - `metadata` is the free-form bag for everything that doesn't fit
 *     the structured columns (`reason`, `correlationId`, `actorRole`,
 *     external refs…).
 */
export interface AuditRecordOptions {
  readonly module: Exclude<AuditModule, '_legacy'>;
  readonly action: string;
  readonly entityType?: string | null;
  readonly entityId?: string | null;
  readonly before?: Record<string, unknown> | null;
  readonly after?: Record<string, unknown> | null;
  readonly metadata?: Record<string, unknown>;
  readonly ctx: AuditContext;
  /**
   * Optional override for the legacy `event_type` column. Used by
   * `AuthEventsService` so existing Module 1 readers see the same
   * canonical codes (`auth.login_success`, `organizations.role_changed`)
   * they always have. New emitters should NOT pass this; the
   * repository synthesizes `event_type = ${module}.${action}` by
   * default.
   */
  readonly legacyEventType?: string;
}

/**
 * `AuditTrailService` (BE-AUDIT-12) — generic, module-agnostic write
 * surface for the unified Module 7 audit journal.
 *
 * Guarantees
 * ----------
 *  - The write NEVER throws into the caller. A business action that
 *    succeeded but failed to journal must still return success; the
 *    failure is logged at WARN level so observability surfaces it
 *    without bricking the user-facing path. This matches the
 *    swallow-and-warn contract of `AuthEventsService` (BE-AUDIT-01).
 *  - Mutation / deletion are intentionally not exposed; the journal
 *    is append-only by spec.
 *
 * Relationship to `AuthEventsService`
 * -----------------------------------
 * `AuthEventsService.record(eventType, ctx, metadata)` is the narrow
 * Module 1 API and stays the entry point for auth/org/MFA/invitation
 * events. Internally (BE-AUDIT-13) it delegates here so every audit
 * row — legacy or generic — flows through a single write path and
 * lands in a uniformly enriched row.
 */
/**
 * Action codes follow the `snake_case` convention shared with the
 * canonical Module 1 `AuthEventType` codes (`login_success`,
 * `account_created`, `session_uploaded`, …). The regex is intentionally
 * lenient (allows trailing dots for namespaced actions like
 * `mfa.verify_failed`) but rejects spaces, capitals, and typos that
 * couldn't possibly be a real catalog code.
 *
 * Centralised here so both the write path (`AuditTrailService.record`)
 * and the read path (`ListAuditLogsQueryDto.action` filter) validate
 * against the same shape.
 */
export const AUDIT_ACTION_REGEX = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*$/;

@Injectable()
export class AuditTrailService {
  private readonly logger = new Logger(AuditTrailService.name);

  constructor(private readonly repo: AuditLogRepository) {}

  async record(options: AuditRecordOptions): Promise<AuditLogEntity | null> {
    // Runtime guard against caller typos (audit Module 7 Code-H1).
    // Compile-time we get `module: Exclude<AuditModule, '_legacy'>` —
    // `action` is intentionally a free-form `string` because each
    // module owns its own action catalogue. The regex rejects
    // obviously-wrong values (spaces, capitals, leading digits) so a
    // single typo doesn't silently land in the journal and never
    // match a dashboard filter.
    if (!AUDIT_ACTION_REGEX.test(options.action)) {
      this.logger.warn(
        `record: rejected '${options.module}.${options.action}' — ` +
          `action must match ${AUDIT_ACTION_REGEX.source} (snake_case, optional dotted namespace)`,
      );
      return null;
    }

    try {
      return await this.repo.record({
        module: options.module,
        action: options.action,
        userId: options.ctx.userId ?? null,
        organizationId: options.ctx.organizationId ?? null,
        entityType: options.entityType ?? null,
        entityId: options.entityId ?? null,
        before: options.before ?? null,
        after: options.after ?? null,
        ipAddress: options.ctx.ipAddress,
        userAgent: options.ctx.userAgent,
        requestId: options.ctx.requestId ?? null,
        metadata: options.metadata ?? {},
        legacyEventType: options.legacyEventType,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'unknown error';
      this.logger.warn(
        `record: failed to persist '${options.module}.${options.action}' audit log ` +
          `(userId=${options.ctx.userId ?? 'null'}, orgId=${options.ctx.organizationId ?? 'null'}): ${message}`,
      );
      return null;
    }
  }
}
