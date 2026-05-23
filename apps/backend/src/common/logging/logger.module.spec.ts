import { Writable } from 'node:stream';

import pino, { type DestinationStream } from 'pino';

import { buildPinoHttpOptions, REDACTED_PLACEHOLDER, SENSITIVE_FIELDS } from './logger.module';

/** Collects every line pino writes to its destination so tests can parse
 * them back as JSON objects. */
function buildCapturingDestination(): {
  destination: DestinationStream;
  lines: Array<Record<string, unknown>>;
} {
  const lines: Array<Record<string, unknown>> = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      const text = typeof chunk === 'string' ? chunk : (chunk as Buffer).toString('utf8');
      for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (trimmed.length === 0) continue;
        try {
          lines.push(JSON.parse(trimmed) as Record<string, unknown>);
        } catch {
          // pino-pretty / non-JSON output — not expected here, ignore.
        }
      }
      cb();
    },
  });
  return { destination: stream as unknown as DestinationStream, lines };
}

describe('LoggerModule (BE-BOOT-09)', () => {
  it('declares every sensitive field listed in the Done criteria', () => {
    // BE-BOOT-09 explicitly calls out these field names.
    const required = [
      'password',
      'password_hash',
      'authorization',
      'refreshToken',
      'secret_encrypted',
      'backup_codes_hashed',
    ];
    for (const field of required) {
      expect(SENSITIVE_FIELDS).toContain(field);
    }
  });

  describe('buildPinoHttpOptions redaction', () => {
    it('redacts a top-level password field', () => {
      const { destination, lines } = buildCapturingDestination();
      const opts = buildPinoHttpOptions({ nodeEnv: 'test', logLevel: 'info' });
      const logger = pino(opts, destination);

      logger.info({ password: 'super-secret', email: 'alice@example.com' }, 'login attempt');

      expect(lines).toHaveLength(1);
      expect(lines[0].password).toBe(REDACTED_PLACEHOLDER);
      expect(lines[0].email).toBe('alice@example.com');
    });

    it('redacts sensitive fields nested inside common containers', () => {
      const { destination, lines } = buildCapturingDestination();
      const opts = buildPinoHttpOptions({ nodeEnv: 'test', logLevel: 'info' });
      const logger = pino(opts, destination);

      logger.info(
        {
          req: {
            method: 'POST',
            url: '/auth/login',
            headers: { authorization: 'Bearer leak-me', 'user-agent': 'jest' },
            body: { email: 'alice@example.com', password: 'plaintext-pw' },
          },
          res: { statusCode: 200 },
          data: {
            refreshToken: 'rt-leak',
            secret_encrypted: 'enc-leak',
            backup_codes_hashed: ['h1', 'h2'],
            password_hash: '$argon2id$...',
          },
        },
        'login success',
      );

      const log = lines[0];
      const req = log.req as Record<string, unknown>;
      const reqHeaders = req.headers as Record<string, unknown>;
      const reqBody = req.body as Record<string, unknown>;
      const data = log.data as Record<string, unknown>;

      expect(reqHeaders.authorization).toBe(REDACTED_PLACEHOLDER);
      expect(reqHeaders['user-agent']).toBe('jest');
      expect(reqBody.password).toBe(REDACTED_PLACEHOLDER);
      expect(reqBody.email).toBe('alice@example.com');
      expect(data.refreshToken).toBe(REDACTED_PLACEHOLDER);
      expect(data.secret_encrypted).toBe(REDACTED_PLACEHOLDER);
      expect(data.backup_codes_hashed).toBe(REDACTED_PLACEHOLDER);
      expect(data.password_hash).toBe(REDACTED_PLACEHOLDER);
    });

    it('never lets a plaintext password leak even when serialized verbatim', () => {
      const { destination, lines } = buildCapturingDestination();
      const opts = buildPinoHttpOptions({ nodeEnv: 'test', logLevel: 'info' });
      const logger = pino(opts, destination);

      logger.info({ req: { body: { password: 'plaintext-pw' } } }, 'never log this in clear');

      const serialized = JSON.stringify(lines[0]);
      expect(serialized).not.toContain('plaintext-pw');
      expect(serialized).toContain(REDACTED_PLACEHOLDER);
    });

    it('renames responseTime to latency_ms and reqId to request_id', () => {
      const opts = buildPinoHttpOptions({ nodeEnv: 'test', logLevel: 'info' });
      expect(opts.customAttributeKeys).toMatchObject({
        responseTime: 'latency_ms',
        reqId: 'request_id',
      });
    });

    it('defaults to silent in test env when no explicit level is given', () => {
      const opts = buildPinoHttpOptions({ nodeEnv: 'test' });
      expect(opts.level).toBe('silent');
    });

    it('defaults to info in non-test envs', () => {
      const opts = buildPinoHttpOptions({ nodeEnv: 'production' });
      expect(opts.level).toBe('info');
    });
  });
});
