import type { Request } from 'express';

import type { RequestContext } from '../types/request-context';

/**
 * Shape of the audit context consumed by every service that journals
 * to `auth_events` (signup, login, refresh, invitations, MFA, …). Kept
 * separate from the broader `RequestContext` so the audit surface
 * stays a tight, JSON-friendly value object the test harness can build
 * without an Express request.
 */
export interface AuditRequestContext {
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
}

type RequestWithContext = Request & { context?: RequestContext };

/**
 * Build the `AuditRequestContext` consumed by services from the raw
 * Express `Request`.
 *
 * Reads from `req.context.ip` / `req.context.userAgent` first
 * (populated by `RequestContextMiddleware` — BE-BOOT-08). Falls back to
 * `req.ip` and `req.headers['user-agent']` so the function still works
 * in unit tests that pass a bare request stub without going through the
 * middleware chain.
 *
 * Centralized here so all controllers (`AuthController`,
 * `OrganizationsController`, `MembersController`,
 * `InvitationsController`, `AcceptInvitationController`) share a single
 * implementation — previously each had a local copy of the same logic.
 */
export function buildAuditRequestContext(req: RequestWithContext): AuditRequestContext {
  const ctxIp = req.context?.ip;
  const ip =
    typeof ctxIp === 'string' && ctxIp.length > 0
      ? ctxIp
      : typeof req.ip === 'string' && req.ip.length > 0
        ? req.ip
        : null;

  const ctxUa = req.context?.userAgent;
  const headerUa = req.headers['user-agent'];
  const userAgent =
    typeof ctxUa === 'string' && ctxUa.length > 0
      ? ctxUa
      : typeof headerUa === 'string' && headerUa.length > 0
        ? headerUa
        : null;

  return { ipAddress: ip, userAgent };
}
