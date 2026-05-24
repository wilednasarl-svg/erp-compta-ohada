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
      AUTH_INVALID_TOKEN: 401,
      AUTH_EMAIL_TAKEN: 409,
      AUTH_WEAK_PASSWORD: 422,
      AUTH_MFA_REQUIRED: 401,
      AUTH_MFA_INVALID_CODE: 401,
      AUTH_MFA_NOT_ENROLLED: 401,
      AUTH_MFA_ALREADY_ENABLED: 409,
      AUTH_REFRESH_REUSE: 401,
      ORG_NOT_FOUND: 404,
      ORG_LAST_ADMIN: 409,
      ORG_NOTHING_TO_UPDATE: 422,
      FORBIDDEN_ROLE: 403,
      FORBIDDEN_PERMISSION: 403,
      FORBIDDEN_NO_MEMBERSHIP: 403,
      INVITATION_EXPIRED: 410,
      INVITATION_ALREADY_USED: 409,
      INVITATION_ALREADY_PENDING: 409,
      INVITATION_NOT_FOUND: 404,
      INVITATION_REVOKED: 409,
      RBAC_NO_POLICY_DECLARED: 403,
      RBAC_SYSTEM_ROLE_LOCKED: 403,
      // Module 2 — chart of accounts catalogue.
      CHART_ACCOUNT_NOT_FOUND: 404,
      CHART_ACCOUNT_CODE_TAKEN: 409,
      CHART_ACCOUNT_NOT_DELETABLE: 409,
      CHART_ACCOUNT_INVALID_PARENT: 422,
      CHART_ACCOUNT_INVALID_CODE: 422,
      CHART_ACCOUNT_IMMUTABLE_CODE: 422,
      ACCOUNTING_SYSTEM_REQUIRED: 422,
      // Module 3 — imports & documents (in flight).
      IMPORT_SESSION_NOT_FOUND: 404,
      IMPORT_SESSION_NOT_DRAFT: 409,
      IMPORT_SESSION_NOT_PARSED: 409,
      IMPORT_SESSION_NOT_VALID: 409,
      IMPORT_FILE_NOT_FOUND: 404,
      IMPORT_FILE_TOO_LARGE: 413,
      IMPORT_FILE_DUPLICATE: 409,
      IMPORT_UNSUPPORTED_FORMAT: 422,
      IMPORT_FILE_PARSE_FAILED: 422,
      IMPORT_COMMIT_UNBALANCED_GROUP: 422,
      IMPORT_COMMIT_FAILED: 500,
      // Module 8 wave 2 — lettering.
      LETTERING_NOT_FOUND: 404,
      LETTERING_LINES_REQUIRED: 422,
      LETTERING_UNBALANCED: 422,
      LETTERING_MIXED_ACCOUNTS: 422,
      LETTERING_LINE_ALREADY_USED: 409,
      LETTERING_NOT_PARTNER_ACCOUNT: 422,
      LETTERING_LINE_NOT_VALIDATED: 422,
      LETTERING_ALREADY_BROKEN: 409,
      // Module 9 — Financial reports.
      REPORT_INVALID_DATE_RANGE: 422,
      DOC_NOT_FOUND: 404,
      DOC_FILE_REQUIRED: 422,
      DOC_FILE_TOO_LARGE: 413,
      DOC_MIME_REJECTED: 422,
      DOC_STORAGE_FAILURE: 500,
      // Module 3 — transformations.
      TRANSFORMATION_SOURCE_ENTRY_NOT_FOUND: 404,
      TRANSFORMATION_NO_FIELD_CHANGED: 422,
      TRANSFORMATION_ADJUSTMENT_INVALID: 422,
      // Module 5 — Rule Engine.
      RULE_NOT_FOUND: 404,
      RULE_INVALID_CONDITION: 422,
      RULE_INVALID_ACTION: 422,
      // Module 4 — Journals / Entries.
      JOURNAL_NOT_FOUND: 404,
      JOURNAL_CODE_TAKEN: 409,
      JOURNAL_ENTRY_NOT_FOUND: 404,
      JOURNAL_ENTRY_UNBALANCED: 422,
      JOURNAL_ENTRY_EMPTY_LINES: 422,
      JOURNAL_ENTRY_NON_POSTING_ACCOUNT: 422,
      JOURNAL_ENTRY_INVALID_LINE: 422,
      JOURNAL_ENTRY_IMMUTABLE: 409,
      JOURNAL_ENTRY_ALREADY_CANCELLED: 409,
      ACCOUNTING_PERIOD_NOT_FOUND: 404,
      ACCOUNTING_PERIOD_CLOSED: 409,
      ACCOUNTING_PERIOD_HAS_DRAFTS: 409,
      ACCOUNTING_PERIOD_REOPEN_REASON_REQUIRED: 422,
      ACCOUNTING_PERIOD_OVERLAPS: 409,
      // Workflow.
      WORKFLOW_INSTANCE_NOT_FOUND: 404,
      WORKFLOW_TRANSITION_INVALID: 409,
      WORKFLOW_LOCKED: 409,
      // TVA
      TVA_CODE_NOT_FOUND: 404,
      TVA_CODE_TAKEN: 409,
      TVA_DECLARATION_NOT_FOUND: 404,
      TVA_DECLARATION_ALREADY_EXISTS: 409,
      TVA_DECLARATION_INVALID_PERIOD: 422,
      TVA_DECLARATION_NOT_CALCULATED: 409,
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
