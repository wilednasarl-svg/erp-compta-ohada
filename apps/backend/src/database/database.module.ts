import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule, type TypeOrmModuleOptions } from '@nestjs/typeorm';

import type { AppConfig } from '../config/configuration';
import { buildPgUrl } from './db-url';

/**
 * DatabaseModule — PostgreSQL via TypeORM (Supabase-compatible).
 *
 * - Connection options are derived from the validated config (see
 *   `src/config/env.validation.ts`). `DATABASE_URL` carries the DSN and
 *   `DB_SSL` toggles TLS, which is mandatory for Supabase Direct/Pooler
 *   endpoints but typically off for a local Postgres in dev.
 * - Migrations are NEVER run at boot (`migrationsRun: false`) — they are
 *   executed explicitly via `pnpm --filter backend migration:run`,
 *   wired through `src/database/data-source.ts`.
 * - Entities are auto-loaded as feature modules register them with
 *   `TypeOrmModule.forFeature([...])`.
 */
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>): TypeOrmModuleOptions => {
        const database = config.get('database', { infer: true });

        return {
          type: 'postgres',
          // `buildPgUrl` strips `sslmode` from the URL when DB_SSL=true
          // so pg-connection-string v3's strict alias resolution doesn't
          // override our `ssl: { rejectUnauthorized: false }` option
          // (Supabase pooler uses a self-signed root cert).
          url: buildPgUrl(database.url, database.ssl),
          ssl: database.ssl ? { rejectUnauthorized: false } : false,
          schema: database.schema,
          extra: {
            options: `-c search_path=${database.schema},public`,
          },
          autoLoadEntities: true,
          synchronize: false,
          migrationsRun: false,
          migrationsTableName: 'typeorm_migrations',
          logging: ['error', 'warn', 'migration'],
          // Conservative retry policy to avoid triggering Supabase Supavisor
          // circuit breaker on misconfigured credentials. Default is 10 retries
          // every 3s — on an auth failure that's 30 quick failed logins per
          // boot, enough to lock the project out of the pooler for ~10 min.
          retryAttempts: 2,
          retryDelay: 5000,
        };
      },
    }),
  ],
  exports: [TypeOrmModule],
})
export class DatabaseModule {}
