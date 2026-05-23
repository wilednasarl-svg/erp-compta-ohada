/**
 * Authenticated principal extracted from a verified access token by
 * `JwtAuthGuard` (BE-RBAC-01).
 *
 *   - `id` mirrors the JWT `sub`.
 *   - `mfaVerified` mirrors the `mfa_verified` claim — `false` on a token
 *     issued after a partial login (MFA challenge pending), `true` after
 *     `POST /auth/mfa/verify`, `false` by default for accounts with MFA
 *     disabled.
 *   - `tokenOrgId` mirrors the `org_id` claim AS STATED BY THE TOKEN.
 *     It is intentionally raw — `TenantGuard` (BE-RBAC-02) is the only
 *     code path allowed to translate this into a verified `currentOrg`
 *     (by cross-checking an active membership row). Until TenantGuard
 *     runs, downstream consumers must treat this value as untrusted.
 */
export interface CurrentUserContext {
  readonly id: string;
  readonly mfaVerified: boolean;
  readonly tokenOrgId?: string;
}

/**
 * Active organization context resolved by `TenantGuard` (BE-RBAC-02) after
 * cross-checking the `org_id` claim against an *active* membership row.
 * Populated only when the route is gated by `TenantGuard`; routes that do
 * not need a tenant scope (e.g. `POST /auth/select-organization`,
 * `/health/db`) leave it unset.
 */
export interface CurrentOrgContext {
  readonly id: string;
  readonly roleId: string;
  readonly role: string;
  readonly membershipId: string;
}

/**
 * `RequestContext` — typed, per-request scratch space attached to every
 * incoming HTTP request as `req.context`.
 *
 * Populated incrementally by Nest middlewares / guards / interceptors and
 * consumed by downstream layers (controllers, services, audit, logger):
 *
 *  - `requestId` — BE-BOOT-09 (`RequestIdMiddleware`).
 *  - `ip` / `userAgent` — BE-BOOT-08 (`RequestContextInterceptor`).
 *  - `currentUser` — BE-RBAC-01 (`JwtAuthGuard`).
 *  - `currentOrg`  — BE-RBAC-02 (`TenantGuard`).
 *
 * Fields stay optional because each populator runs independently — never
 * assume a downstream populator has already filled its slot.
 */
export interface RequestContext {
  requestId?: string;
  ip?: string;
  userAgent?: string;
  currentUser?: CurrentUserContext;
  currentOrg?: CurrentOrgContext;
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
