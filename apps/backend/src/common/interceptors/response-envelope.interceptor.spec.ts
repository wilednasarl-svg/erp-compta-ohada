import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { firstValueFrom, of } from 'rxjs';

import { RAW_RESPONSE_METADATA_KEY } from '../decorators/raw-response.decorator';
import { ResponseEnvelopeInterceptor } from './response-envelope.interceptor';

type ContextType = 'http' | 'rpc' | 'ws' | 'graphql';

interface BuildContextOptions {
  readonly type?: ContextType;
}

function buildExecutionContext(options: BuildContextOptions = {}): ExecutionContext {
  const handler = (): void => undefined;
  class FakeController {}

  return {
    getType: () => options.type ?? 'http',
    getHandler: () => handler,
    getClass: () => FakeController,
  } as unknown as ExecutionContext;
}

function buildCallHandler(value: unknown): CallHandler {
  return {
    handle: () => of(value),
  };
}

describe('ResponseEnvelopeInterceptor', () => {
  let reflector: Reflector;
  let interceptor: ResponseEnvelopeInterceptor;

  beforeEach(() => {
    reflector = new Reflector();
    interceptor = new ResponseEnvelopeInterceptor(reflector);
  });

  it('wraps a { user } response into { data: { user }, error: null }', async () => {
    const handlerReturn = { user: { id: 'u_1', email: 'a@b.io' } };
    const ctx = buildExecutionContext();
    const next = buildCallHandler(handlerReturn);

    const result = await firstValueFrom(interceptor.intercept(ctx, next));

    expect(result).toEqual({
      data: { user: { id: 'u_1', email: 'a@b.io' } },
      error: null,
    });
  });

  it('wraps primitive return values', async () => {
    const ctx = buildExecutionContext();
    const next = buildCallHandler(42);

    const result = await firstValueFrom(interceptor.intercept(ctx, next));

    expect(result).toEqual({ data: 42, error: null });
  });

  it('wraps `null` as { data: null, error: null }', async () => {
    const ctx = buildExecutionContext();
    const next = buildCallHandler(null);

    const result = await firstValueFrom(interceptor.intercept(ctx, next));

    expect(result).toEqual({ data: null, error: null });
  });

  it('treats `undefined` (204-style) as { data: null, error: null }', async () => {
    const ctx = buildExecutionContext();
    const next = buildCallHandler(undefined);

    const result = await firstValueFrom(interceptor.intercept(ctx, next));

    expect(result).toEqual({ data: null, error: null });
  });

  it('preserves arrays inside `data`', async () => {
    const payload = [{ id: 'o_1' }, { id: 'o_2' }];
    const ctx = buildExecutionContext();
    const next = buildCallHandler(payload);

    const result = await firstValueFrom(interceptor.intercept(ctx, next));

    expect(result).toEqual({ data: payload, error: null });
  });

  it('bypasses wrapping when @RawResponse() is set on the handler', async () => {
    const ctx = buildExecutionContext();
    const raw = Buffer.from('hello');
    const next = buildCallHandler(raw);

    jest.spyOn(reflector, 'getAllAndOverride').mockImplementation((key) => {
      if (key === RAW_RESPONSE_METADATA_KEY) {
        return true;
      }
      return undefined;
    });

    const result = await firstValueFrom(interceptor.intercept(ctx, next));

    expect(result).toBe(raw);
  });

  it('still wraps when the metadata flag is explicitly false', async () => {
    const ctx = buildExecutionContext();
    const next = buildCallHandler({ ok: true });

    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);

    const result = await firstValueFrom(interceptor.intercept(ctx, next));

    expect(result).toEqual({ data: { ok: true }, error: null });
  });

  it('passes through non-HTTP execution contexts untouched', async () => {
    const ctx = buildExecutionContext({ type: 'rpc' });
    const payload = { rpc: 'payload' };
    const next = buildCallHandler(payload);

    const result = await firstValueFrom(interceptor.intercept(ctx, next));

    expect(result).toBe(payload);
  });
});
