import { validateEnv, type ValidatedEnv } from './env.validation';

export interface AppConfig {
  nodeEnv: ValidatedEnv['NODE_ENV'];
  port: number;
  appBaseUrl: string;
  database: {
    url: string;
    ssl: boolean;
    schema: string;
  };
  jwt: {
    secret: string;
    accessTtl: string;
    refreshTtl: string;
  };
  mfa: {
    encryptionKey: string;
  };
  smtp: {
    host: string;
    port: number;
    user: string;
    pass: string;
    from: string;
  };
  email: {
    dryRun: boolean;
  };
  imports: {
    storageDir: string;
    maxFileSizeBytes: number;
  };
  documents: {
    storageDir: string;
    maxFileSizeBytes: number;
    storageDriver: 'local' | 'supabase';
    supabaseUrl?: string;
    supabaseServiceRoleKey?: string;
    supabaseStorageBucket: string;
  };
}

/**
 * Factory consumed by `ConfigModule.forRoot({ load: [configuration] })`.
 *
 * Validates `process.env` and exposes a typed, structured config object that
 * downstream modules can read via `ConfigService.get<AppConfig['…']>(…)`.
 *
 * Throws `EnvValidationError` (fail-fast) when env vars are missing/invalid.
 */
export function configuration(): AppConfig {
  const env = validateEnv(process.env);

  return {
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    appBaseUrl: env.APP_BASE_URL,
    database: {
      url: env.DATABASE_URL,
      ssl: env.DB_SSL,
      schema: env.DB_SCHEMA,
    },
    jwt: {
      secret: env.JWT_SECRET,
      accessTtl: env.JWT_ACCESS_TTL,
      refreshTtl: env.JWT_REFRESH_TTL,
    },
    mfa: {
      encryptionKey: env.MFA_ENCRYPTION_KEY,
    },
    smtp: {
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      user: env.SMTP_USER,
      pass: env.SMTP_PASS,
      from: env.SMTP_FROM,
    },
    email: {
      dryRun: env.EMAIL_DRY_RUN,
    },
    imports: {
      storageDir: env.IMPORT_STORAGE_DIR,
      maxFileSizeBytes: env.IMPORT_MAX_FILE_SIZE_MB * 1024 * 1024,
    },
    documents: {
      storageDir: env.DOC_STORAGE_DIR,
      maxFileSizeBytes: env.DOC_MAX_FILE_SIZE_MB * 1024 * 1024,
      storageDriver: env.DOC_STORAGE_DRIVER,
      supabaseUrl: env.SUPABASE_URL,
      supabaseServiceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
      supabaseStorageBucket: env.SUPABASE_STORAGE_BUCKET,
    },
  };
}
