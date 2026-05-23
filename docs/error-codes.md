# Error codes catalog

Stable, public API contract. Every error returned by the backend takes
the failure envelope shape produced by `AllExceptionsFilter`
(BE-BOOT-06):

```json
{
  "data": null,
  "error": {
    "code": "<STABLE_CODE>",
    "message": "Human-readable, English. Safe to surface to end users.",
    "details": { /* optional, structured */ }
  }
}
```

Codes are emitted by `apps/backend/src/common/errors/error-codes.ts`.
HTTP status is mapped by `apps/backend/src/common/errors/http-status.map.ts`
(exhaustively, compile-time enforced).

> **Do not rename or reuse a code.** It is part of the public API.
> Add new codes instead and deprecate the old in the changelog.

## Catalog

### `AUTH_*` — authentication / credential failures

| Code | HTTP | Meaning | Typical trigger |
|---|---|---|---|
| `AUTH_INVALID_CREDENTIALS` | 401 | Wrong email or password (constant-time response, no email enumeration) | `POST /auth/login` |
| `AUTH_INVALID_TOKEN` | 401 | Access / refresh / invitation / MFA-challenge token is invalid, expired, tampered or missing | every `JwtAuthGuard`-protected route; `POST /auth/refresh` |
| `AUTH_EMAIL_TAKEN` | 409 | Email already registered | `POST /auth/signup` |
| `AUTH_WEAK_PASSWORD` | 422 | Password fails the policy (≥ 12 chars) | `POST /auth/signup`, `POST /accept-invitation` (signup branch) |
| `AUTH_MFA_REQUIRED` | 401 | (Reserved — currently login returns a discriminated union instead) | — |
| `AUTH_MFA_INVALID_CODE` | 401 | Wrong TOTP / backup code, or stale MFA challenge | `POST /auth/mfa/{verify,disable,verify-challenge}` |
| `AUTH_MFA_NOT_ENROLLED` | 401 | MFA setup never initiated, or already disabled | `POST /auth/mfa/{verify,disable}` |
| `AUTH_MFA_ALREADY_ENABLED` | 409 | Caller tried to re-enrol with MFA already active | `POST /auth/mfa/{setup,verify}` |
| `AUTH_REFRESH_REUSE` | 401 | Refresh token replay detected — the whole family is revoked | `POST /auth/refresh` |

### `ORG_*` — organization lifecycle / tenant scope

| Code | HTTP | Meaning | Typical trigger |
|---|---|---|---|
| `ORG_NOT_FOUND` | 404 | Tenant unreachable: missing org, soft-deleted, no active membership for caller, URL/token id mismatch. **Always 404, never 403** — no info disclosure | `TenantGuard`, `PATCH /organizations/:id`, `POST /auth/select-organization` |
| `ORG_LAST_ADMIN` | 409 | Attempted role change would leave the org without an active admin | `PATCH /organizations/:id/members/:userId` |
| `ORG_NOTHING_TO_UPDATE` | 422 | `PATCH` body is empty after the DTO whitelist drops unknown fields | `PATCH /organizations/:id` |

### `FORBIDDEN_*` — authorization (caller authenticated but not allowed)

| Code | HTTP | Meaning | Typical trigger |
|---|---|---|---|
| `FORBIDDEN_ROLE` | 403 | Caller's role is not in the `@Roles(...)` allow-list | `RolesGuard` |
| `FORBIDDEN_PERMISSION` | 403 | Caller's role does not grant the required `@RequirePermission()` code | `PermissionsGuard` |
| `FORBIDDEN_NO_MEMBERSHIP` | 403 | Permission / role guard ran without `currentOrg` bound — TenantGuard is missing in the composition | `RolesGuard`, `PermissionsGuard` (defensive) |

### `INVITATION_*` — invitation lifecycle

| Code | HTTP | Meaning | Typical trigger |
|---|---|---|---|
| `INVITATION_NOT_FOUND` | 404 | Token doesn't match a known row (or unknown role at issue time) | `POST /accept-invitation`, `POST /organizations/:id/invitations` |
| `INVITATION_EXPIRED` | 410 | Token TTL elapsed (7 days from issuance) | `POST /accept-invitation` |
| `INVITATION_ALREADY_USED` | 409 | Token already accepted, or target user already a member | `POST /accept-invitation` |
| `INVITATION_ALREADY_PENDING` | 409 | A live invitation already exists for `(org, email)` | `POST /organizations/:id/invitations` |
| `INVITATION_REVOKED` | 409 | Token was revoked by an admin before acceptance | `POST /accept-invitation` |

### `RBAC_*` — guard wiring / policy declaration

| Code | HTTP | Meaning | Typical trigger |
|---|---|---|---|
| `RBAC_NO_POLICY_DECLARED` | 403 | `PermissionsGuard` ran on a handler without `@RequirePermission()`. **Deny-by-default** — a forgotten annotation is a loud failure, not a silent privilege leak | `PermissionsGuard` |
| `RBAC_SYSTEM_ROLE_LOCKED` | 403 | Attempt to mutate a seeded role (`admin`, `expert_comptable`, …) via the API | reserved for future role-management endpoints |

## How to add a new code

1. Add the literal to `ERROR_CODES` in
   `apps/backend/src/common/errors/error-codes.ts`. The `ErrorCode`
   union is auto-derived from the keys — no other declaration is
   needed at the type level.
2. Add the matching HTTP status to `ERROR_CODE_TO_HTTP_STATUS` in
   `http-status.map.ts`. The `Record<ErrorCode, number>` type
   constraint makes this a build error if you forget.
3. Add the entry to the exhaustive `Record<keyof typeof ERROR_CODES, number>`
   in `app-exception.spec.ts` so the per-code test still covers
   every code.
4. Document the new entry in this file under the right family.
5. Use it via `throw new AppException(ERROR_CODES.MY_NEW_CODE, { message, details? })`.
