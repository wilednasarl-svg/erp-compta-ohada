import type { NextFunction, Request, Response } from 'express';

import { REQUEST_ID_HEADER, RequestIdMiddleware } from './request-id.middleware';

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface MutableContext {
  requestId?: string;
}

interface FakeRequest {
  headers: Record<string, string | string[] | undefined>;
  id?: string;
  context?: MutableContext;
}

function buildFakeReq(headers: FakeRequest['headers'] = {}): FakeRequest {
  return { headers };
}

function buildFakeRes(): { setHeader: jest.Mock; headers: Map<string, string> } {
  const headers = new Map<string, string>();
  const setHeader = jest.fn((name: string, value: string) => {
    headers.set(name.toLowerCase(), value);
  });
  return { setHeader, headers };
}

describe('RequestIdMiddleware', () => {
  let middleware: RequestIdMiddleware;
  let next: NextFunction;

  beforeEach(() => {
    middleware = new RequestIdMiddleware();
    next = jest.fn();
  });

  it('generates a UUID v4 request_id when no inbound header is provided', () => {
    const req = buildFakeReq();
    const res = buildFakeRes();

    middleware.use(req as unknown as Request, res as unknown as Response, next);

    expect(req.id).toBeDefined();
    expect(req.id).toMatch(UUID_V4_PATTERN);
    expect(req.context?.requestId).toBe(req.id);
    expect(res.headers.get(REQUEST_ID_HEADER)).toBe(req.id);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('reuses a well-formed inbound x-request-id header', () => {
    const inbound = 'trace-abc-123';
    const req = buildFakeReq({ [REQUEST_ID_HEADER]: inbound });
    const res = buildFakeRes();

    middleware.use(req as unknown as Request, res as unknown as Response, next);

    expect(req.id).toBe(inbound);
    expect(req.context?.requestId).toBe(inbound);
    expect(res.headers.get(REQUEST_ID_HEADER)).toBe(inbound);
  });

  it('discards an inbound id with unsafe characters and generates a new one', () => {
    const req = buildFakeReq({ [REQUEST_ID_HEADER]: 'evil id\n with spaces' });
    const res = buildFakeRes();

    middleware.use(req as unknown as Request, res as unknown as Response, next);

    expect(req.id).toMatch(UUID_V4_PATTERN);
    expect(req.id).not.toContain(' ');
    expect(req.context?.requestId).toBe(req.id);
  });

  it('discards an inbound id that exceeds the length cap', () => {
    const tooLong = 'a'.repeat(500);
    const req = buildFakeReq({ [REQUEST_ID_HEADER]: tooLong });
    const res = buildFakeRes();

    middleware.use(req as unknown as Request, res as unknown as Response, next);

    expect(req.id).toMatch(UUID_V4_PATTERN);
    expect(req.id).not.toBe(tooLong);
  });

  it('picks the first safe value when the header arrives as an array', () => {
    const req = buildFakeReq({ [REQUEST_ID_HEADER]: ['bad value!!', 'good-id-42'] });
    const res = buildFakeRes();

    middleware.use(req as unknown as Request, res as unknown as Response, next);

    expect(req.id).toBe('good-id-42');
  });

  it('preserves an existing req.context payload while adding requestId', () => {
    const req = buildFakeReq();
    req.context = { requestId: undefined } as MutableContext;
    Object.assign(req.context, { ip: '10.0.0.1' });
    const res = buildFakeRes();

    middleware.use(req as unknown as Request, res as unknown as Response, next);

    expect(req.context?.requestId).toMatch(UUID_V4_PATTERN);
    expect((req.context as Record<string, unknown>).ip).toBe('10.0.0.1');
  });
});
