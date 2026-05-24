/**
 * Env validation — Zod-based.
 *
 * Choix de Zod plutôt que class-validator :
 *  - inférence TypeScript native (pas besoin de DTO miroir),
 *  - refinements concis (regex, base64 32 bytes, transforms boolean),
 *  - pas de métadonnées de décorateurs à activer côté CLI/scripts,
 *  - cohérent avec la convention projet pour la validation de données
 *    (cf. `rules/typescript/coding-style.md` → "Use Zod for schema-based validation").
 *
 * Toute variable manquante ou invalide doit faire échouer le boot via
 * `EnvValidationError`, avec la liste complète des champs fautifs.
 */

import { z } from 'zod';

const TTL_PATTERN = /^\d+(?:ms|s|m|h|d|w|y)?$/i;

const booleanFromEnv = z.union([z.boolean(), z.string()]).transform((value, ctx) => {
  if (typeof value === 'boolean') {
    return value;
  }

  const normalized = value.trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['false', '0', 'no', 'off'].includes(normalized)) {
    return false;
  }

  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    message: 'must be a boolean (true/false/1/0/yes/no)',
  });
  return z.NEVER;
});

const base64Bytes = (expectedBytes: number) =>
  z
    .string()
    .min(1, 'is required')
    .refine((value) => {
      try {
        return Buffer.from(value, 'base64').length === expectedBytes;
      } catch {
        return false;
      }
    }, `must be a base64-encoded value of exactly ${expectedBytes} bytes`);

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),

  DATABASE_URL: z.string().url('must be a valid URL'),
  DB_SSL: booleanFromEnv.default(false),
  DB_SCHEMA: z.string().default('public'),

  JWT_SECRET: z.string().min(32, 'must be at least 32 characters long'),
  JWT_ACCESS_TTL: z
    .string()
    .regex(TTL_PATTERN, 'must match a duration (e.g. 15m, 1h, 900)')
    .default('15m'),
  JWT_REFRESH_TTL: z
    .string()
    .regex(TTL_PATTERN, 'must match a duration (e.g. 7d, 1w, 604800)')
    .default('7d'),

  MFA_ENCRYPTION_KEY: base64Bytes(32),

  SMTP_HOST: z.string().min(1, 'is required'),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535),
  SMTP_USER: z.string().min(1, 'is required'),
  SMTP_PASS: z.string().min(1, 'is required'),
  SMTP_FROM: z.string().email('must be a valid email address'),

  APP_BASE_URL: z.string().url('must be a valid URL'),

  EMAIL_DRY_RUN: booleanFromEnv,

  // Module 3 — Import engine.
  IMPORT_STORAGE_DIR: z.string().min(1).default('./uploads'),
  IMPORT_MAX_FILE_SIZE_MB: z.coerce.number().int().min(1).max(500).default(25),

  // Module 10 — Document engine (vague 1).
  // Default driver writes to the local filesystem rooted at
  // `DOC_STORAGE_DIR`; storage keys are content-addressed
  // (`<orgId>/<yyyy>/<mm>/<sha256>.<ext>`) so a future S3/Supabase
  // adapter can keep the same key shape and migrate by rsync.
  DOC_STORAGE_DIR: z.string().min(1).default('./uploads/documents'),
  DOC_MAX_FILE_SIZE_MB: z.coerce.number().int().min(1).max(500).default(50),
});

export type ValidatedEnv = z.infer<typeof envSchema>;

export interface EnvIssue {
  readonly path: string;
  readonly message: string;
}

export class EnvValidationError extends Error {
  public readonly issues: ReadonlyArray<EnvIssue>;

  constructor(issues: ReadonlyArray<EnvIssue>) {
    const formatted = issues.map((issue) => `  - ${issue.path}: ${issue.message}`).join('\n');
    super(
      `Invalid environment variables:\n${formatted}\n\nFix the above before starting the application.`,
    );
    this.name = 'EnvValidationError';
    this.issues = issues;
  }
}

/**
 * Validate a raw env-like record (typically `process.env`).
 *
 * @throws EnvValidationError when one or more variables are missing or invalid.
 */
export function validateEnv(rawEnv: Record<string, unknown>): ValidatedEnv {
  const result = envSchema.safeParse(rawEnv);
  if (!result.success) {
    const issues: EnvIssue[] = result.error.issues.map((issue) => ({
      path: issue.path.length > 0 ? issue.path.join('.') : '(root)',
      message: issue.message,
    }));
    throw new EnvValidationError(issues);
  }
  return result.data;
}
