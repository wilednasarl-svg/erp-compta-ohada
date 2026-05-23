import { AppException } from './app-exception';
import { ALL_ERROR_CODES, ERROR_CODES, isErrorCode } from './error-codes';
import { ERROR_CODE_TO_HTTP_STATUS, getHttpStatusForCode } from './http-status.map';

describe('AppException', () => {
  describe('AUTH_INVALID_CREDENTIALS', () => {
    it('maps to HTTP 401', () => {
      const err = new AppException(ERROR_CODES.AUTH_INVALID_CREDENTIALS);

      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(AppException);
      expect(err.code).toBe('AUTH_INVALID_CREDENTIALS');
      expect(err.status).toBe(401);
    });

    it('uses the code as default message when none is provided', () => {
      const err = new AppException(ERROR_CODES.AUTH_INVALID_CREDENTIALS);
      expect(err.message).toBe('AUTH_INVALID_CREDENTIALS');
    });

    it('allows overriding the message without changing code or status', () => {
      const err = new AppException(ERROR_CODES.AUTH_INVALID_CREDENTIALS, {
        message: 'Invalid email or password',
      });

      expect(err.message).toBe('Invalid email or password');
      expect(err.code).toBe('AUTH_INVALID_CREDENTIALS');
      expect(err.status).toBe(401);
    });
  });

  describe('structure', () => {
    it('exposes details when provided', () => {
      const err = new AppException(ERROR_CODES.AUTH_WEAK_PASSWORD, {
        details: { field: 'password', minLength: 12 },
      });

      expect(err.status).toBe(422);
      expect(err.details).toEqual({ field: 'password', minLength: 12 });
    });

    it('omits details when none provided', () => {
      const err = new AppException(ERROR_CODES.ORG_NOT_FOUND);
      expect(err.details).toBeUndefined();
    });

    it('preserves the underlying cause', () => {
      const cause = new Error('connect ECONNREFUSED');
      const err = new AppException(ERROR_CODES.ORG_NOT_FOUND, { cause });

      expect((err as Error & { cause?: unknown }).cause).toBe(cause);
    });

    it('has name "AppException"', () => {
      const err = new AppException(ERROR_CODES.ORG_LAST_ADMIN);
      expect(err.name).toBe('AppException');
    });

    it('produces a usable stack trace', () => {
      const err = new AppException(ERROR_CODES.ORG_LAST_ADMIN);
      expect(typeof err.stack).toBe('string');
      expect(err.stack).toContain('AppException');
    });
  });

  describe('isAppException', () => {
    it('returns true for AppException instances', () => {
      const err = new AppException(ERROR_CODES.FORBIDDEN_PERMISSION);
      expect(AppException.isAppException(err)).toBe(true);
    });

    it('returns false for other values', () => {
      expect(AppException.isAppException(new Error('boom'))).toBe(false);
      expect(AppException.isAppException(null)).toBe(false);
      expect(AppException.isAppException('AUTH_INVALID_CREDENTIALS')).toBe(false);
      expect(AppException.isAppException({ code: 'AUTH_INVALID_CREDENTIALS' })).toBe(false);
    });
  });
});

describe('HTTP status mapping', () => {
  it('matches the expected per-code statuses', () => {
    const expected: Record<keyof typeof ERROR_CODES, number> = {
      AUTH_INVALID_CREDENTIALS: 401,
      AUTH_EMAIL_TAKEN: 409,
      AUTH_WEAK_PASSWORD: 422,
      AUTH_MFA_REQUIRED: 401,
      AUTH_MFA_INVALID_CODE: 401,
      AUTH_REFRESH_REUSE: 401,
      ORG_NOT_FOUND: 404,
      ORG_LAST_ADMIN: 409,
      FORBIDDEN_ROLE: 403,
      FORBIDDEN_PERMISSION: 403,
      FORBIDDEN_NO_MEMBERSHIP: 403,
      INVITATION_EXPIRED: 410,
      INVITATION_ALREADY_USED: 409,
      INVITATION_ALREADY_PENDING: 409,
      RBAC_NO_POLICY_DECLARED: 403,
      RBAC_SYSTEM_ROLE_LOCKED: 403,
    };

    for (const key of Object.keys(expected) as Array<keyof typeof ERROR_CODES>) {
      const code = ERROR_CODES[key];
      expect(getHttpStatusForCode(code)).toBe(expected[key]);
      expect(new AppException(code).status).toBe(expected[key]);
    }
  });

  it('has an entry for every declared error code', () => {
    for (const code of ALL_ERROR_CODES) {
      expect(ERROR_CODE_TO_HTTP_STATUS[code]).toBeDefined();
    }
  });
});

describe('isErrorCode', () => {
  it('accepts known codes', () => {
    expect(isErrorCode('AUTH_INVALID_CREDENTIALS')).toBe(true);
    expect(isErrorCode(ERROR_CODES.ORG_NOT_FOUND)).toBe(true);
  });

  it('rejects unknown values', () => {
    expect(isErrorCode('UNKNOWN_CODE')).toBe(false);
    expect(isErrorCode(123)).toBe(false);
    expect(isErrorCode(undefined)).toBe(false);
    expect(isErrorCode(null)).toBe(false);
  });
});
