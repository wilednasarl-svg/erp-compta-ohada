import { sign as jwtSign } from 'jsonwebtoken';

import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import type { Clock } from '../../../common/time/clock';
import type { AppConfig } from '../../../config/configuration';
import type { ConfigService } from '@nestjs/config';
import { JWT_ALGORITHM, JWT_ISSUER } from '../config/jwt.config';
import { JwtTokenService } from './jwt-token.service';

const SECRET = 'a'.repeat(64); // 32+ chars enforced by env.validation.ts
const OTHER_SECRET = 'b'.repeat(64);
const ACCESS_TTL = '15m';

function buildClock(epochMs: number): Clock {
  return {
    now: () => new Date(epochMs),
    nowMs: () => epochMs,
  };
}

function buildService(epochMs: number, secret: string = SECRET): JwtTokenService {
  const configService = {
    get: jest.fn((path: string) => {
      if (path === 'jwt') {
        return { secret, accessTtl: ACCESS_TTL, refreshTtl: '7d' };
      }
      return undefined;
    }),
  } as unknown as ConfigService<AppConfig, true>;
  return new JwtTokenService(configService, buildClock(epochMs));
}

const T0 = 1_700_000_000_000; // 2023-11-14T22:13:20Z — arbitrary fixed epoch

describe('JwtTokenService (BE-CRYPTO-03)', () => {
  describe('signAccessToken', () => {
    it('produces an HS256 token whose claims round-trip through verifyAccessToken', () => {
      const service = buildService(T0);
      const token = service.signAccessToken({
        sub: 'user-1',
        orgId: 'org-1',
        role: 'admin',
        mfaVerified: true,
      });

      const claims = service.verifyAccessToken(token);

      expect(claims.sub).toBe('user-1');
      expect(claims.purpose).toBe('access');
      expect(claims.org_id).toBe('org-1');
      expect(claims.role).toBe('admin');
      expect(claims.mfa_verified).toBe(true);
      expect(claims.iss).toBe(JWT_ISSUER);
      expect(claims.iat).toBe(Math.floor(T0 / 1000));
      // ACCESS_TTL = 15m → exp = iat + 900
      expect(claims.exp).toBe(Math.floor(T0 / 1000) + 15 * 60);
    });

    it('omits optional claims when not provided', () => {
      const service = buildService(T0);
      const token = service.signAccessToken({ sub: 'user-2' });

      const claims = service.verifyAccessToken(token);

      expect(claims.sub).toBe('user-2');
      expect(claims.org_id).toBeUndefined();
      expect(claims.role).toBeUndefined();
      expect(claims.mfa_verified).toBeUndefined();
    });

    it('rejects an empty sub', () => {
      const service = buildService(T0);
      expect(() => service.signAccessToken({ sub: '' })).toThrow(/non-empty string/);
    });
  });

  describe('signMfaChallengeToken', () => {
    it('produces a token with purpose=mfa_challenge and a 5-minute TTL', () => {
      const service = buildService(T0);
      const token = service.signMfaChallengeToken({ sub: 'user-1' });

      const claims = service.verifyMfaChallengeToken(token);

      expect(claims.sub).toBe('user-1');
      expect(claims.purpose).toBe('mfa_challenge');
      expect(claims.iss).toBe(JWT_ISSUER);
      expect(claims.exp).toBe(Math.floor(T0 / 1000) + 5 * 60);
    });
  });

  describe('purpose discrimination', () => {
    it('rejects an access token presented to verifyMfaChallengeToken', () => {
      const service = buildService(T0);
      const accessToken = service.signAccessToken({ sub: 'user-1' });

      expect(() => service.verifyMfaChallengeToken(accessToken)).toThrow(AppException);
      try {
        service.verifyMfaChallengeToken(accessToken);
      } catch (error) {
        expect(error).toBeInstanceOf(AppException);
        expect((error as AppException).code).toBe(ERROR_CODES.AUTH_INVALID_TOKEN);
        expect((error as AppException).status).toBe(401);
      }
    });

    it('rejects an MFA challenge token presented to verifyAccessToken', () => {
      const service = buildService(T0);
      const challengeToken = service.signMfaChallengeToken({ sub: 'user-1' });

      expect(() => service.verifyAccessToken(challengeToken)).toThrow(AppException);
    });
  });

  describe('verifyAccessToken failures', () => {
    it('rejects an empty token string', () => {
      const service = buildService(T0);
      expect(() => service.verifyAccessToken('')).toThrow(AppException);
    });

    it('rejects a malformed token', () => {
      const service = buildService(T0);
      expect(() => service.verifyAccessToken('not-a-jwt')).toThrow(AppException);
    });

    it('rejects a token signed with a different secret', () => {
      const issuer = buildService(T0, OTHER_SECRET);
      const verifier = buildService(T0, SECRET);
      const token = issuer.signAccessToken({ sub: 'user-1' });

      expect(() => verifier.verifyAccessToken(token)).toThrow(AppException);
    });

    it('rejects a token signed with a different issuer', () => {
      const token = jwtSign(
        { sub: 'user-1', purpose: 'access', iat: Math.floor(T0 / 1000) },
        SECRET,
        { algorithm: JWT_ALGORITHM, issuer: 'attacker', expiresIn: '15m' },
      );
      const service = buildService(T0);

      expect(() => service.verifyAccessToken(token)).toThrow(AppException);
    });

    it('rejects a token whose expiry has elapsed (clock advanced past exp)', () => {
      const signer = buildService(T0);
      const token = signer.signAccessToken({ sub: 'user-1' });
      // Advance the verifier clock by 16 minutes (TTL = 15m).
      const verifier = buildService(T0 + 16 * 60 * 1000);

      expect(() => verifier.verifyAccessToken(token)).toThrow(AppException);
    });

    it('all failures surface the generic AUTH_INVALID_TOKEN code (no oracle leak)', () => {
      const service = buildService(T0);
      const cases = ['', 'not-a-jwt', 'a.b.c'];
      for (const t of cases) {
        try {
          service.verifyAccessToken(t);
          fail(`expected ${t} to throw`);
        } catch (error) {
          expect(error).toBeInstanceOf(AppException);
          expect((error as AppException).code).toBe(ERROR_CODES.AUTH_INVALID_TOKEN);
        }
      }
    });
  });
});
