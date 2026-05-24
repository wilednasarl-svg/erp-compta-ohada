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
  AUTH_INVALID_TOKEN: 'AUTH_INVALID_TOKEN',
  AUTH_EMAIL_TAKEN: 'AUTH_EMAIL_TAKEN',
  AUTH_WEAK_PASSWORD: 'AUTH_WEAK_PASSWORD',
  AUTH_MFA_REQUIRED: 'AUTH_MFA_REQUIRED',
  AUTH_MFA_INVALID_CODE: 'AUTH_MFA_INVALID_CODE',
  AUTH_MFA_NOT_ENROLLED: 'AUTH_MFA_NOT_ENROLLED',
  AUTH_MFA_ALREADY_ENABLED: 'AUTH_MFA_ALREADY_ENABLED',
  AUTH_REFRESH_REUSE: 'AUTH_REFRESH_REUSE',

  ORG_NOT_FOUND: 'ORG_NOT_FOUND',
  ORG_LAST_ADMIN: 'ORG_LAST_ADMIN',
  ORG_NOTHING_TO_UPDATE: 'ORG_NOTHING_TO_UPDATE',

  FORBIDDEN_ROLE: 'FORBIDDEN_ROLE',
  FORBIDDEN_PERMISSION: 'FORBIDDEN_PERMISSION',
  FORBIDDEN_NO_MEMBERSHIP: 'FORBIDDEN_NO_MEMBERSHIP',

  INVITATION_EXPIRED: 'INVITATION_EXPIRED',
  INVITATION_ALREADY_USED: 'INVITATION_ALREADY_USED',
  INVITATION_ALREADY_PENDING: 'INVITATION_ALREADY_PENDING',
  INVITATION_NOT_FOUND: 'INVITATION_NOT_FOUND',
  INVITATION_REVOKED: 'INVITATION_REVOKED',

  RBAC_NO_POLICY_DECLARED: 'RBAC_NO_POLICY_DECLARED',
  RBAC_SYSTEM_ROLE_LOCKED: 'RBAC_SYSTEM_ROLE_LOCKED',

  // Module 2 — Plan comptable OHADA.
  CHART_ACCOUNT_NOT_FOUND: 'CHART_ACCOUNT_NOT_FOUND',
  CHART_ACCOUNT_CODE_TAKEN: 'CHART_ACCOUNT_CODE_TAKEN',
  CHART_ACCOUNT_INVALID_PARENT: 'CHART_ACCOUNT_INVALID_PARENT',
  CHART_ACCOUNT_INVALID_CODE: 'CHART_ACCOUNT_INVALID_CODE',
  CHART_ACCOUNT_NOT_DELETABLE: 'CHART_ACCOUNT_NOT_DELETABLE',
  CHART_ACCOUNT_IMMUTABLE_CODE: 'CHART_ACCOUNT_IMMUTABLE_CODE',
  ACCOUNTING_SYSTEM_REQUIRED: 'ACCOUNTING_SYSTEM_REQUIRED',

  // Module 3 — Import engine.
  IMPORT_SESSION_NOT_FOUND: 'IMPORT_SESSION_NOT_FOUND',
  IMPORT_SESSION_NOT_DRAFT: 'IMPORT_SESSION_NOT_DRAFT',
  IMPORT_SESSION_NOT_PARSED: 'IMPORT_SESSION_NOT_PARSED',
  IMPORT_FILE_NOT_FOUND: 'IMPORT_FILE_NOT_FOUND',
  IMPORT_FILE_TOO_LARGE: 'IMPORT_FILE_TOO_LARGE',
  IMPORT_FILE_DUPLICATE: 'IMPORT_FILE_DUPLICATE',
  IMPORT_UNSUPPORTED_FORMAT: 'IMPORT_UNSUPPORTED_FORMAT',
  IMPORT_FILE_PARSE_FAILED: 'IMPORT_FILE_PARSE_FAILED',

  // Module 10 — Document engine (vague 1).
  DOC_NOT_FOUND: 'DOC_NOT_FOUND',
  DOC_FILE_REQUIRED: 'DOC_FILE_REQUIRED',
  DOC_FILE_TOO_LARGE: 'DOC_FILE_TOO_LARGE',
  DOC_MIME_REJECTED: 'DOC_MIME_REJECTED',
  DOC_STORAGE_FAILURE: 'DOC_STORAGE_FAILURE',
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
