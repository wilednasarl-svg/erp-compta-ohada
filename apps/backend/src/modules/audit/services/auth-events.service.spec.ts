import type { AuthEventEntity } from '../entities/auth-event.entity';
import type { AuthEventRepository } from '../repositories/auth-event.repository';
import { AuthEventsService, type AuthEventContext } from './auth-events.service';

function buildRepo(record: jest.Mock): AuthEventRepository {
  return { record } as unknown as AuthEventRepository;
}

const FULL_CONTEXT: AuthEventContext = {
  ipAddress: '203.0.113.7',
  userAgent: 'Mozilla/5.0',
  userId: 'u_1',
  organizationId: 'o_1',
};

describe('AuthEventsService (BE-AUDIT-01)', () => {
  describe('record', () => {
    it('forwards a full context to the repository and returns the saved entity', async () => {
      const saved = { id: 'evt_1' } as AuthEventEntity;
      const repoRecord = jest.fn().mockResolvedValue(saved);
      const service = new AuthEventsService(buildRepo(repoRecord));

      const result = await service.record('auth.login_success', FULL_CONTEXT, { mfa: false });

      expect(result).toBe(saved);
      expect(repoRecord).toHaveBeenCalledWith({
        eventType: 'auth.login_success',
        userId: 'u_1',
        organizationId: 'o_1',
        ipAddress: '203.0.113.7',
        userAgent: 'Mozilla/5.0',
        metadata: { mfa: false },
      });
    });

    it('defaults missing userId / organizationId to null (failed-login style events)', async () => {
      const repoRecord = jest.fn().mockResolvedValue({} as AuthEventEntity);
      const service = new AuthEventsService(buildRepo(repoRecord));

      await service.record('auth.login_failed', {
        ipAddress: '198.51.100.4',
        userAgent: 'curl/8.0',
      });

      expect(repoRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'auth.login_failed',
          userId: null,
          organizationId: null,
          ipAddress: '198.51.100.4',
          userAgent: 'curl/8.0',
        }),
      );
    });

    it('defaults metadata to an empty object when omitted', async () => {
      const repoRecord = jest.fn().mockResolvedValue({} as AuthEventEntity);
      const service = new AuthEventsService(buildRepo(repoRecord));

      await service.record('auth.logout', FULL_CONTEXT);

      expect(repoRecord).toHaveBeenCalledWith(expect.objectContaining({ metadata: {} }));
    });

    it('explicit-null userId / organizationId is preserved (no override to undefined)', async () => {
      const repoRecord = jest.fn().mockResolvedValue({} as AuthEventEntity);
      const service = new AuthEventsService(buildRepo(repoRecord));

      await service.record('auth.signup', {
        ipAddress: null,
        userAgent: null,
        userId: null,
        organizationId: null,
      });

      expect(repoRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: null,
          organizationId: null,
          ipAddress: null,
          userAgent: null,
        }),
      );
    });

    it('swallows repository failures and returns null (audit must never brick auth)', async () => {
      const repoRecord = jest.fn().mockRejectedValue(new Error('connection lost'));
      const service = new AuthEventsService(buildRepo(repoRecord));
      const warnSpy = jest
        .spyOn(service['logger'], 'warn')
        .mockImplementation(() => undefined as void);

      const result = await service.record('auth.password_changed', FULL_CONTEXT);

      expect(result).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("failed to persist 'auth.password_changed' event"),
      );
    });

    it('also swallows non-Error throws (e.g. raw strings from buggy mocks)', async () => {
      const repoRecord = jest.fn().mockRejectedValue('boom');
      const service = new AuthEventsService(buildRepo(repoRecord));
      jest.spyOn(service['logger'], 'warn').mockImplementation(() => undefined as void);

      await expect(service.record('auth.cross_tenant_attempt', FULL_CONTEXT)).resolves.toBeNull();
    });
  });
});
