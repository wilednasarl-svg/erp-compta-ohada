import type { DataSource } from 'typeorm';

import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import type {
  AuditContext,
  AuditTrailService,
} from '../../audit/services/audit-trail.service';
import type { OrganizationAccountEntity } from '../entities/organization-account.entity';
import type { OrganizationAccountRepository } from '../repositories/organization-account.repository';
import { ChartOfAccountsService } from './chart-of-accounts.service';

const ORG_ID = 'org-1';
const ACTOR_ID = 'user-actor';
const CTX: AuditContext = { ipAddress: '203.0.113.1', userAgent: 'jest/1.0' };

function buildAccount(
  overrides: Partial<OrganizationAccountEntity> = {},
): OrganizationAccountEntity {
  return {
    id: 'acc-1',
    organizationId: ORG_ID,
    code: '4111',
    label: 'Clients',
    class: 4,
    accountType: 'POSTING',
    normalBalance: 'D',
    parentId: 'acc-parent',
    referenceAccountId: 'ref-4111',
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as OrganizationAccountEntity;
}

interface Harness {
  service: ChartOfAccountsService;
  findById: jest.Mock;
  findByCode: jest.Mock;
  listByOrganization: jest.Mock;
  countChildren: jest.Mock;
  create: jest.Mock;
  updateLabelAndActive: jest.Mock;
  setAccountType: jest.Mock;
  deleteCustom: jest.Mock;
  record: jest.Mock;
}

function buildHarness(): Harness {
  const findById = jest.fn();
  const findByCode = jest.fn();
  const listByOrganization = jest.fn();
  const countChildren = jest.fn();
  const create = jest.fn();
  const updateLabelAndActive = jest.fn();
  const setAccountType = jest.fn();
  const deleteCustom = jest.fn();
  const record = jest.fn().mockResolvedValue(null);

  const accounts = {
    findById,
    findByCode,
    listByOrganization,
    countChildren,
    create,
    updateLabelAndActive,
    setAccountType,
    deleteCustom,
  } as unknown as OrganizationAccountRepository;
  const audit = { record } as unknown as AuditTrailService;
  const dataSource = {} as DataSource;

  return {
    service: new ChartOfAccountsService(accounts, audit, dataSource),
    findById,
    findByCode,
    listByOrganization,
    countChildren,
    create,
    updateLabelAndActive,
    setAccountType,
    deleteCustom,
    record,
  };
}

describe('ChartOfAccountsService (BE-PC-06)', () => {
  describe('listForOrganization', () => {
    it('projects rows into AccountView and flags custom accounts via referenceAccountId=null', async () => {
      const h = buildHarness();
      h.listByOrganization.mockResolvedValue([
        buildAccount({ id: 'r-1', code: '40', referenceAccountId: 'ref-40' }),
        buildAccount({ id: 'c-1', code: '41100001', referenceAccountId: null }),
      ]);

      const result = await h.service.listForOrganization(ORG_ID);

      expect(result).toEqual([
        expect.objectContaining({ id: 'r-1', code: '40', isCustom: false }),
        expect.objectContaining({ id: 'c-1', code: '41100001', isCustom: true }),
      ]);
      expect(h.listByOrganization).toHaveBeenCalledWith(ORG_ID, {});
    });

    it('forwards activeOnly + classFilter to the repository', async () => {
      const h = buildHarness();
      h.listByOrganization.mockResolvedValue([]);
      await h.service.listForOrganization(ORG_ID, { activeOnly: true, classFilter: 6 });
      expect(h.listByOrganization).toHaveBeenCalledWith(ORG_ID, {
        activeOnly: true,
        classFilter: 6,
      });
    });
  });

  describe('getAccount', () => {
    it('returns the projected view on a hit', async () => {
      const h = buildHarness();
      h.findById.mockResolvedValue(buildAccount());
      const view = await h.service.getAccount(ORG_ID, 'acc-1');
      expect(view.code).toBe('4111');
    });

    it('throws CHART_ACCOUNT_NOT_FOUND on a miss (404)', async () => {
      const h = buildHarness();
      h.findById.mockResolvedValue(null);
      await expect(h.service.getAccount(ORG_ID, 'ghost')).rejects.toMatchObject({
        code: ERROR_CODES.CHART_ACCOUNT_NOT_FOUND,
        status: 404,
      });
    });
  });

  describe('createCustomAccount — invariants', () => {
    it('rejects a non-numeric or wrong-length code with CHART_ACCOUNT_INVALID_CODE (422)', async () => {
      const h = buildHarness();
      await expect(
        h.service.createCustomAccount(
          ORG_ID,
          { parentCode: '411', code: '411A', label: 'x' },
          ACTOR_ID,
          CTX,
        ),
      ).rejects.toMatchObject({ code: ERROR_CODES.CHART_ACCOUNT_INVALID_CODE, status: 422 });

      await expect(
        h.service.createCustomAccount(
          ORG_ID,
          { parentCode: '4', code: '12345678901', label: 'x' },
          ACTOR_ID,
          CTX,
        ),
      ).rejects.toMatchObject({ code: ERROR_CODES.CHART_ACCOUNT_INVALID_CODE, status: 422 });
    });

    it('rejects a code that does not prefix-match parent (422)', async () => {
      const h = buildHarness();
      await expect(
        h.service.createCustomAccount(
          ORG_ID,
          { parentCode: '411', code: '52000001', label: 'x' },
          ACTOR_ID,
          CTX,
        ),
      ).rejects.toMatchObject({ code: ERROR_CODES.CHART_ACCOUNT_INVALID_PARENT, status: 422 });
    });

    it('rejects a code equal to or shorter than the parent code (422)', async () => {
      const h = buildHarness();
      await expect(
        h.service.createCustomAccount(
          ORG_ID,
          { parentCode: '411', code: '411', label: 'x' },
          ACTOR_ID,
          CTX,
        ),
      ).rejects.toMatchObject({ code: ERROR_CODES.CHART_ACCOUNT_INVALID_PARENT });
    });

    it('rejects when parent is missing (422)', async () => {
      const h = buildHarness();
      h.findByCode.mockResolvedValueOnce(null); // parent lookup
      await expect(
        h.service.createCustomAccount(
          ORG_ID,
          { parentCode: '411', code: '41100001', label: 'x' },
          ACTOR_ID,
          CTX,
        ),
      ).rejects.toMatchObject({ code: ERROR_CODES.CHART_ACCOUNT_INVALID_PARENT });
    });

    it('rejects when parent is inactive (422)', async () => {
      const h = buildHarness();
      h.findByCode.mockResolvedValueOnce(buildAccount({ code: '411', isActive: false }));
      await expect(
        h.service.createCustomAccount(
          ORG_ID,
          { parentCode: '411', code: '41100001', label: 'x' },
          ACTOR_ID,
          CTX,
        ),
      ).rejects.toMatchObject({ code: ERROR_CODES.CHART_ACCOUNT_INVALID_PARENT });
    });

    it('rejects when the target code already exists in the org (409)', async () => {
      const h = buildHarness();
      h.findByCode
        .mockResolvedValueOnce(buildAccount({ code: '411', accountType: 'TITLE' })) // parent
        .mockResolvedValueOnce(buildAccount({ code: '41100001' })); // existing collision
      await expect(
        h.service.createCustomAccount(
          ORG_ID,
          { parentCode: '411', code: '41100001', label: 'x' },
          ACTOR_ID,
          CTX,
        ),
      ).rejects.toMatchObject({ code: ERROR_CODES.CHART_ACCOUNT_CODE_TAKEN, status: 409 });
    });

    it('happy path: creates a POSTING under a TITLE parent, inherits class+sens, emits account_created', async () => {
      const h = buildHarness();
      const parent = buildAccount({
        id: 'p-411',
        code: '411',
        class: 4,
        accountType: 'TITLE',
        normalBalance: 'D',
      });
      const created = buildAccount({
        id: 'c-new',
        code: '41100001',
        label: 'Client SOTRA',
        parentId: 'p-411',
        referenceAccountId: null,
      });
      h.findByCode.mockResolvedValueOnce(parent).mockResolvedValueOnce(null);
      h.create.mockResolvedValue(created);

      const view = await h.service.createCustomAccount(
        ORG_ID,
        { parentCode: '411', code: '41100001', label: 'Client SOTRA' },
        ACTOR_ID,
        CTX,
      );

      expect(h.create).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: ORG_ID,
          code: '41100001',
          label: 'Client SOTRA',
          class: 4,
          accountType: 'POSTING',
          normalBalance: 'D',
          parentId: 'p-411',
          referenceAccountId: null,
        }),
      );
      // Parent was already TITLE → no promotion event.
      expect(h.setAccountType).not.toHaveBeenCalled();
      // One audit event: account_created.
      expect(h.record).toHaveBeenCalledTimes(1);
      expect(h.record.mock.calls[0][0]).toMatchObject({
        module: 'chart_of_accounts',
        action: 'account_created',
        entityType: 'organization_account',
        entityId: 'c-new',
        after: expect.objectContaining({ code: '41100001', label: 'Client SOTRA' }),
        legacyEventType: 'chart_of_accounts.account_created',
      });
      expect(view).toMatchObject({ id: 'c-new', code: '41100001', isCustom: true });
    });

    it('promotes a POSTING parent to TITLE when it gains its first child, emits both events', async () => {
      const h = buildHarness();
      const parent = buildAccount({
        id: 'p-4111',
        code: '4111',
        class: 4,
        accountType: 'POSTING',
        normalBalance: 'D',
      });
      const created = buildAccount({
        id: 'c-new',
        code: '411100',
        parentId: 'p-4111',
        referenceAccountId: null,
      });
      h.findByCode.mockResolvedValueOnce(parent).mockResolvedValueOnce(null);
      h.create.mockResolvedValue(created);

      await h.service.createCustomAccount(
        ORG_ID,
        { parentCode: '4111', code: '411100', label: 'Sub' },
        ACTOR_ID,
        CTX,
      );

      expect(h.setAccountType).toHaveBeenCalledWith('p-4111', ORG_ID, 'TITLE');
      // Two audit events: the promotion + the creation.
      expect(h.record).toHaveBeenCalledTimes(2);
      const actions = h.record.mock.calls.map(
        (c) => (c[0] as { module: string; action: string }).action,
      );
      expect(actions).toEqual(expect.arrayContaining(['account_updated', 'account_created']));
      // The promotion call carries the structured before/after diff.
      const promotion = h.record.mock.calls.find(
        (c) => (c[0] as { action: string }).action === 'account_updated',
      );
      expect(promotion?.[0]).toMatchObject({
        entityId: 'p-4111',
        before: { accountType: 'POSTING' },
        after: { accountType: 'TITLE' },
        metadata: expect.objectContaining({ reason: 'first_child_added' }),
      });
    });
  });

  describe('updateAccount', () => {
    it('rejects attempts to modify the code with CHART_ACCOUNT_IMMUTABLE_CODE (422)', async () => {
      const h = buildHarness();
      await expect(
        h.service.updateAccount(ORG_ID, 'acc-1', { code: '9999' }, ACTOR_ID, CTX),
      ).rejects.toMatchObject({ code: ERROR_CODES.CHART_ACCOUNT_IMMUTABLE_CODE, status: 422 });
      expect(h.updateLabelAndActive).not.toHaveBeenCalled();
    });

    it('returns 404 when the account does not exist in the org', async () => {
      const h = buildHarness();
      h.findById.mockResolvedValue(null);
      await expect(
        h.service.updateAccount(ORG_ID, 'ghost', { label: 'x' }, ACTOR_ID, CTX),
      ).rejects.toMatchObject({ code: ERROR_CODES.CHART_ACCOUNT_NOT_FOUND });
    });

    it('is a silent no-op when label and isActive match the current state (no audit noise)', async () => {
      const h = buildHarness();
      const current = buildAccount({ label: 'L', isActive: true });
      h.findById.mockResolvedValue(current);
      const view = await h.service.updateAccount(
        ORG_ID,
        'acc-1',
        { label: 'L', isActive: true },
        ACTOR_ID,
        CTX,
      );
      expect(h.updateLabelAndActive).not.toHaveBeenCalled();
      expect(h.record).not.toHaveBeenCalled();
      expect(view.label).toBe('L');
    });

    it('updates the label and emits account_updated', async () => {
      const h = buildHarness();
      const current = buildAccount({ label: 'Old' });
      const refreshed = buildAccount({ label: 'New' });
      h.findById.mockResolvedValueOnce(current).mockResolvedValueOnce(refreshed);
      await h.service.updateAccount(ORG_ID, 'acc-1', { label: 'New' }, ACTOR_ID, CTX);

      expect(h.updateLabelAndActive).toHaveBeenCalledWith('acc-1', ORG_ID, {
        label: 'New',
        isActive: undefined,
      });
      expect(h.record.mock.calls[0][0]).toMatchObject({
        module: 'chart_of_accounts',
        action: 'account_updated',
        entityType: 'organization_account',
        entityId: 'acc-1',
        before: { label: 'Old' },
        after: { label: 'New' },
        legacyEventType: 'chart_of_accounts.account_updated',
      });
    });

    it('emits account_deactivated with a before/after diff when isActive flips false', async () => {
      const h = buildHarness();
      const current = buildAccount({ isActive: true });
      const refreshed = buildAccount({ isActive: false });
      h.findById.mockResolvedValueOnce(current).mockResolvedValueOnce(refreshed);
      await h.service.updateAccount(ORG_ID, 'acc-1', { isActive: false }, ACTOR_ID, CTX);
      expect(h.record.mock.calls[0][0]).toMatchObject({
        module: 'chart_of_accounts',
        action: 'account_deactivated',
        entityType: 'organization_account',
        entityId: 'acc-1',
        before: { isActive: true },
        after: { isActive: false },
      });
    });
  });

  describe('deleteAccount', () => {
    it('returns 404 when the account does not exist', async () => {
      const h = buildHarness();
      h.findById.mockResolvedValue(null);
      await expect(h.service.deleteAccount(ORG_ID, 'ghost', ACTOR_ID, CTX)).rejects.toMatchObject({
        code: ERROR_CODES.CHART_ACCOUNT_NOT_FOUND,
      });
    });

    it('refuses to delete a reference-backed account (409 NOT_DELETABLE)', async () => {
      const h = buildHarness();
      h.findById.mockResolvedValue(buildAccount({ referenceAccountId: 'ref-4111' }));
      await expect(h.service.deleteAccount(ORG_ID, 'acc-1', ACTOR_ID, CTX)).rejects.toMatchObject({
        code: ERROR_CODES.CHART_ACCOUNT_NOT_DELETABLE,
        status: 409,
      });
      expect(h.deleteCustom).not.toHaveBeenCalled();
    });

    it('refuses to delete a custom account with active children (409 NOT_DELETABLE)', async () => {
      const h = buildHarness();
      h.findById.mockResolvedValue(buildAccount({ referenceAccountId: null }));
      h.countChildren.mockResolvedValue(2);
      await expect(h.service.deleteAccount(ORG_ID, 'acc-1', ACTOR_ID, CTX)).rejects.toMatchObject({
        code: ERROR_CODES.CHART_ACCOUNT_NOT_DELETABLE,
      });
      expect(h.deleteCustom).not.toHaveBeenCalled();
    });

    it('deletes a custom leaf and emits account_deleted with the pre-delete snapshot in before', async () => {
      const h = buildHarness();
      const target = buildAccount({ id: 'acc-1', referenceAccountId: null, code: '41100001' });
      h.findById.mockResolvedValue(target);
      h.countChildren.mockResolvedValue(0);
      h.deleteCustom.mockResolvedValue(1);

      await h.service.deleteAccount(ORG_ID, 'acc-1', ACTOR_ID, CTX);

      expect(h.deleteCustom).toHaveBeenCalledWith('acc-1', ORG_ID);
      expect(h.record).toHaveBeenCalledTimes(1);
      expect(h.record.mock.calls[0][0]).toMatchObject({
        module: 'chart_of_accounts',
        action: 'account_deleted',
        entityType: 'organization_account',
        entityId: 'acc-1',
        before: expect.objectContaining({ code: '41100001' }),
        after: null,
        // The pre-Module-7 reader still groups deletes under
        // `chart_of_accounts.account_updated` for now (vague 2 will
        // surface `account_deleted` once the legacy view ranges over it).
        legacyEventType: 'chart_of_accounts.account_updated',
      });
    });

    it('maps a 0-affected delete (race / guarded by SQL filter) to CHART_ACCOUNT_NOT_DELETABLE', async () => {
      const h = buildHarness();
      h.findById.mockResolvedValue(buildAccount({ referenceAccountId: null }));
      h.countChildren.mockResolvedValue(0);
      h.deleteCustom.mockResolvedValue(0);
      await expect(h.service.deleteAccount(ORG_ID, 'acc-1', ACTOR_ID, CTX)).rejects.toMatchObject({
        code: ERROR_CODES.CHART_ACCOUNT_NOT_DELETABLE,
      });
    });
  });

  it('all surface errors are AppException instances', async () => {
    const h = buildHarness();
    h.findById.mockResolvedValue(null);
    try {
      await h.service.getAccount(ORG_ID, 'ghost');
      fail('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(AppException);
    }
  });
});
