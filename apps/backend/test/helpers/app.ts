import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Server } from 'node:http';
import supertest from 'supertest';

import { AppModule } from '../../src/app.module';
import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter';
import { ResponseEnvelopeInterceptor } from '../../src/common/interceptors/response-envelope.interceptor';

/**
 * Supertest's typings shifted from `SuperTest<Test>` to `TestAgent<Test>`
 * between major releases. Using `ReturnType<typeof supertest>` keeps the
 * helper insensitive to the exact name so a dep bump doesn't break every
 * spec signature.
 */
export type E2eHttp = ReturnType<typeof supertest>;

/**
 * Boot a NestJS test app mirroring the production wiring from `main.ts`:
 * global ValidationPipe, ResponseEnvelopeInterceptor, AllExceptionsFilter.
 * Returns a supertest agent bound to the in-process server (no port
 * listener — supertest opens the http handler directly).
 *
 * Each e2e spec opens a fresh app to make sure leftover state (open
 * connections, cached config) doesn't leak across suites. Closing is
 * the caller's responsibility via `app.close()` in `afterAll`.
 */
export interface E2eAppHandle {
  readonly app: INestApplication;
  readonly http: E2eHttp;
}

export async function createE2eApp(): Promise<E2eAppHandle> {
  const moduleRef: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleRef.createNestApplication({ bufferLogs: false });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
      stopAtFirstError: false,
    }),
  );
  app.useGlobalInterceptors(new ResponseEnvelopeInterceptor(app.get(Reflector)));
  app.useGlobalFilters(new AllExceptionsFilter());

  await app.init();

  const server = app.getHttpServer() as Server;
  const http = supertest(server);

  return { app, http };
}
