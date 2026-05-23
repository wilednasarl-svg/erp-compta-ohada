import {
  type ArgumentsHost,
  BadRequestException,
  HttpException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';

import { AppException } from '../errors/app-exception';
import { ERROR_CODES } from '../errors/error-codes';
import { AllExceptionsFilter } from './all-exceptions.filter';

interface Captured {
  status: number;
  body: unknown;
}

interface FakeResponse {
  status: jest.Mock<FakeResponse, [number]>;
  json: jest.Mock<FakeResponse, [unknown]>;
}

function buildHost(
  type: 'http' | 'rpc' = 'http',
  request: { method?: string; originalUrl?: string } = {},
): { host: ArgumentsHost; captured: Captured } {
  const captured: Captured = { status: 0, body: null };
  const response = {} as FakeResponse;
  response.status = jest.fn<FakeResponse, [number]>((s) => {
    captured.status = s;
    return response;
  });
  response.json = jest.fn<FakeResponse, [unknown]>((body) => {
    captured.body = body;
    return response;
  });
  const reqDefault = { method: 'POST', originalUrl: '/auth/test', ...request };
  const host = {
    getType: () => type,
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => reqDefault,
    }),
  } as unknown as ArgumentsHost;
  return { host, captured };
}

describe('AllExceptionsFilter (BE-BOOT-06)', () => {
  describe('AppException', () => {
    it('forwards code, status, and message verbatim with details when provided', () => {
      const filter = new AllExceptionsFilter();
      const { host, captured } = buildHost();
      const exception = new AppException(ERROR_CODES.AUTH_EMAIL_TAKEN, {
        message: 'Email already registered',
        details: { field: 'email' },
      });

      filter.catch(exception, host);

      expect(captured.status).toBe(409);
      expect(captured.body).toEqual({
        data: null,
        error: {
          code: 'AUTH_EMAIL_TAKEN',
          message: 'Email already registered',
          details: { field: 'email' },
        },
      });
    });

    it('omits the details field when none were attached', () => {
      const filter = new AllExceptionsFilter();
      const { host, captured } = buildHost();

      filter.catch(new AppException(ERROR_CODES.AUTH_INVALID_CREDENTIALS), host);

      expect(captured.body).toEqual({
        data: null,
        error: {
          code: 'AUTH_INVALID_CREDENTIALS',
          message: 'AUTH_INVALID_CREDENTIALS',
        },
      });
    });
  });

  describe('BadRequestException from ValidationPipe', () => {
    it('reshapes per-field validation errors to VALIDATION_ERROR / 422', () => {
      const filter = new AllExceptionsFilter();
      const { host, captured } = buildHost();
      const exception = new BadRequestException({
        message: ['email must be an email', 'password must be longer than 12 characters'],
        error: 'Bad Request',
        statusCode: 400,
      });

      filter.catch(exception, host);

      expect(captured.status).toBe(422);
      expect(captured.body).toEqual({
        data: null,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request validation failed',
          details: {
            fields: ['email must be an email', 'password must be longer than 12 characters'],
          },
        },
      });
    });
  });

  describe('Other Nest HttpException', () => {
    it('maps NotFoundException to NOT_FOUND', () => {
      const filter = new AllExceptionsFilter();
      const { host, captured } = buildHost();

      filter.catch(new NotFoundException('Resource missing'), host);

      expect(captured.status).toBe(404);
      expect(captured.body).toEqual({
        data: null,
        error: { code: 'NOT_FOUND', message: 'Resource missing' },
      });
    });

    it('maps UnauthorizedException to UNAUTHORIZED', () => {
      const filter = new AllExceptionsFilter();
      const { host, captured } = buildHost();

      filter.catch(new UnauthorizedException(), host);

      expect(captured.status).toBe(401);
      expect((captured.body as { error: { code: string } }).error.code).toBe('UNAUTHORIZED');
    });

    it('uses the inner message string from getResponse() when the payload is a bare string', () => {
      const filter = new AllExceptionsFilter();
      const { host, captured } = buildHost();

      filter.catch(new HttpException('teapot', 418), host);

      expect(captured.status).toBe(418);
      expect((captured.body as { error: { message: string } }).error.message).toBe('teapot');
    });
  });

  describe('Uncaught errors', () => {
    it('returns a generic 500 INTERNAL_ERROR for a raw Error (no message leak)', () => {
      const filter = new AllExceptionsFilter();
      const errorSpy = jest.spyOn(filter['logger'], 'error').mockImplementation(() => undefined);
      const { host, captured } = buildHost();

      filter.catch(new Error('database connection lost: secret=hunter2'), host);

      expect(captured.status).toBe(500);
      expect(captured.body).toEqual({
        data: null,
        error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
      });
      expect(errorSpy).toHaveBeenCalledTimes(1);
      errorSpy.mockRestore();
    });

    it('returns 500 for a thrown non-Error value (e.g. throw "boom")', () => {
      const filter = new AllExceptionsFilter();
      jest.spyOn(filter['logger'], 'error').mockImplementation(() => undefined);
      const { host, captured } = buildHost();

      filter.catch('boom', host);

      expect(captured.status).toBe(500);
    });
  });

  describe('Non-HTTP execution context', () => {
    it('re-throws the exception for rpc/ws/graphql contexts (HTTP envelope is HTTP-only)', () => {
      const filter = new AllExceptionsFilter();
      const { host } = buildHost('rpc');
      const exception = new Error('downstream');

      expect(() => filter.catch(exception, host)).toThrow(exception);
    });
  });
});
