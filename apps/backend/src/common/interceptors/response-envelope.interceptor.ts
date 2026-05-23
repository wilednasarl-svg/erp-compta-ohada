/**
 * `ResponseEnvelopeInterceptor` (BE-BOOT-07)
 *
 * Wraps every successful (2xx) HTTP response in the project-wide success
 * envelope:
 *
 *   { data: <handler return value>, error: null }
 *
 * Pairs with `AllExceptionsFilter` (BE-BOOT-06) which emits the matching
 * failure envelope `{ data: null, error: { code, message, details? } }`.
 *
 * Bypass: a handler (or controller class) annotated with `@RawResponse()`
 * is left untouched — useful for streams, file downloads, redirects, and
 * any endpoint whose body shape is fixed by an external contract.
 *
 * Non-HTTP execution contexts (RPC, WebSocket, GraphQL) are also passed
 * through untouched: the envelope is an HTTP-layer concern.
 *
 * Wrapping is intentionally unconditional inside the HTTP path: handlers
 * returning `undefined` (e.g. 204 No Content) become
 * `{ data: null, error: null }`, which keeps the client parser
 * single-shape.
 */

import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, map } from 'rxjs';

import { RAW_RESPONSE_METADATA_KEY } from '../decorators/raw-response.decorator';

export interface SuccessEnvelope<T> {
  readonly data: T | null;
  readonly error: null;
}

@Injectable()
export class ResponseEnvelopeInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const isRaw = this.reflector.getAllAndOverride<boolean | undefined>(RAW_RESPONSE_METADATA_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isRaw === true) {
      return next.handle();
    }

    return next.handle().pipe(
      map<unknown, SuccessEnvelope<unknown>>((value) => ({
        data: value === undefined ? null : value,
        error: null,
      })),
    );
  }
}
