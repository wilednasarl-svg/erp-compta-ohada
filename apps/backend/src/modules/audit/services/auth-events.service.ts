import { Injectable, Logger } from '@nestjs/common';

import { AuthEventEntity, type AuthEventType } from '../entities/auth-event.entity';
import type { AuditModule } from '../entities/audit-log.entity';
import { AuditTrailService } from './audit-trail.service';

/**
 * Per-request context propagated by controllers (extracted from the HTTP
 * request via `buildAuditRequestContext` — BE-AUDIT-02). Kept as a plain
 * value object so the service stays trivially unit-testable without an
 * Express request.
 *
 * `userId` and `organizationId` are both nullable: a failed login by an
 * unknown email has no `userId`; an event emitted before
 * `POST /auth/select-organization` has no `organizationId`. The underlying
 * `auth_events` columns are nullable for the same reason
 * (cf. `0010_create_auth_events.ts`).
 */
export interface AuthEventContext {
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
  readonly userId?: string | null;
  readonly organizationId?: string | null;
  readonly requestId?: string | null;
}

/**
 * `AuthEventsService` (BE-AUDIT-01) — typed entry-point for the Module 1
 * `auth.*` / `organizations.*` event codes.
 *
 * Wraps `AuditTrailService.record()` (BE-AUDIT-12) with two ergonomic
 * guarantees that keep call sites short and grep-friendly:
 *
 *   - `eventType` is constrained to the typed `AuthEventType` union so a
 *     typo is a compile error rather than a silently-recorded mystery
 *     event.
 *   - The audit write NEVER throws into the caller. `AuditTrailService`
 *     swallows repository failures and logs WARN; this layer keeps the
 *     same contract for back-compat with the existing call sites.
 *
 * Why a thin wrapper over `AuditTrailService`
 * -------------------------------------------
 * Module 7 (vague 1) unifies all audit writes through
 * `AuditTrailService`. Routing this service through it gives us a
 * single physical write path that always populates `module`, `action`,
 * `event_type` (legacy), `requestId`, etc. — without forcing every
 * Module 1 call site to switch to the new generic API.
 *
 * Mutation / deletion are intentionally not exposed: the underlying
 * repository does not implement them and the spec mandates an
 * append-only journal (cf. `specs/auth/spec.md`).
 */
@Injectable()
export class AuthEventsService {
  private readonly logger = new Logger(AuthEventsService.name);

  constructor(private readonly auditTrail: AuditTrailService) {}

  async record(
    eventType: AuthEventType,
    context: AuthEventContext,
    metadata: Record<string, unknown> = {},
  ): Promise<AuthEventEntity | null> {
    const [moduleSegment, ...actionSegments] = eventType.split('.');
    // The canonical Module 1 codes ALL contain a dot (`auth.signup`,
    // `organizations.invitation_sent`, …) so `split` always yields at
    // least two segments. The defensive fallback below keeps a
    // hand-rolled typo (e.g. a custom event added without a dot)
    // recoverable rather than throwing — the WARN log surfaces it.
    if (moduleSegment === undefined || actionSegments.length === 0) {
      this.logger.warn(
        `record: malformed eventType '${eventType}' — missing module/action separator`,
      );
      return null;
    }
    const moduleCode = moduleSegment as Exclude<AuditModule, '_legacy'>;
    const action = actionSegments.join('.');

    return (await this.auditTrail.record({
      module: moduleCode,
      action,
      legacyEventType: eventType,
      metadata,
      ctx: {
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        userId: context.userId ?? null,
        organizationId: context.organizationId ?? null,
        requestId: context.requestId ?? null,
      },
    })) as AuthEventEntity | null;
  }
}
