import type { Request } from 'express';

import type { RequestContext } from '../services/auth.service';

/**
 * Build the `RequestContext` consumed by `AuthService` from the raw
 * Express `Request`. Kept as a pure function (no decorator metadata) so
 * the controller can pass a synthesized context in tests without
 * spinning up Express.
 *
 *  - `ipAddress` : `req.ip` is populated by Express; when behind a proxy,
 *    `app.set('trust proxy', ...)` (bootstrap concern, BE-BOOT-*) makes
 *    it the real client IP rather than the upstream proxy.
 *  - `userAgent` : the value of the `User-Agent` header, or `null` when
 *    absent (curl with `-H "User-Agent:"`, internal callers, etc.).
 *
 * The shape mirrors `AuthService.RequestContext` (single source of truth).
 * If a global `RequestContextInterceptor` (BE-BOOT-08) lands later, this
 * helper becomes a thin shim around `req.context.ip` / `req.context.userAgent`.
 */
export function buildAuthRequestContext(request: Request): RequestContext {
  const ip = typeof request.ip === 'string' && request.ip.length > 0 ? request.ip : null;
  const uaHeader = request.headers['user-agent'];
  const userAgent = typeof uaHeader === 'string' && uaHeader.length > 0 ? uaHeader : null;
  return { ipAddress: ip, userAgent };
}
