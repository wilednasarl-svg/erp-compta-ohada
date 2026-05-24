import type { AuditLogEntity } from '../entities/audit-log.entity';
import type { AuditLogRepository } from '../repositories/audit-log.repository';
import { AuditLogsController } from './audit-logs.controller';
import { ListAuditLogsQueryDto } from '../dto/list-audit-logs-query.dto';

const ORG_ID = '00000000-0000-4000-8000-000000000001';

function buildLog(overrides: Partial<AuditLogEntity> = {}): AuditLogEntity {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    module: 'chart_of_accounts',
    action: 'account_updated',
    eventType: 'chart_of_accounts.account_updated',
    userId: '22222222-2222-4222-8222-222222222222',
    organizationId: ORG_ID,
    entityType: 'organization_account',
    entityId: '33333333-3333-4333-8333-333333333333',
    before: { label: 'Old' },
    after: { label: 'New' },
    metadata: { code: '411' },
    ipAddress: '203.0.113.10',
    userAgent: 'jest/1.0',
    requestId: 'req-1',
    createdAt: new Date('2026-01-15T10:00:00.000Z'),
    ...overrides,
  } as AuditLogEntity;
}

interface Harness {
  controller: AuditLogsController;
  list: jest.Mock;
  count: jest.Mock;
}

function buildHarness(): Harness {
  const list = jest.fn();
  const count = jest.fn();
  const repo = { list, count } as unknown as AuditLogRepository;
  return { controller: new AuditLogsController(repo), list, count };
}

function buildQuery(overrides: Partial<ListAuditLogsQueryDto> = {}): ListAuditLogsQueryDto {
  const q = new ListAuditLogsQueryDto();
  q.limit = 50;
  q.offset = 0;
  Object.assign(q, overrides);
  return q;
}

describe('AuditLogsController (BE-AUDIT-20)', () => {
  describe('list', () => {
    it('returns the projected view + pagination envelope', async () => {
      const h = buildHarness();
      h.list.mockResolvedValue([buildLog()]);
      h.count.mockResolvedValue(1);

      const result = await h.controller.list(ORG_ID, buildQuery());

      expect(result.pagination).toEqual({ limit: 50, offset: 0, total: 1 });
      expect(result.logs).toHaveLength(1);
      expect(result.logs[0]).toMatchObject({
        module: 'chart_of_accounts',
        action: 'account_updated',
        eventType: 'chart_of_accounts.account_updated',
        before: { label: 'Old' },
        after: { label: 'New' },
        createdAt: '2026-01-15T10:00:00.000Z',
      });
    });

    it('passes filters through to the repository and scopes by tenant', async () => {
      const h = buildHarness();
      h.list.mockResolvedValue([]);
      h.count.mockResolvedValue(0);

      const from = new Date('2026-01-01T00:00:00.000Z');
      const to = new Date('2026-02-01T00:00:00.000Z');
      await h.controller.list(
        ORG_ID,
        buildQuery({
          module: 'chart_of_accounts',
          action: 'account_updated',
          entityType: 'organization_account',
          entityId: '33333333-3333-4333-8333-333333333333',
          userId: '22222222-2222-4222-8222-222222222222',
          from,
          to,
          limit: 25,
          offset: 50,
        }),
      );

      expect(h.list).toHaveBeenCalledWith({
        organizationId: ORG_ID,
        module: 'chart_of_accounts',
        action: 'account_updated',
        entityType: 'organization_account',
        entityId: '33333333-3333-4333-8333-333333333333',
        userId: '22222222-2222-4222-8222-222222222222',
        from,
        to,
        limit: 25,
        offset: 50,
      });
      expect(h.count).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: ORG_ID,
          module: 'chart_of_accounts',
          action: 'account_updated',
        }),
      );
    });

    it('rejects a missing tenant context with ORG_NOT_FOUND (defence-in-depth past TenantGuard)', async () => {
      const h = buildHarness();
      await expect(h.controller.list(undefined, buildQuery())).rejects.toMatchObject({
        code: 'ORG_NOT_FOUND',
      });
      expect(h.list).not.toHaveBeenCalled();
    });

    it('returns an empty page when from > to instead of erroring (idempotent for dashboards)', async () => {
      const h = buildHarness();
      const result = await h.controller.list(
        ORG_ID,
        buildQuery({
          from: new Date('2026-02-01'),
          to: new Date('2026-01-01'),
        }),
      );
      expect(result.logs).toEqual([]);
      expect(result.pagination.total).toBe(0);
      expect(h.list).not.toHaveBeenCalled();
      expect(h.count).not.toHaveBeenCalled();
    });
  });
});
