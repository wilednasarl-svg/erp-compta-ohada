import { Injectable, Logger } from '@nestjs/common';

import { AuthEventEntity, type AuthEventType } from '../entities/auth-event.entity';
import { AuthEventRepository } from '../repositories/auth-event.repository';

/**
 * Per-request context propagated by controllers (extracted from the HTTP
 * request via `@CurrentRequestContext()` — BE-AUDIT-02). Kept as a plain
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
}

/**
 * `AuthEventsService` (BE-AUDIT-01) — single sanctioned entry-point for
 * appending to the `auth_events` journal.
 *
 * Wraps `AuthEventRepository.record()` with two ergonomic guarantees that
 * keep call sites short and grep-friendly:
 *
 *   - `eventType` is constrained to the typed `AuthEventType` union so a
 *     typo is a compile error rather than a silently-recorded mystery
 *     event.
 *   - The audit write NEVER throws into the caller. The `auth_events`
 *     write is observability, not the request's business outcome — a
 *     login that succeeded but failed to journal must still return a
 *     token, with the failure logged at WARN level. Otherwise a flaky
 *     audit table could brick auth.
 *
 * Mutation / deletion are intentionally not exposed: the repository
 * itself does not implement them and the spec mandates an append-only
 * journal (cf. `specs/auth/spec.md`).
 */
@Injectable()
export class AuthEventsService {
  private readonly logger = new Logger(AuthEventsService.name);

  constructor(private readonly repo: AuthEventRepository) {}

  async record(
    eventType: AuthEventType,
    context: AuthEventContext,
    metadata: Record<string, unknown> = {},
  ): Promise<AuthEventEntity | null> {
    try {
      return await this.repo.record({
        eventType,
        userId: context.userId ?? null,
        organizationId: context.organizationId ?? null,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        metadata,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'unknown error';
      this.logger.warn(
        `record: failed to persist '${eventType}' event (userId=${context.userId ?? 'null'}, orgId=${context.organizationId ?? 'null'}): ${message}`,
      );
      return null;
    }
  }
}
