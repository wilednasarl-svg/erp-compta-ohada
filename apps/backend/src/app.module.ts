import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';

import { LoggerModule } from './common/logging/logger.module';
import { RequestContextMiddleware } from './common/middleware/request-context.middleware';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { configuration } from './config/configuration';
import { DatabaseModule } from './database/database.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard';
import { HealthModule } from './modules/health/health.module';
import { OrganizationsModule } from './modules/organizations/organizations.module';
import { RbacModule } from './modules/rbac/rbac.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      load: [configuration],
    }),
    // LoggerModule registers `pino-http` as a global Express middleware.
    // It MUST be imported AFTER ConfigModule (it consumes ConfigService)
    // and we apply `RequestIdMiddleware` first in `configure()` so the
    // logger picks up `req.id` from a stable correlation id.
    LoggerModule,
    DatabaseModule,
    HealthModule,
    // Module 1 feature modules. They each register their entities with
    // `TypeOrmModule.forFeature([...])` and expose typed repositories that
    // enforce the multi-tenant invariant (BE-DB-11).
    OrganizationsModule,
    AuthModule,
    RbacModule,
    AuditModule,
  ],
  controllers: [],
  providers: [
    // BE-RBAC-06 — deny-by-default authentication. `JwtAuthGuard` is
    // registered as an `APP_GUARD` so EVERY request must carry a valid
    // Bearer access token unless the handler is annotated `@Public()`
    // (signup, login, refresh, accept-invitation, mfa/verify-challenge).
    // `TenantGuard`, `PermissionsGuard`, `RolesGuard` stay opt-in via
    // per-controller `@UseGuards` — they need a tenant scope which
    // public/onboarding routes don't have, and mounting them globally
    // would force every route to opt out via a third decorator.
    //
    // `useExisting` re-uses the singleton instance registered by
    // `AuthModule.providers`, so it shares the same `JwtTokenService`
    // injection without re-wiring the dependency graph.
    { provide: APP_GUARD, useExisting: JwtAuthGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Order matters: `RequestIdMiddleware` first so `pino-http` picks up
    // the correlation id; `RequestContextMiddleware` second so
    // `req.context.ip` / `req.context.userAgent` are available to every
    // downstream guard / interceptor / controller.
    consumer.apply(RequestIdMiddleware, RequestContextMiddleware).forRoutes('*');
  }
}
