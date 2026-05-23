/**
 * `RequestContext` — typed, per-request scratch space attached to every
 * incoming HTTP request as `req.context`.
 *
 * Populated incrementally by Nest middlewares / interceptors and consumed
 * by downstream layers (controllers, services, audit, logger):
 *
 *  - `requestId` — BE-BOOT-09 (`RequestIdMiddleware`): correlation id reused
 *    from the inbound `x-request-id` header or generated on the spot.
 *  - `ip` / `userAgent` — BE-BOOT-08 (`RequestContextInterceptor`):
 *    transport metadata used by `AuthEventsService.record()`.
 *
 * Fields stay optional because each populator runs independently — never
 * assume a downstream populator has already filled its slot.
 */
export interface RequestContext {
  requestId?: string;
  ip?: string;
  userAgent?: string;
}

/**
 * Helper intersection used by middlewares / interceptors that need to
 * write to `req.context` without leaning on `any`.
 *
 * We intentionally do NOT augment Express' global `Request` type here.
 * Module augmentation requires the augmented module to be transitively
 * imported at compile time, which is fragile across build/CLI tooling
 * (TypeORM CLI, ts-node scripts). Keeping the extension local — via
 * `Request & WithRequestContext` at call sites — gives us the same type
 * safety with no ambient side effects.
 */
export type WithRequestContext = {
  context?: RequestContext;
};
