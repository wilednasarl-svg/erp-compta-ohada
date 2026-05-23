import 'reflect-metadata';

import { ValidationPipe } from '@nestjs/common';
import { NestFactory, Reflector } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';

import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { ResponseEnvelopeInterceptor } from './common/interceptors/response-envelope.interceptor';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // Buffer logs until the pino-backed Logger is installed below, so
    // bootstrap lines flow through the same redaction pipeline as the
    // rest of the application.
    bufferLogs: true,
  });

  // Swap Nest's default text logger for the pino-backed one wired by
  // `LoggerModule` (BE-BOOT-09). Every framework log now ships as
  // structured JSON with sensitive fields redacted.
  app.useLogger(app.get(Logger));

  // Behind Railway / Vercel edge / any reverse proxy: `req.ip` reads the
  // X-Forwarded-For chain instead of the proxy's loopback. WITHOUT this,
  // every audit row in `auth_events` would log the load-balancer's IP,
  // not the real client — defeating forensic value.
  // `1` = trust one hop (the platform's LB). If we ever sit behind a
  // double-proxy chain (CloudFlare → Railway), bump this to `2`.
  app.set('trust proxy', 1);

  // CORS. In production `APP_BASE_URL` MUST be set to the frontend
  // origin (e.g. `https://app.erp-compta.io`) so the browser allows
  // credentialed requests. In local dev it falls back to `*` WITHOUT
  // credentials — which is fine because no cookie/session is in play
  // (auth is Bearer in the Authorization header).
  const corsOrigin = process.env.APP_BASE_URL;
  app.enableCors(
    corsOrigin !== undefined && corsOrigin.length > 0
      ? { origin: corsOrigin, credentials: true }
      : { origin: '*' },
  );

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
      stopAtFirstError: false,
    }),
  );

  // Order matters: the filter must be registered BEFORE the interceptor so
  // that thrown exceptions never reach the interceptor's success-wrapping
  // path. The pair guarantees a single response shape app-wide:
  //   success → { data: T, error: null }   (ResponseEnvelopeInterceptor)
  //   failure → { data: null, error: ... } (AllExceptionsFilter)
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new ResponseEnvelopeInterceptor(app.get(Reflector)));

  // OpenAPI / Swagger UI (BE-DOC-04). The `@nestjs/swagger` CLI plugin
  // (declared in `nest-cli.json`) walks every `*.dto.ts` and `*.controller.ts`
  // at build time and auto-emits `@ApiProperty()` / `@ApiOperation()`
  // metadata from TypeScript types + `class-validator` decorators — no
  // manual annotation needed on individual fields.
  //
  // The docs route is plain Express middleware (swagger-ui-express),
  // not a Nest controller, so the global `JwtAuthGuard` (BE-RBAC-06)
  // does NOT intercept it. We mount it unconditionally because the
  // OpenAPI spec is the public contract — frontend, contributors, and
  // SDK generators all consume it.
  //
  //   - `GET /docs`        — Swagger UI (interactive).
  //   - `GET /docs-json`   — raw OpenAPI 3 spec (frontend codegen input).
  const swaggerConfig = new DocumentBuilder()
    .setTitle('ERP Compta — API')
    .setDescription(
      [
        'Backend API for the ERP Compta SaaS platform (NestJS + PostgreSQL).',
        '',
        'All endpoints return the project-wide envelope `{ data, error }` produced by',
        '`ResponseEnvelopeInterceptor` (success) and `AllExceptionsFilter` (failure).',
        'See `docs/error-codes.md` for the complete error catalogue.',
      ].join('\n'),
    )
    .setVersion('0.1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'HS256 access token emitted by `POST /auth/login` (15-min TTL).',
      },
      'bearer',
    )
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document, {
    jsonDocumentUrl: 'docs-json',
    swaggerOptions: { persistAuthorization: true },
  });

  app.enableShutdownHooks();

  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port);

  app.get(Logger).log(`Backend listening on http://localhost:${port}`, 'Bootstrap');
}

void bootstrap();
