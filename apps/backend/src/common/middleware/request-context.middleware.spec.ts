import type { NextFunction, Request, Response } from 'express';

import type { RequestContext } from '../types/request-context';
import { RequestContextMiddleware } from './request-context.middleware';

type RequestWithContext = Request & { context?: RequestContext };

function buildReq(overrides: Partial<Request> = {}): RequestWithContext {
  return {
    ip: '203.0.113.7',
    headers: { 'user-agent': 'jest/1.0' },
    ...overrides,
  } as RequestWithContext;
}

describe('RequestContextMiddleware (BE-BOOT-08)', () => {
  it('populates req.context.ip and req.context.userAgent from the Express request', () => {
    const middleware = new RequestContextMiddleware();
    const req = buildReq();
    const next: NextFunction = jest.fn();

    middleware.use(req, {} as Response, next);

    expect(req.context).toBeDefined();
    expect(req.context?.ip).toBe('203.0.113.7');
    expect(req.context?.userAgent).toBe('jest/1.0');
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('preserves an existing context bag (e.g. requestId populated by RequestIdMiddleware upstream)', () => {
    const middleware = new RequestContextMiddleware();
    const req = buildReq();
    req.context = { requestId: 'req-abc' };
    const next: NextFunction = jest.fn();

    middleware.use(req, {} as Response, next);

    expect(req.context?.requestId).toBe('req-abc');
    expect(req.context?.ip).toBe('203.0.113.7');
    expect(req.context?.userAgent).toBe('jest/1.0');
  });

  it('leaves ip / userAgent unset when the source values are missing', () => {
    const middleware = new RequestContextMiddleware();
    const req = buildReq({ ip: '', headers: {} });
    const next: NextFunction = jest.fn();

    middleware.use(req, {} as Response, next);

    expect(req.context?.ip).toBeUndefined();
    expect(req.context?.userAgent).toBeUndefined();
  });

  it('ignores an array-typed user-agent header (defensive — Express normalizes to string in practice)', () => {
    const middleware = new RequestContextMiddleware();
    const req = buildReq({ headers: { 'user-agent': ['a', 'b'] as unknown as string } });
    const next: NextFunction = jest.fn();

    middleware.use(req, {} as Response, next);

    expect(req.context?.userAgent).toBeUndefined();
  });
});
