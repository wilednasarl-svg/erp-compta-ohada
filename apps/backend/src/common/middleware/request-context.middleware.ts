/**
 * `RequestContextMiddleware` (BE-BOOT-08)
 *
 * Populates `req.context.ip` and `req.context.userAgent` so downstream
 * code (controllers, services, audit) reads them off the typed
 * `RequestContext` slot instead of poking at the raw Express `Request`.
 *
 * Co-located with `RequestIdMiddleware` on purpose: both mutate the
 * same `req.context` bag, and the wiring order in `AppModule.configure()`
 * is `RequestIdMiddleware` → `RequestContextMiddleware` so `requestId`
 * lands first (logger middleware downstream reads it). Splitting into
 * two middlewares keeps each with a single responsibility — easier to
 * unit-test, easier to audit when a future hardening pass adds a third
 * concern (e.g. correlation id, trace parent).
 *
 * Why a middleware and not an interceptor:
 *   - Middlewares run BEFORE guards. `JwtAuthGuard` reads `req.context`
 *     to bind `currentUser`, and `TenantGuard` later uses the same bag
 *     for `currentOrg`. Running this populator at the interceptor stage
 *     would be too late.
 *   - The work is plain Express request/response — no Nest execution
 *     context machinery needed.
 *
 * The `ip` extraction trusts `req.ip` which is populated by Express;
 * when behind a reverse proxy (NGINX, Vercel, Supabase Edge), the app
 * must set `app.set('trust proxy', ...)` in bootstrap so `req.ip`
 * reflects the real client IP rather than the upstream proxy. That
 * trust-proxy decision belongs to BE-BOOT-* infra wiring, not this
 * middleware.
 */

import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

import type { RequestContext } from '../types/request-context';

type RequestWithContext = Request & { context?: RequestContext };

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction): void {
    const reqCtx = req as RequestWithContext;
    const context: RequestContext = reqCtx.context ?? {};

    if (typeof req.ip === 'string' && req.ip.length > 0) {
      context.ip = req.ip;
    }

    const uaHeader = req.headers['user-agent'];
    if (typeof uaHeader === 'string' && uaHeader.length > 0) {
      context.userAgent = uaHeader;
    }

    reqCtx.context = context;
    next();
  }
}
