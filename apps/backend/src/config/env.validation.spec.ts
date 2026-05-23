import { EnvValidationError, validateEnv } from './env.validation';

const VALID_BASE64_32_BYTES = Buffer.alloc(32, 1).toString('base64');

function baseEnv(): Record<string, string> {
  return {
    NODE_ENV: 'test',
    PORT: '3001',
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
    JWT_SECRET: 'a'.repeat(32),
    JWT_ACCESS_TTL: '15m',
    JWT_REFRESH_TTL: '7d',
    MFA_ENCRYPTION_KEY: VALID_BASE64_32_BYTES,
    SMTP_HOST: 'smtp.example.com',
    SMTP_PORT: '587',
    SMTP_USER: 'mailer',
    SMTP_PASS: 'super-secret',
    SMTP_FROM: 'no-reply@example.com',
    APP_BASE_URL: 'http://localhost:3001',
    EMAIL_DRY_RUN: 'true',
  };
}

describe('validateEnv', () => {
  describe('success cases', () => {
    it('parses a fully valid env object and coerces numeric/boolean fields', () => {
      const env = validateEnv(baseEnv());

      expect(env.NODE_ENV).toBe('test');
      expect(env.PORT).toBe(3001);
      expect(env.SMTP_PORT).toBe(587);
      expect(env.EMAIL_DRY_RUN).toBe(true);
      expect(env.MFA_ENCRYPTION_KEY).toBe(VALID_BASE64_32_BYTES);
    });

    it('applies defaults for NODE_ENV, PORT and TTLs', () => {
      const raw: Record<string, string | undefined> = baseEnv();
      delete raw.NODE_ENV;
      delete raw.PORT;
      delete raw.JWT_ACCESS_TTL;
      delete raw.JWT_REFRESH_TTL;

      const env = validateEnv(raw as Record<string, unknown>);

      expect(env.NODE_ENV).toBe('development');
      expect(env.PORT).toBe(3001);
      expect(env.JWT_ACCESS_TTL).toBe('15m');
      expect(env.JWT_REFRESH_TTL).toBe('7d');
    });

    it.each([
      ['true', true],
      ['false', false],
      ['1', true],
      ['0', false],
      ['YES', true],
      ['No', false],
      ['  on  ', true],
    ])('coerces EMAIL_DRY_RUN="%s" to %s', (input, expected) => {
      const env = validateEnv({ ...baseEnv(), EMAIL_DRY_RUN: input });
      expect(env.EMAIL_DRY_RUN).toBe(expected);
    });
  });

  describe('failure cases', () => {
    it('throws EnvValidationError when DATABASE_URL is missing', () => {
      const raw: Record<string, string | undefined> = baseEnv();
      delete raw.DATABASE_URL;

      expect(() => validateEnv(raw as Record<string, unknown>)).toThrow(EnvValidationError);
    });

    it('lists every invalid field in a single error message', () => {
      const raw = {
        ...baseEnv(),
        JWT_SECRET: 'too-short',
        APP_BASE_URL: 'not a url',
        SMTP_FROM: 'not-an-email',
      };

      let caught: unknown;
      try {
        validateEnv(raw);
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(EnvValidationError);
      const err = caught as EnvValidationError;
      const paths = err.issues.map((issue) => issue.path);
      expect(paths).toEqual(expect.arrayContaining(['JWT_SECRET', 'APP_BASE_URL', 'SMTP_FROM']));
      expect(err.message).toContain('JWT_SECRET');
      expect(err.message).toContain('APP_BASE_URL');
      expect(err.message).toContain('SMTP_FROM');
    });

    it('rejects JWT_SECRET shorter than 32 characters', () => {
      const raw = { ...baseEnv(), JWT_SECRET: 'a'.repeat(31) };
      expect(() => validateEnv(raw)).toThrow(/at least 32/);
    });

    it('rejects MFA_ENCRYPTION_KEY not decoding to 32 bytes', () => {
      const raw = {
        ...baseEnv(),
        MFA_ENCRYPTION_KEY: Buffer.alloc(16, 1).toString('base64'),
      };
      expect(() => validateEnv(raw)).toThrow(/MFA_ENCRYPTION_KEY/);
    });

    it('rejects MFA_ENCRYPTION_KEY when missing', () => {
      const raw: Record<string, string | undefined> = baseEnv();
      delete raw.MFA_ENCRYPTION_KEY;
      expect(() => validateEnv(raw as Record<string, unknown>)).toThrow(/MFA_ENCRYPTION_KEY/);
    });

    it('rejects invalid TTL format', () => {
      const raw = { ...baseEnv(), JWT_ACCESS_TTL: '15 minutes' };
      expect(() => validateEnv(raw)).toThrow(/JWT_ACCESS_TTL/);
    });

    it('rejects PORT out of range', () => {
      const raw = { ...baseEnv(), PORT: '70000' };
      expect(() => validateEnv(raw)).toThrow(/PORT/);
    });

    it('rejects SMTP_PORT that is not a number', () => {
      const raw = { ...baseEnv(), SMTP_PORT: 'not-a-port' };
      expect(() => validateEnv(raw)).toThrow(/SMTP_PORT/);
    });

    it('rejects non-boolean EMAIL_DRY_RUN', () => {
      const raw = { ...baseEnv(), EMAIL_DRY_RUN: 'maybe' };
      expect(() => validateEnv(raw)).toThrow(/EMAIL_DRY_RUN/);
    });

    it('rejects unknown NODE_ENV value', () => {
      const raw = { ...baseEnv(), NODE_ENV: 'qa' };
      expect(() => validateEnv(raw)).toThrow(/NODE_ENV/);
    });
  });

  describe('boundary values', () => {
    it('accepts JWT_SECRET of exactly 32 characters', () => {
      const env = validateEnv({ ...baseEnv(), JWT_SECRET: 'a'.repeat(32) });
      expect(env.JWT_SECRET).toHaveLength(32);
    });

    it('accepts numeric TTL (raw seconds)', () => {
      const env = validateEnv({
        ...baseEnv(),
        JWT_ACCESS_TTL: '900',
        JWT_REFRESH_TTL: '604800',
      });
      expect(env.JWT_ACCESS_TTL).toBe('900');
      expect(env.JWT_REFRESH_TTL).toBe('604800');
    });

    it('accepts PORT=1 (lower bound) and PORT=65535 (upper bound)', () => {
      expect(validateEnv({ ...baseEnv(), PORT: '1' }).PORT).toBe(1);
      expect(validateEnv({ ...baseEnv(), PORT: '65535' }).PORT).toBe(65535);
    });

    it('rejects PORT=0 (below lower bound)', () => {
      expect(() => validateEnv({ ...baseEnv(), PORT: '0' })).toThrow(/PORT/);
    });
  });
});
