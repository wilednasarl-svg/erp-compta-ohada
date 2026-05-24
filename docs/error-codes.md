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

### `CHART_ACCOUNT_*` / `ACCOUNTING_SYSTEM_*` — Module 2 plan comptable

| Code | HTTP | Meaning | Typical trigger |
|---|---|---|---|
| `CHART_ACCOUNT_NOT_FOUND` | 404 | Account does not exist in the org's chart (or cross-tenant probe) | `GET/PATCH/DELETE /organizations/:id/chart-of-accounts/:accountId` |
| `CHART_ACCOUNT_CODE_TAKEN` | 409 | A row with the same `code` already exists in the org's chart (reference-cloned or custom) | `POST /organizations/:id/chart-of-accounts` |
| `CHART_ACCOUNT_INVALID_PARENT` | 422 | New code does not start with the parent's code, parent is missing, or parent is inactive | `POST /organizations/:id/chart-of-accounts` |
| `CHART_ACCOUNT_INVALID_CODE` | 422 | Code is not 2 to 10 digits | `POST /organizations/:id/chart-of-accounts` |
| `CHART_ACCOUNT_NOT_DELETABLE` | 409 | Account is reference-backed (only deactivation allowed) OR has at least one active child | `DELETE /organizations/:id/chart-of-accounts/:accountId` |
| `CHART_ACCOUNT_IMMUTABLE_CODE` | 422 | PATCH body included `code` (immutable after creation) | `PATCH /organizations/:id/chart-of-accounts/:accountId` |
| `ACCOUNTING_SYSTEM_REQUIRED` | 422 | `POST /organizations` body missing or has invalid `system` (must be `NORMAL`, `MINIMAL`, or `ALLEGE`) | `POST /organizations` |

### `IMPORT_*` — Module 3 moteur d'imports

| Code | HTTP | Meaning | Typical trigger |
|---|---|---|---|
| `IMPORT_SESSION_NOT_FOUND` | 404 | Session introuvable ou hors tenant | `GET/PATCH/DELETE /imports/sessions/:id` |
| `IMPORT_SESSION_NOT_DRAFT` | 409 | Mutation impossible — session pas en état `draft` | upload sur session déjà parsée |
| `IMPORT_SESSION_NOT_PARSED` | 409 | Preview / commit impossible — session pas encore parsée | `POST .../preview` trop tôt |
| `IMPORT_SESSION_NOT_VALID` | 409 | Commit impossible — session contient des lignes invalides | `POST .../commit` |
| `IMPORT_FILE_NOT_FOUND` | 404 | Fichier introuvable dans la session | `GET .../files/:fileId` |
| `IMPORT_FILE_TOO_LARGE` | 413 | Fichier dépasse la limite configurée (`IMPORT_MAX_FILE_SIZE`) | `POST .../files` |
| `IMPORT_FILE_DUPLICATE` | 409 | SHA-256 du fichier déjà présent dans la session | `POST .../files` |
| `IMPORT_UNSUPPORTED_FORMAT` | 422 | Extension ou MIME non accepté (seuls CSV / XLSX / Sage) | `POST .../files` |
| `IMPORT_FILE_PARSE_FAILED` | 422 | Parser n'a pas pu lire le fichier (encodage, structure corrompue) | `POST .../files` |

### `TRANSFORMATION_*` — Module 4 moteur de transformations

| Code | HTTP | Meaning | Typical trigger |
|---|---|---|---|
| `TRANSFORMATION_SOURCE_ENTRY_NOT_FOUND` | 404 | Écriture source introuvable ou hors tenant | `POST .../reclassify`, `POST .../adjust` |
| `TRANSFORMATION_NO_FIELD_CHANGED` | 422 | Reclassement fourni sans aucun champ à modifier | `POST .../reclassify` sans `account`, `journal`, `partner`, ni `label` |
| `TRANSFORMATION_ADJUSTMENT_INVALID` | 422 | Exactement un de `adjustmentDebit` / `adjustmentCredit` doit être fourni | `POST .../adjust` avec les deux ou aucun |

### `RULE_*` — Module 5 moteur de règles

| Code | HTTP | Meaning | Typical trigger |
|---|---|---|---|
| `RULE_NOT_FOUND` | 404 | Règle introuvable ou hors tenant | `GET/PATCH .../rules/:ruleId`, `POST .../simulate`, `POST .../apply` |
| `RULE_INVALID_CONDITION` | 422 | Type de condition inconnu dans le DSL | `POST /rules` ou `PATCH /rules/:id` |
| `RULE_INVALID_ACTION` | 422 | Type d'action inconnu dans le DSL | `POST /rules` ou `PATCH /rules/:id` |

### `WORKFLOW_*` — Module 6 moteur de workflows

| Code | HTTP | Meaning | Typical trigger |
|---|---|---|---|
| `WORKFLOW_INSTANCE_NOT_FOUND` | 404 | Instance de workflow introuvable ou hors tenant | `GET/PATCH .../workflows/:id` |
| `WORKFLOW_TRANSITION_INVALID` | 409 | Transition refusée par la state machine (ex. `approved → draft`) | `POST .../workflows/:id/transition` |
| `WORKFLOW_LOCKED` | 409 | Objet ciblé est en état `locked` — mutations bloquées | `assertNotLocked` dans TransformationService et ImportsService |

### `DOC_*` — Module 10 moteur de documents

| Code | HTTP | Meaning | Typical trigger |
|---|---|---|---|
| `DOC_NOT_FOUND` | 404 | Document introuvable ou hors tenant | `GET/DELETE .../documents/:id` |
| `DOC_FILE_REQUIRED` | 422 | Upload sans fichier joint | `POST .../documents` sans multipart `file` |
| `DOC_FILE_TOO_LARGE` | 413 | Fichier dépasse la limite configurée | `POST .../documents` |
| `DOC_MIME_REJECTED` | 422 | MIME non accepté par la politique document | `POST .../documents` |
| `DOC_STORAGE_FAILURE` | 500 | Driver de stockage a planté (FS, S3…) | `POST .../documents` |

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
