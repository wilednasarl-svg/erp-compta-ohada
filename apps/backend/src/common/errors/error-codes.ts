/**
 * Stable catalogue of business error codes.
 *
 * Codes are kept as a `const` object (not a TypeScript `enum`) so:
 *  - the wire format is always the string literal (no implicit numeric values),
 *  - the union type `ErrorCode` is derived directly from the catalogue
 *    (single source of truth shared with the HTTP status map),
 *  - frontend clients can pattern-match safely on the same strings without
 *    importing any backend code.
 *
 * Conventions:
 *  - Prefix groups by domain: `AUTH_*`, `ORG_*`, `FORBIDDEN_*`,
 *    `INVITATION_*`, `RBAC_*`.
 *  - Never reuse or rename a code: it is part of the public API contract.
 *  - Every code MUST have a matching entry in `http-status.map.ts`
 *    (compile-time enforced via `Record<ErrorCode, number>`).
 */

export const ERROR_CODES = {
  AUTH_INVALID_CREDENTIALS: 'AUTH_INVALID_CREDENTIALS',
  AUTH_EMAIL_TAKEN: 'AUTH_EMAIL_TAKEN',
  AUTH_WEAK_PASSWORD: 'AUTH_WEAK_PASSWORD',
  AUTH_MFA_REQUIRED: 'AUTH_MFA_REQUIRED',
  AUTH_MFA_INVALID_CODE: 'AUTH_MFA_INVALID_CODE',
  AUTH_REFRESH_REUSE: 'AUTH_REFRESH_REUSE',

  ORG_NOT_FOUND: 'ORG_NOT_FOUND',
  ORG_LAST_ADMIN: 'ORG_LAST_ADMIN',

  FORBIDDEN_ROLE: 'FORBIDDEN_ROLE',
  FORBIDDEN_PERMISSION: 'FORBIDDEN_PERMISSION',
  FORBIDDEN_NO_MEMBERSHIP: 'FORBIDDEN_NO_MEMBERSHIP',

  INVITATION_EXPIRED: 'INVITATION_EXPIRED',
  INVITATION_ALREADY_USED: 'INVITATION_ALREADY_USED',
  INVITATION_ALREADY_PENDING: 'INVITATION_ALREADY_PENDING',

  RBAC_NO_POLICY_DECLARED: 'RBAC_NO_POLICY_DECLARED',
  RBAC_SYSTEM_ROLE_LOCKED: 'RBAC_SYSTEM_ROLE_LOCKED',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/**
 * Exhaustive list of declared codes — useful for tests that must iterate
 * over the whole catalogue (e.g. ensure each code has a mapped HTTP status,
 * or generate per-code e2e error envelope tests, cf. BE-TEST-09).
 */
export const ALL_ERROR_CODES: ReadonlyArray<ErrorCode> = Object.values(
  ERROR_CODES,
) as ReadonlyArray<ErrorCode>;

/**
 * Type guard for runtime values coming from outside the type system
 * (HTTP payloads, persisted data, etc.).
 */
export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && (ALL_ERROR_CODES as ReadonlyArray<string>).includes(value);
}
