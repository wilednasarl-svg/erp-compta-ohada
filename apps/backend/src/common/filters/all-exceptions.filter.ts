/**
 * `AllExceptionsFilter` (BE-BOOT-06) — single global ExceptionFilter that
 * formats every error path into the project-wide failure envelope:
 *
 *   { data: null, error: { code, message, details? } }
 *
 * It pairs with `ResponseEnvelopeInterceptor` (BE-BOOT-07) which produces
 * the success counterpart `{ data: <payload>, error: null }`. Together
 * they guarantee that the client parser sees a single shape on every
 * `/auth/*` (and later `/organizations/*`, `/accounting/*`, …) response.
 *
 * Three classes of error are handled:
 *
 *   1. `AppException` — application-level error carrying a stable
 *      business `code` and HTTP `status`. Forwarded verbatim.
 *
 *   2. `BadRequestException` from `ValidationPipe` — wrapped under the
 *      stable code `VALIDATION_ERROR` (422). The pipe's `getResponse()`
 *      payload (Nest format: `{ message: string[], error, statusCode }`)
 *      is exposed under `details.fields` so frontend forms can surface
 *      per-field messages without parsing arbitrary strings.
 *
 *   3. Any other `HttpException` — passed through with `code` defaulting
 *      to the Nest exception name in UPPER_SNAKE_CASE (`NOT_FOUND`,
 *      `UNAUTHORIZED`, …) so we never leak a 500 by accident on a 4xx
 *      thrown by the framework.
 *
 *   4. Anything else (uncaught `Error`, throw of a plain value) → 500,
 *      code `INTERNAL_ERROR`, message redacted. The real message is
 *      logged at ERROR level with the request id for triage.
 */

import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import { AppException } from '../errors/app-exception';

export interface FailureEnvelope {
  readonly data: null;
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly details?: Readonly<Record<string, unknown>>;
  };
}

/**
 * Convert a Nest exception class name (`NotFoundException`,
 * `UnauthorizedException`, …) into a stable UPPER_SNAKE_CASE code
 * (`NOT_FOUND`, `UNAUTHORIZED`).
 */
function nestNameToCode(exceptionName: string): string {
  const stripped = exceptionName.endsWith('Exception')
    ? exceptionName.slice(0, -'Exception'.length)
    : exceptionName;
  return stripped
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .toUpperCase();
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() !== 'http') {
      // Non-HTTP context (rpc, ws, graphql) — let Nest handle it.
      throw exception;
    }

    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const { status, body } = this.formatException(exception, request);

    if (status >= 500) {
      // 5xx — log the full underlying error with request_id for triage.
      // The response body itself stays generic so we don't leak internals.
      const message = exception instanceof Error ? exception.message : String(exception);
      this.logger.error(
        `Unhandled exception on ${request.method} ${request.originalUrl}: ${message}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    response.status(status).json(body);
  }

  private formatException(
    exception: unknown,
    request: Request,
  ): { status: number; body: FailureEnvelope } {
    if (AppException.isAppException(exception)) {
      return {
        status: exception.status,
        body: {
          data: null,
          error: {
            code: exception.code,
            message: exception.message,
            ...(exception.details !== undefined ? { details: exception.details } : {}),
          },
        },
      };
    }

    if (exception instanceof BadRequestException) {
      // Nest payload shape: { message: string | string[], error: string, statusCode: number }
      const raw = exception.getResponse();
      const fields = this.extractValidationFields(raw);
      return {
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        body: {
          data: null,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Request validation failed',
            details: { fields },
          },
        },
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const raw = exception.getResponse();
      const message =
        typeof raw === 'string'
          ? raw
          : typeof (raw as { message?: unknown }).message === 'string'
            ? (raw as { message: string }).message
            : exception.message;
      return {
        status,
        body: {
          data: null,
          error: {
            code: nestNameToCode(exception.constructor.name),
            message,
          },
        },
      };
    }

    // Anything else — surface as a generic 500 and let the logger emit
    // the real details with the request_id for correlation.
    void request;
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: {
        data: null,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Internal server error',
        },
      },
    };
  }

  private extractValidationFields(raw: unknown): ReadonlyArray<string> {
    if (typeof raw === 'string') {
      return [raw];
    }
    if (raw !== null && typeof raw === 'object') {
      const messageField = (raw as { message?: unknown }).message;
      if (Array.isArray(messageField)) {
        return messageField.filter((m): m is string => typeof m === 'string');
      }
      if (typeof messageField === 'string') {
        return [messageField];
      }
    }
    return [];
  }
}
