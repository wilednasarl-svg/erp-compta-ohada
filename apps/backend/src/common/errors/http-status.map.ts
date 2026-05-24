/**
 * Mapping from stable business error codes to HTTP status codes.
 *
 * This mapping is the **single source of truth** for the HTTP status
 * returned to clients. It is consumed by:
 *  - `AppException` (default `status` for a given `code`),
 *  - the global exception filter (BE-BOOT-06) to format the response,
 *  - the OpenAPI/error documentation (BE-DOC-01).
 *
 * The `Record<ErrorCode, number>` constraint guarantees at compile time
 * that every code declared in `error-codes.ts` has an explicit HTTP status
 * — a new code without a mapping fails to build.
 */

import { ERROR_CODES, type ErrorCode } from './error-codes';

export const ERROR_CODE_TO_HTTP_STATUS: Readonly<Record<ErrorCode, number>> = {
  // 401 — credentials missing / invalid / MFA required (auth not satisfied).
  [ERROR_CODES.AUTH_INVALID_CREDENTIALS]: 401,
  [ERROR_CODES.AUTH_INVALID_TOKEN]: 401,
  [ERROR_CODES.AUTH_MFA_REQUIRED]: 401,
  [ERROR_CODES.AUTH_MFA_INVALID_CODE]: 401,
  [ERROR_CODES.AUTH_MFA_NOT_ENROLLED]: 401,
  [ERROR_CODES.AUTH_REFRESH_REUSE]: 401,

  // 403 — caller is authenticated but not authorized.
  [ERROR_CODES.FORBIDDEN_ROLE]: 403,
  [ERROR_CODES.FORBIDDEN_PERMISSION]: 403,
  [ERROR_CODES.FORBIDDEN_NO_MEMBERSHIP]: 403,
  [ERROR_CODES.RBAC_NO_POLICY_DECLARED]: 403,
  [ERROR_CODES.RBAC_SYSTEM_ROLE_LOCKED]: 403,

  // 404 — fail-closed, also used by TenantGuard to avoid disclosure.
  [ERROR_CODES.ORG_NOT_FOUND]: 404,
  [ERROR_CODES.INVITATION_NOT_FOUND]: 404,
  [ERROR_CODES.CHART_ACCOUNT_NOT_FOUND]: 404,

  // 409 — state conflict (duplicate, invariant violation, already used).
  [ERROR_CODES.AUTH_EMAIL_TAKEN]: 409,
  [ERROR_CODES.AUTH_MFA_ALREADY_ENABLED]: 409,
  [ERROR_CODES.ORG_LAST_ADMIN]: 409,
  [ERROR_CODES.INVITATION_ALREADY_USED]: 409,
  [ERROR_CODES.INVITATION_ALREADY_PENDING]: 409,
  [ERROR_CODES.INVITATION_REVOKED]: 409,
  [ERROR_CODES.CHART_ACCOUNT_CODE_TAKEN]: 409,
  [ERROR_CODES.CHART_ACCOUNT_NOT_DELETABLE]: 409,

  // 410 — the targeted resource existed but is no longer usable.
  [ERROR_CODES.INVITATION_EXPIRED]: 410,

  // 422 — input rejected by validation (semantic, not syntactic).
  [ERROR_CODES.AUTH_WEAK_PASSWORD]: 422,
  [ERROR_CODES.ORG_NOTHING_TO_UPDATE]: 422,
  [ERROR_CODES.CHART_ACCOUNT_INVALID_PARENT]: 422,
  [ERROR_CODES.CHART_ACCOUNT_INVALID_CODE]: 422,
  [ERROR_CODES.CHART_ACCOUNT_IMMUTABLE_CODE]: 422,
  [ERROR_CODES.ACCOUNTING_SYSTEM_REQUIRED]: 422,
};

/**
 * Resolve the HTTP status associated with a business error code.
 *
 * Used by `AppException` and the global exception filter (BE-BOOT-06).
 */
export function getHttpStatusForCode(code: ErrorCode): number {
  return ERROR_CODE_TO_HTTP_STATUS[code];
}
