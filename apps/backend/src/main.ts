import 'reflect-metadata';

import { ValidationPipe } from '@nestjs/common';
import { NestFactory, Reflector } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
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

  app.enableShutdownHooks();

  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port);

  app.get(Logger).log(`Backend listening on http://localhost:${port}`, 'Bootstrap');
}

void bootstrap();
