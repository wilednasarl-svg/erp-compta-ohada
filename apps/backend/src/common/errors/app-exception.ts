/**
 * `AppException` — application-level exception carrying a stable business
 * error `code` and the HTTP `status` derived from `http-status.map.ts`.
 *
 * Services and controllers should throw `AppException` (never raw `Error`
 * or framework-specific exceptions) so the global exception filter
 * (BE-BOOT-06) can serialize a normalized envelope:
 *
 *   { data: null, error: { code, message, details? } }
 *
 * Ergonomics:
 *   throw new AppException(ERROR_CODES.AUTH_INVALID_CREDENTIALS);
 *   throw new AppException(ERROR_CODES.AUTH_WEAK_PASSWORD, {
 *     message: 'Password must be at least 12 characters',
 *     details: { field: 'password' },
 *   });
 *   throw new AppException(ERROR_CODES.ORG_NOT_FOUND, { cause: dbError });
 */

import type { ErrorCode } from './error-codes';
import { getHttpStatusForCode } from './http-status.map';

/**
 * Free-form, JSON-serializable payload attached to an `AppException`.
 *
 * Kept as a `Record<string, unknown>` (not `any`) so callers must narrow
 * the value before use, and the global filter can serialize it as-is.
 */
export type AppExceptionDetails = Readonly<Record<string, unknown>>;

export interface AppExceptionOptions {
  /**
   * Human-readable message. Defaults to the `code` itself so logs and
   * default responses remain greppable when no override is provided.
   */
  readonly message?: string;
  /**
   * Optional structured payload (e.g. validation field, conflicting id).
   * Forwarded as-is to the error envelope by the global filter.
   */
  readonly details?: AppExceptionDetails;
  /**
   * Underlying cause (DB error, library exception, …). Preserved on the
   * standard `Error.cause` slot so stacktraces remain navigable.
   */
  readonly cause?: unknown;
}

export class AppException extends Error {
  public readonly code: ErrorCode;
  public readonly status: number;
  public readonly details?: AppExceptionDetails;

  constructor(code: ErrorCode, options: AppExceptionOptions = {}) {
    super(options.message ?? code);

    this.name = 'AppException';
    this.code = code;
    this.status = getHttpStatusForCode(code);

    if (options.details !== undefined) {
      this.details = options.details;
    }

    if (options.cause !== undefined) {
      // `cause` is part of the standard `Error` shape (ES2022) but the
      // TypeScript lib types don't always expose it; assign explicitly so
      // logging libraries (pino) and the global filter can pick it up.
      (this as Error & { cause?: unknown }).cause = options.cause;
    }

    // Preserve prototype chain when transpiling to ES5/CommonJS so
    // `err instanceof AppException` keeps working across module boundaries.
    Object.setPrototypeOf(this, new.target.prototype);
  }

  /**
   * Type guard usable inside catch blocks where the caught value is
   * typed as `unknown`.
   */
  static isAppException(value: unknown): value is AppException {
    return value instanceof AppException;
  }
}
