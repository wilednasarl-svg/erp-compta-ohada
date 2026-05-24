/**
 * Standalone TypeORM `DataSource` used by the CLI (migration:generate / run /
 * revert). It re-uses the same Zod-validated env as the Nest runtime so a
 * misconfigured environment cannot silently mutate the schema.
 *
 * NOTE: this file is NOT imported by the Nest application — `DatabaseModule`
 * builds its own `TypeOrmModuleOptions` via `ConfigService`. Keep both in sync
 * (entities glob, migrations table name, SSL handling).
 */
import 'reflect-metadata';
import { config as loadDotenv } from 'dotenv';
import { DataSource, type DataSourceOptions } from 'typeorm';

import { validateEnv } from '../config/env.validation';
import { buildPgUrl } from './db-url';

// Load `.env` from the CWD (typically `apps/backend/`) for CLI invocations.
// `override: false` keeps already-exported env vars (e.g. CI secrets) winning.
loadDotenv({ override: false });

const env = validateEnv(process.env);

export const dataSourceOptions: DataSourceOptions = {
  type: 'postgres',
  url: buildPgUrl(env.DATABASE_URL, env.DB_SSL),
  ssl: env.DB_SSL ? { rejectUnauthorized: false } : false,
  schema: env.DB_SCHEMA,
  extra: {
    options: `-c search_path=${env.DB_SCHEMA},public`,
  },
  entities: [`${__dirname}/../**/*.entity.{ts,js}`],
  migrations: [`${__dirname}/migrations/*.{ts,js}`],
  migrationsTableName: 'typeorm_migrations',
  migrationsRun: false,
  synchronize: false,
  logging: env.NODE_ENV === 'development' ? ['error', 'warn', 'migration'] : ['error'],
};

// TypeORM v0.3.30 CLI requires EXACTLY ONE `DataSource` export per
// data-source file — having both a named (`AppDataSource`) and a
// `default` export of the same instance trips the v0.3.30 stricter
// loader with "Given data source file must contain only one export of
// DataSource instance". The CLI happily picks up a single named
// export, so we drop the default.
export const AppDataSource = new DataSource(dataSourceOptions);
