/**
 * `RequestIdMiddleware` (BE-BOOT-09)
 *
 * Guarantees that every HTTP request carries a stable correlation id:
 *
 *  1. If the inbound request already provides an `x-request-id` header
 *     whose value is "safe" (charset + length bounded — see
 *     `isSafeRequestId`), it is reused as-is so end-to-end traces from a
 *     reverse proxy (NGINX, Vercel, Supabase Edge) survive the hop.
 *  2. Otherwise a fresh RFC 4122 v4 UUID is generated via
 *     `crypto.randomUUID()` (Node ≥ 19 — `engines.node` pins ≥ 20 in
 *     `apps/backend/package.json`).
 *
 * The chosen id is exposed in three places, so every downstream consumer
 * can pick it up from whichever surface is most ergonomic:
 *
 *  - `req.id` — convention read by `pino-http`'s `genReqId`, ensuring
 *    every request log line carries `request_id`.
 *  - `req.context.requestId` — typed `RequestContext` slot consumed by
 *    interceptors / controllers / services without touching the raw
 *    Express request shape.
 *  - response header `x-request-id` — echoed back to the caller so
 *    clients can quote it when reporting issues.
 *
 * NOTE: this middleware MUST run before any logger / business middleware
 * that wants to read the correlation id. `AppModule.configure()` wires
 * it on `*` (every route) before `LoggerModule` registers its own
 * `pino-http` middleware.
 */

import { randomUUID } from 'node:crypto';
import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

import type { RequestContext } from '../types/request-context';

export const REQUEST_ID_HEADER = 'x-request-id';

/** Pino-http already augments the IncomingMessage with `.id`. We re-declare
 * the property locally as optional so we can set it without leaning on
 * `any`, and so the middleware also works when pino-http is not yet
 * registered (e.g. unit tests). */
type RequestWithId = Request & { id?: string; context?: RequestContext };

/** Upper bound to defang oversized headers from misbehaving clients
 * before they reach the logger. 200 chars is well past any realistic id
 * format (UUID, ULID, hex64). */
const MAX_REQUEST_ID_LENGTH = 200;

/** Whitelist of characters allowed inside an inbound `x-request-id`.
 * Tight on purpose: rejects whitespace, quotes, ANSI escapes, NUL,
 * anything that could poison log lines or downstream parsers. */
const SAFE_REQUEST_ID_PATTERN = /^[A-Za-z0-9._\-+:]+$/;

function isSafeRequestId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_REQUEST_ID_LENGTH &&
    SAFE_REQUEST_ID_PATTERN.test(value)
  );
}

function readInboundRequestId(req: Request): string | undefined {
  const raw = req.headers[REQUEST_ID_HEADER];
  if (Array.isArray(raw)) {
    return raw.find((value): value is string => isSafeRequestId(value));
  }
  return isSafeRequestId(raw) ? raw : undefined;
}

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const reqWithId = req as RequestWithId;

    const inbound = readInboundRequestId(req);
    const requestId = inbound ?? randomUUID();

    // 1. expose to pino-http via the conventional `req.id`
    reqWithId.id = requestId;

    // 2. fill the typed RequestContext slot (created if missing)
    const context: RequestContext = reqWithId.context ?? {};
    context.requestId = requestId;
    reqWithId.context = context;

    // 3. echo the id to the caller so it can be quoted in bug reports
    res.setHeader(REQUEST_ID_HEADER, requestId);

    next();
  }
}
