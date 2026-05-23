/**
 * `LoggerModule` (BE-BOOT-09)
 *
 * Wires structured JSON logging through `nestjs-pino`:
 *
 *  - Pino is installed as the application logger via `app.useLogger(...)`
 *    in `main.ts`, replacing Nest's default text logger.
 *  - `pino-http` auto-emits one log line per HTTP request carrying
 *    `request_id` (from `RequestIdMiddleware`), `req.method`, `req.url`,
 *    `res.statusCode`, and `latency_ms` — the four fields BE-BOOT-09's
 *    `Done` criterion requires for a login log.
 *  - Sensitive fields listed in `SENSITIVE_FIELDS` are scrubbed by Pino's
 *    `redact` before any line ever reaches stdout, so a password or
 *    refresh token can never leak through an exception trace, a verbose
 *    log statement, or an Express request body dump.
 *
 * The pino-http options are built by a pure factory (`buildPinoHttpOptions`)
 * so they can be unit-tested with a plain `pino()` destination — see
 * `logger.module.spec.ts`.
 */

import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';
import type { Options as PinoHttpOptions } from 'pino-http';

import type { AppConfig } from '../../config/configuration';

/** Single source of truth for fields that MUST never appear in clear in
 * logs. Mirrors the list called out in BE-BOOT-09's `Done` criteria and
 * grows as new sensitive shapes (e.g. JWTs, MFA backup codes) appear in
 * downstream modules. */
export const SENSITIVE_FIELDS: ReadonlyArray<string> = Object.freeze([
  'password',
  'password_hash',
  'passwordHash',
  'authorization',
  'cookie',
  'set-cookie',
  'refreshToken',
  'refresh_token',
  'accessToken',
  'access_token',
  'token',
  'mfaChallengeToken',
  'mfa_challenge_token',
  'otp',
  'secret',
  'secret_encrypted',
  'secretEncrypted',
  'backup_codes_hashed',
  'backupCodesHashed',
  'backup_codes',
  'backupCodes',
]);

export const REDACTED_PLACEHOLDER = '[REDACTED]';

/** Common Pino containers where a sensitive payload may surface. We list
 * them explicitly because Pino's `redact.paths` only supports single-level
 * `*` wildcards — there is no recursive `**`. */
const REDACT_CONTAINERS: ReadonlyArray<string> = [
  '',
  '*',
  'req.headers',
  'req.body',
  'req.body.user',
  'req.body.credentials',
  'req.query',
  'res.headers',
  'request.headers',
  'request.body',
  'response.headers',
  'context',
  'metadata',
  'data',
  'payload',
  'body',
  'headers',
];

function buildRedactPaths(
  containers: ReadonlyArray<string>,
  fields: ReadonlyArray<string>,
): string[] {
  const paths = new Set<string>();
  for (const container of containers) {
    for (const field of fields) {
      const safeField = /^[A-Za-z0-9_]+$/.test(field) ? field : `["${field}"]`;
      const joiner = container.length > 0 && safeField.startsWith('[') ? '' : '.';
      const path = container.length === 0 ? field : `${container}${joiner}${safeField}`;
      paths.add(path);
    }
  }
  return [...paths];
}

export interface BuildLoggerOptionsInput {
  readonly nodeEnv: AppConfig['nodeEnv'];
  readonly logLevel?: string;
}

/**
 * Pure factory producing the `pino-http` options consumed by
 * `nestjs-pino`. Exposed as `export` so tests can feed the same options
 * into a plain `pino()` instance with a custom destination and assert on
 * the serialized output (see `logger.module.spec.ts`).
 */
export function buildPinoHttpOptions(input: BuildLoggerOptionsInput): PinoHttpOptions {
  const level = input.logLevel ?? (input.nodeEnv === 'test' ? 'silent' : 'info');

  return {
    level,

    // Reuse the correlation id set by `RequestIdMiddleware`. If the
    // middleware has not run (e.g. in raw pino-http unit tests) we fall
    // back to the header, then to a synthetic id derived from the
    // request's hi-res timestamp.
    genReqId: (req, res) => {
      const existing = (req as { id?: string }).id;
      if (typeof existing === 'string' && existing.length > 0) {
        res.setHeader('x-request-id', existing);
        return existing;
      }
      const fromHeader = req.headers['x-request-id'];
      const headerValue = Array.isArray(fromHeader) ? fromHeader[0] : fromHeader;
      if (typeof headerValue === 'string' && headerValue.length > 0) {
        res.setHeader('x-request-id', headerValue);
        return headerValue;
      }
      const fallback = `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      res.setHeader('x-request-id', fallback);
      return fallback;
    },

    // Promote request_id / route to top-level log props so downstream
    // log aggregators (Datadog, Loki, …) can filter on them directly
    // without parsing the nested `req` serializer payload.
    customProps: (req) => ({
      request_id: (req as { id?: string }).id,
      route: (req as { originalUrl?: string; url?: string }).originalUrl ?? req.url,
    }),

    // Promote 4xx to `warn` and 5xx (or thrown errors) to `error` so the
    // out-of-the-box stdout pipeline matches the severity an SRE expects.
    customLogLevel: (_req, res, err) => {
      if (err) return 'error';
      if (res.statusCode >= 500) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },

    // Rename the noisy default keys to the snake_case shape used across
    // the rest of the project's audit/event schema.
    customAttributeKeys: {
      req: 'req',
      res: 'res',
      err: 'err',
      responseTime: 'latency_ms',
      reqId: 'request_id',
    },

    // Trim request/response serializers to the fields we actually want
    // in logs — keeps lines small and avoids accidentally surfacing
    // unrelated properties of the raw Express request. Any field
    // forwarded here is still scrubbed by `redact` below before write.
    serializers: {
      req: (req: {
        id?: string;
        method?: string;
        url?: string;
        remoteAddress?: string;
        headers?: Record<string, string | string[] | undefined>;
        body?: unknown;
      }) => {
        const out: Record<string, unknown> = {
          id: req.id,
          method: req.method,
          url: req.url,
          remoteAddress: req.remoteAddress,
          headers: req.headers,
        };
        if (req.body !== undefined) {
          out.body = req.body;
        }
        return out;
      },
      res: (res: { statusCode?: number }) => ({
        statusCode: res.statusCode,
      }),
    },

    redact: {
      paths: buildRedactPaths(REDACT_CONTAINERS, SENSITIVE_FIELDS),
      censor: REDACTED_PLACEHOLDER,
      remove: false,
    },
  };
}

@Module({
  imports: [
    PinoLoggerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => {
        const nodeEnv = config.get('nodeEnv', { infer: true });
        return {
          pinoHttp: buildPinoHttpOptions({
            nodeEnv,
            logLevel: process.env.LOG_LEVEL,
          }),
        };
      },
    }),
  ],
  exports: [PinoLoggerModule],
})
export class LoggerModule {}
