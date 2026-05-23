import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { LoggerModule } from './common/logging/logger.module';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { configuration } from './config/configuration';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './modules/health/health.module';

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
  ],
  controllers: [],
  providers: [],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Run on every route — health probes included — so cross-tenant
    // attempts and DB outages are still correlatable end-to-end.
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
