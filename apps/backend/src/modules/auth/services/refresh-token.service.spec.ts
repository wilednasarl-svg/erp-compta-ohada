import { createHash } from 'node:crypto';

import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import type { Clock } from '../../../common/time/clock';
import type { AppConfig } from '../../../config/configuration';
import type { ConfigService } from '@nestjs/config';
import type { AuthEventsService } from '../../audit/services/auth-events.service';
import type { RefreshTokenEntity } from '../entities/refresh-token.entity';
import type { RefreshTokenRepository } from '../repositories/refresh-token.repository';
import { RefreshTokenService } from './refresh-token.service';

const REFRESH_TTL = '7d';
const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const T0 = 1_700_000_000_000;

function buildClock(epochMs: number): Clock {
  return {
    now: () => new Date(epochMs),
    nowMs: () => epochMs,
  };
}

function hash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function buildEntity(overrides: Partial<RefreshTokenEntity> = {}): RefreshTokenEntity {
  return {
    id: 'rt-1',
    userId: 'user-1',
    organizationId: null,
    tokenHash: 'previously-issued-hash',
    familyId: 'fam-1',
    usedAt: null,
    expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
    revokedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as RefreshTokenEntity;
}

/**
 * Test harness — every `jest.fn()` is held in a stable const so assertions
 * (`expect(findByTokenHash).toHaveBeenCalled()`) reference the function
 * value directly. Going through `mocks.repo.findByTokenHash` would trip
 * `@typescript-eslint/unbound-method` because the lookup walks the class
 * prototype.
 */
interface Harness {
  service: RefreshTokenService;
  findByTokenHash: jest.Mock<Promise<RefreshTokenEntity | null>, [string]>;
  issueRow: jest.Mock<Promise<RefreshTokenEntity>, [unknown]>;
  markUsed: jest.Mock<Promise<void>, [string, Date]>;
  revokeById: jest.Mock<Promise<void>, [string, Date]>;
  revokeFamily: jest.Mock<Promise<void>, [string, Date]>;
  recordEvent: jest.Mock<Promise<null>, [string, unknown, unknown]>;
}

function buildHarness(epochMs: number = T0): Harness {
  const findByTokenHash = jest.fn<Promise<RefreshTokenEntity | null>, [string]>();
  const issueRow = jest.fn<Promise<RefreshTokenEntity>, [unknown]>();
  const markUsed = jest.fn<Promise<void>, [string, Date]>().mockResolvedValue(undefined);
  const revokeById = jest.fn<Promise<void>, [string, Date]>().mockResolvedValue(undefined);
  const revokeFamily = jest.fn<Promise<void>, [string, Date]>().mockResolvedValue(undefined);
  const recordEvent = jest.fn<Promise<null>, [string, unknown, unknown]>().mockResolvedValue(null);

  const repo = {
    findByTokenHash,
    issue: issueRow,
    markUsed,
    revokeById,
    revokeFamily,
    findActiveByUser: jest.fn(),
    revokeForUserInOrganization: jest.fn(),
  } as unknown as RefreshTokenRepository;

  const authEvents = {
    record: recordEvent,
  } as unknown as AuthEventsService;

  const configService = {
    get: jest.fn((path: string) => {
      if (path === 'jwt') {
        return { secret: 'x'.repeat(64), accessTtl: '15m', refreshTtl: REFRESH_TTL };
      }
      return undefined;
    }),
  } as unknown as ConfigService<AppConfig, true>;

  const service = new RefreshTokenService(configService, buildClock(epochMs), repo, authEvents);

  return {
    service,
    findByTokenHash,
    issueRow,
    markUsed,
    revokeById,
    revokeFamily,
    recordEvent,
  };
}

interface PersistedIssue {
  userId: string;
  organizationId: string | null;
  tokenHash: string;
  familyId: string;
  expiresAt: Date;
}

interface RecordedEventContext {
  userId: string | null;
  organizationId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
}

describe('RefreshTokenService (BE-CRYPTO-04)', () => {
  describe('issue', () => {
    it('mints an opaque token, hashes it, and persists with a fresh family when none provided', async () => {
      const h = buildHarness();
      h.issueRow.mockResolvedValue(buildEntity());

      const result = await h.service.issue({ userId: 'user-1', organizationId: 'org-1' });

      expect(typeof result.token).toBe('string');
      expect(result.token.length).toBeGreaterThan(40); // 32 bytes base64url ≈ 43 chars
      expect(result.familyId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
      expect(result.expiresAt.getTime()).toBe(T0 + REFRESH_TTL_MS);

      expect(h.issueRow).toHaveBeenCalledTimes(1);
      const persisted = h.issueRow.mock.calls[0][0] as PersistedIssue;
      expect(persisted.userId).toBe('user-1');
      expect(persisted.organizationId).toBe('org-1');
      expect(persisted.tokenHash).toBe(hash(result.token));
      expect(persisted.familyId).toBe(result.familyId);
      expect(persisted.expiresAt.getTime()).toBe(T0 + REFRESH_TTL_MS);
    });

    it('reuses the provided familyId when rotating', async () => {
      const h = buildHarness();
      h.issueRow.mockResolvedValue(buildEntity());

      const result = await h.service.issue({ userId: 'u', familyId: 'fam-keep-me' });

      expect(result.familyId).toBe('fam-keep-me');
      const persisted = h.issueRow.mock.calls[0][0] as PersistedIssue;
      expect(persisted.familyId).toBe('fam-keep-me');
    });

    it('produces two different tokens on two issuances (CSPRNG, not a fixed value)', async () => {
      const h = buildHarness();
      h.issueRow.mockResolvedValue(buildEntity());

      const a = await h.service.issue({ userId: 'u' });
      const b = await h.service.issue({ userId: 'u' });

      expect(a.token).not.toBe(b.token);
    });
  });

  describe('rotate', () => {
    it('marks the presented token used and issues a sibling within the same family', async () => {
      const h = buildHarness();
      const presented = 'plain-presented-token';
      h.findByTokenHash.mockResolvedValue(
        buildEntity({
          id: 'rt-old',
          tokenHash: hash(presented),
          familyId: 'fam-rot',
          expiresAt: new Date(T0 + 1000),
          userId: 'user-1',
          organizationId: 'org-1',
        }),
      );
      h.issueRow.mockResolvedValue(buildEntity({ id: 'rt-new' }));

      const result = await h.service.rotate(presented);

      expect(h.markUsed).toHaveBeenCalledWith('rt-old', new Date(T0));
      expect(h.issueRow).toHaveBeenCalledTimes(1);
      const persisted = h.issueRow.mock.calls[0][0] as PersistedIssue;
      expect(persisted.familyId).toBe('fam-rot');
      expect(persisted.userId).toBe('user-1');
      expect(persisted.organizationId).toBe('org-1');
      expect(result.familyId).toBe('fam-rot');
      // The new token MUST differ from the presented one — they're separate
      // CSPRNG draws.
      expect(result.token).not.toBe(presented);
    });

    it('detects reuse when the presented token was already used and revokes the whole family', async () => {
      const h = buildHarness();
      const presented = 'replayed-token';
      h.findByTokenHash.mockResolvedValue(
        buildEntity({
          id: 'rt-reuse',
          tokenHash: hash(presented),
          familyId: 'fam-evil',
          usedAt: new Date(T0 - 5_000),
          userId: 'user-9',
          organizationId: 'org-9',
        }),
      );

      await expect(
        h.service.rotate(presented, { ipAddress: '203.0.113.7', userAgent: 'curl/8' }),
      ).rejects.toMatchObject({
        code: ERROR_CODES.AUTH_REFRESH_REUSE,
        status: 401,
      });

      expect(h.revokeFamily).toHaveBeenCalledWith('fam-evil', new Date(T0));
      expect(h.markUsed).not.toHaveBeenCalled();
      expect(h.issueRow).not.toHaveBeenCalled();

      expect(h.recordEvent).toHaveBeenCalledTimes(1);
      const call = h.recordEvent.mock.calls[0];
      const eventType = call[0];
      const context = call[1] as RecordedEventContext;
      const metadata = call[2] as Record<string, unknown>;
      expect(eventType).toBe('auth.refresh_token_reuse_detected');
      expect(context.userId).toBe('user-9');
      expect(context.organizationId).toBe('org-9');
      expect(context.ipAddress).toBe('203.0.113.7');
      expect(context.userAgent).toBe('curl/8');
      expect(metadata).toMatchObject({
        familyId: 'fam-evil',
        presentedTokenId: 'rt-reuse',
        presentedTokenWasUsed: true,
        presentedTokenWasRevoked: false,
      });
    });

    it('records null ipAddress/userAgent when called without a context (system-internal rotation)', async () => {
      const h = buildHarness();
      const presented = 'replayed-no-ctx';
      h.findByTokenHash.mockResolvedValue(
        buildEntity({ tokenHash: hash(presented), usedAt: new Date(T0 - 1) }),
      );

      await expect(h.service.rotate(presented)).rejects.toBeInstanceOf(AppException);

      const ctx = h.recordEvent.mock.calls[0][1] as RecordedEventContext;
      expect(ctx.ipAddress).toBeNull();
      expect(ctx.userAgent).toBeNull();
    });

    it('detects reuse when the presented token was already revoked', async () => {
      const h = buildHarness();
      const presented = 'revoked-token';
      h.findByTokenHash.mockResolvedValue(
        buildEntity({
          tokenHash: hash(presented),
          revokedAt: new Date(T0 - 10_000),
          familyId: 'fam-rev',
        }),
      );

      await expect(h.service.rotate(presented)).rejects.toBeInstanceOf(AppException);
      expect(h.revokeFamily).toHaveBeenCalledWith('fam-rev', new Date(T0));
      expect(h.recordEvent).toHaveBeenCalledTimes(1);
    });

    it('rejects an unknown token with AUTH_INVALID_TOKEN (no family side-effect)', async () => {
      const h = buildHarness();
      h.findByTokenHash.mockResolvedValue(null);

      await expect(h.service.rotate('does-not-exist')).rejects.toMatchObject({
        code: ERROR_CODES.AUTH_INVALID_TOKEN,
      });
      expect(h.revokeFamily).not.toHaveBeenCalled();
      expect(h.recordEvent).not.toHaveBeenCalled();
    });

    it('rejects an expired token with AUTH_INVALID_TOKEN (no family revocation)', async () => {
      const h = buildHarness();
      const presented = 'expired-token';
      h.findByTokenHash.mockResolvedValue(
        buildEntity({
          tokenHash: hash(presented),
          expiresAt: new Date(T0 - 1), // expired 1 ms before "now"
        }),
      );

      await expect(h.service.rotate(presented)).rejects.toMatchObject({
        code: ERROR_CODES.AUTH_INVALID_TOKEN,
      });
      expect(h.revokeFamily).not.toHaveBeenCalled();
      expect(h.recordEvent).not.toHaveBeenCalled();
    });

    it('rejects an empty token without touching the repository', async () => {
      const h = buildHarness();

      await expect(h.service.rotate('')).rejects.toBeInstanceOf(AppException);
      expect(h.findByTokenHash).not.toHaveBeenCalled();
    });
  });

  describe('revoke / revokeFamily', () => {
    it('revoke marks the token revoked when found and active', async () => {
      const h = buildHarness();
      const token = 'live-token';
      h.findByTokenHash.mockResolvedValue(buildEntity({ id: 'rt-live', tokenHash: hash(token) }));

      await h.service.revoke(token);

      expect(h.revokeById).toHaveBeenCalledWith('rt-live', new Date(T0));
    });

    it('revoke is a no-op for unknown / already-revoked tokens', async () => {
      const h = buildHarness();
      h.findByTokenHash.mockResolvedValueOnce(null);

      await h.service.revoke('ghost');
      expect(h.revokeById).not.toHaveBeenCalled();

      h.findByTokenHash.mockResolvedValueOnce(buildEntity({ revokedAt: new Date(T0 - 1) }));
      await h.service.revoke('already-dead');
      expect(h.revokeById).not.toHaveBeenCalled();
    });

    it('revokeFamily delegates to the repository with the injected clock', async () => {
      const h = buildHarness();

      await h.service.revokeFamily('fam-x');

      expect(h.revokeFamily).toHaveBeenCalledWith('fam-x', new Date(T0));
    });
  });
});
