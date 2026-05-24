import type { AuditLogEntity } from '../entities/audit-log.entity';
import type { AuditLogRepository } from '../repositories/audit-log.repository';
import { AuditTrailService, type AuditContext } from './audit-trail.service';

function buildRepo(record: jest.Mock): AuditLogRepository {
  return { record } as unknown as AuditLogRepository;
}

const CTX_FULL: AuditContext = {
  ipAddress: '203.0.113.9',
  userAgent: 'Mozilla/5.0',
  userId: 'u_1',
  organizationId: 'o_1',
  requestId: 'req-42',
};

describe('AuditTrailService (BE-AUDIT-12)', () => {
  it('records a fully-populated event with structured before/after and an entity reference', async () => {
    const saved = { id: 'log_1' } as AuditLogEntity;
    const repoRecord = jest.fn().mockResolvedValue(saved);
    const service = new AuditTrailService(buildRepo(repoRecord));

    const result = await service.record({
      module: 'chart_of_accounts',
      action: 'account_updated',
      entityType: 'organization_account',
      entityId: 'acc-7',
      before: { label: 'Old' },
      after: { label: 'New' },
      metadata: { reason: 'rename' },
      ctx: CTX_FULL,
    });

    expect(result).toBe(saved);
    expect(repoRecord).toHaveBeenCalledWith({
      module: 'chart_of_accounts',
      action: 'account_updated',
      userId: 'u_1',
      organizationId: 'o_1',
      entityType: 'organization_account',
      entityId: 'acc-7',
      before: { label: 'Old' },
      after: { label: 'New' },
      ipAddress: '203.0.113.9',
      userAgent: 'Mozilla/5.0',
      requestId: 'req-42',
      metadata: { reason: 'rename' },
      legacyEventType: undefined,
    });
  });

  it('forwards an explicit legacyEventType override (used by AuthEventsService)', async () => {
    const repoRecord = jest.fn().mockResolvedValue({} as AuditLogEntity);
    const service = new AuditTrailService(buildRepo(repoRecord));

    await service.record({
      module: 'auth',
      action: 'login_success',
      legacyEventType: 'auth.login_success',
      ctx: CTX_FULL,
    });

    expect(repoRecord).toHaveBeenCalledWith(
      expect.objectContaining({ legacyEventType: 'auth.login_success' }),
    );
  });

  it('defaults missing optional fields to null (tenant-less events, no entity, no diff)', async () => {
    const repoRecord = jest.fn().mockResolvedValue({} as AuditLogEntity);
    const service = new AuditTrailService(buildRepo(repoRecord));

    await service.record({
      module: 'auth',
      action: 'login_failed',
      ctx: { ipAddress: '198.51.100.4', userAgent: 'curl/8.0' },
    });

    expect(repoRecord).toHaveBeenCalledWith({
      module: 'auth',
      action: 'login_failed',
      userId: null,
      organizationId: null,
      entityType: null,
      entityId: null,
      before: null,
      after: null,
      ipAddress: '198.51.100.4',
      userAgent: 'curl/8.0',
      requestId: null,
      metadata: {},
      legacyEventType: undefined,
    });
  });

  it('swallows repository failures and returns null (audit must never brick business actions)', async () => {
    const repoRecord = jest.fn().mockRejectedValue(new Error('connection lost'));
    const service = new AuditTrailService(buildRepo(repoRecord));
    const warnSpy = jest
      .spyOn(service['logger'], 'warn')
      .mockImplementation(() => undefined as void);

    const result = await service.record({
      module: 'chart_of_accounts',
      action: 'account_created',
      ctx: CTX_FULL,
    });

    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("failed to persist 'chart_of_accounts.account_created' audit log"),
    );
  });

  it('also swallows non-Error throws (raw strings from buggy mocks)', async () => {
    const repoRecord = jest.fn().mockRejectedValue('boom');
    const service = new AuditTrailService(buildRepo(repoRecord));
    jest.spyOn(service['logger'], 'warn').mockImplementation(() => undefined as void);

    await expect(
      service.record({
        module: 'imports',
        action: 'session_created',
        ctx: CTX_FULL,
      }),
    ).resolves.toBeNull();
  });
});
