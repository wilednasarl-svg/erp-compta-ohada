/**
 * `Clock` — small abstraction over wall-clock time so that services with
 * time-sensitive behavior (token expiry, audit timestamps, rate-limit
 * windows, …) can be unit-tested deterministically.
 *
 * Two facets:
 *  - `now(): Date`  — for callers that need a JS `Date` (e.g. TypeORM
 *    persistence of `TIMESTAMPTZ` columns like `refresh_tokens.used_at`).
 *  - `nowMs(): number` — for callers that compare numerically (token
 *    `iat`/`exp` claims are seconds-since-epoch; expiry math is cheaper
 *    on `number` than `Date`).
 *
 * Inject via the `CLOCK` token (`@Inject(CLOCK) clock: Clock`). The default
 * provider in production modules is `SystemClock` (delegates to `Date`).
 * Tests pass a fixed clock to make `iat`/`exp`/`usedAt` predictable without
 * resorting to `jest.useFakeTimers()` (which pollutes other timers in the
 * test runner).
 */

export interface Clock {
  now(): Date;
  nowMs(): number;
}

export const CLOCK = Symbol('CLOCK');

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }

  nowMs(): number {
    return Date.now();
  }
}
