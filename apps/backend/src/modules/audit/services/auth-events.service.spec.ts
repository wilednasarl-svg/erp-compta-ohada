import type { AuditLogEntity } from '../entities/audit-log.entity';
import type { AuditTrailService } from './audit-trail.service';
import { AuthEventsService, type AuthEventContext } from './auth-events.service';

function buildAuditTrail(record: jest.Mock): AuditTrailService {
  return { record } as unknown as AuditTrailService;
}

const FULL_CONTEXT: AuthEventContext = {
  ipAddress: '203.0.113.7',
  userAgent: 'Mozilla/5.0',
  userId: 'u_1',
  organizationId: 'o_1',
};

describe('AuthEventsService (BE-AUDIT-01) — wrapper over AuditTrailService', () => {
  describe('record', () => {
    it('splits eventType into (module, action) and forwards the full context', async () => {
      const saved = { id: 'evt_1' } as AuditLogEntity;
      const trailRecord = jest.fn().mockResolvedValue(saved);
      const service = new AuthEventsService(buildAuditTrail(trailRecord));

      const result = await service.record('auth.login_success', FULL_CONTEXT, { mfa: false });

      expect(result).toBe(saved);
      expect(trailRecord).toHaveBeenCalledWith({
        module: 'auth',
        action: 'login_success',
        legacyEventType: 'auth.login_success',
        metadata: { mfa: false },
        ctx: {
          ipAddress: '203.0.113.7',
          userAgent: 'Mozilla/5.0',
          userId: 'u_1',
          organizationId: 'o_1',
          requestId: null,
        },
      });
    });

    it('preserves multi-segment action codes (organizations.invitation_sent)', async () => {
      const trailRecord = jest.fn().mockResolvedValue({} as AuditLogEntity);
      const service = new AuthEventsService(buildAuditTrail(trailRecord));

      await service.record('organizations.invitation_sent', FULL_CONTEXT);

      expect(trailRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          module: 'organizations',
          action: 'invitation_sent',
          legacyEventType: 'organizations.invitation_sent',
        }),
      );
    });

    it('defaults missing userId / organizationId to null (failed-login style events)', async () => {
      const trailRecord = jest.fn().mockResolvedValue({} as AuditLogEntity);
      const service = new AuthEventsService(buildAuditTrail(trailRecord));

      await service.record('auth.login_failed', {
        ipAddress: '198.51.100.4',
        userAgent: 'curl/8.0',
      });

      expect(trailRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          module: 'auth',
          action: 'login_failed',
          ctx: expect.objectContaining({
            ipAddress: '198.51.100.4',
            userAgent: 'curl/8.0',
            userId: null,
            organizationId: null,
            requestId: null,
          }),
        }),
      );
    });

    it('defaults metadata to an empty object when omitted', async () => {
      const trailRecord = jest.fn().mockResolvedValue({} as AuditLogEntity);
      const service = new AuthEventsService(buildAuditTrail(trailRecord));

      await service.record('auth.logout', FULL_CONTEXT);

      expect(trailRecord).toHaveBeenCalledWith(expect.objectContaining({ metadata: {} }));
    });

    it('propagates a malformed eventType to a WARN and returns null without delegating', async () => {
      const trailRecord = jest.fn();
      const service = new AuthEventsService(buildAuditTrail(trailRecord));
      const warnSpy = jest
        .spyOn(service['logger'], 'warn')
        .mockImplementation(() => undefined as void);

      // Cast is a deliberate "what if a buggy emitter sneaks in a code
      // without a dot?" — the type system blocks it for canonical
      // emitters but defensive code still has to behave.
      const result = await service.record(
        'malformed_event_no_dot' as never,
        FULL_CONTEXT,
      );

      expect(result).toBeNull();
      expect(trailRecord).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("malformed eventType 'malformed_event_no_dot'"),
      );
    });

    it('propagates requestId through the audit context', async () => {
      const trailRecord = jest.fn().mockResolvedValue({} as AuditLogEntity);
      const service = new AuthEventsService(buildAuditTrail(trailRecord));

      await service.record('auth.signup', { ...FULL_CONTEXT, requestId: 'req-abc' });

      expect(trailRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          ctx: expect.objectContaining({ requestId: 'req-abc' }),
        }),
      );
    });
  });
});
