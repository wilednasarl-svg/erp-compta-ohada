import type { Repository } from 'typeorm';

import type { OrganizationAccountEntity } from '../entities/organization-account.entity';
import { OrganizationAccountRepository } from './organization-account.repository';

/**
 * `OrganizationAccountRepository` unit tests (Module 2 audit HIGH-5).
 *
 * Covers:
 *   - Tenant scope guard: every public method refuses an empty
 *     organizationId BEFORE touching the inner Repository.
 *   - `deleteCustom` returns 0 on a reference-backed row (the SQL guard
 *     `reference_account_id IS NULL` prevents the delete).
 *   - `existsAnyByCodePrefix` strict-descendant semantics + LIKE
 *     wildcard escape for `%`, `_`, and backslash.
 *   - `updateLabelAndActive` no-op on an empty patch (no DB call).
 *   - `countChildren` activeOnly filter.
 */
describe('OrganizationAccountRepository', () => {
  interface QbStub {
    where: jest.Mock;
    andWhere: jest.Mock;
    getCount: jest.Mock;
    delete: jest.Mock;
    from: jest.Mock;
    execute: jest.Mock;
  }

  function buildQb(overrides: Partial<QbStub> = {}): QbStub {
    const qb: QbStub = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getCount: jest.fn().mockResolvedValue(0),
      delete: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ affected: 0 }),
      ...overrides,
    };
    return qb;
  }

  function buildHarness(qbOverrides: Partial<QbStub> = {}): {
    repo: OrganizationAccountRepository;
    inner: jest.Mocked<
      Pick<
        Repository<OrganizationAccountEntity>,
        'findOne' | 'find' | 'count' | 'create' | 'save' | 'update' | 'createQueryBuilder'
      >
    >;
    qb: QbStub;
  } {
    const qb = buildQb(qbOverrides);
    const inner = {
      findOne: jest.fn().mockResolvedValue(null),
      find: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockImplementation((x) => x as OrganizationAccountEntity),
      save: jest.fn().mockImplementation((x) => Promise.resolve(x as OrganizationAccountEntity)),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      createQueryBuilder: jest.fn().mockReturnValue(qb),
    } as unknown as jest.Mocked<
      Pick<
        Repository<OrganizationAccountEntity>,
        'findOne' | 'find' | 'count' | 'create' | 'save' | 'update' | 'createQueryBuilder'
      >
    >;
    const repo = new OrganizationAccountRepository(
      inner as unknown as Repository<OrganizationAccountEntity>,
    );
    return { repo, inner, qb };
  }

  // ─── Tenant scope guard ────────────────────────────────────────────

  it.each([
    ['findById', (r: OrganizationAccountRepository) => r.findById('acc-1', '')],
    ['findByCode', (r: OrganizationAccountRepository) => r.findByCode('411', '')],
    ['listByOrganization', (r: OrganizationAccountRepository) => r.listByOrganization('')],
    ['countChildren', (r: OrganizationAccountRepository) => r.countChildren('parent', '')],
    [
      'existsAnyByCodePrefix',
      (r: OrganizationAccountRepository) => r.existsAnyByCodePrefix('41', ''),
    ],
    [
      'create',
      (r: OrganizationAccountRepository) =>
        r.create({
          organizationId: '',
          code: '411',
          label: 'Clients',
          class: 4,
          accountType: 'POSTING',
          normalBalance: 'D',
          parentId: null,
          referenceAccountId: null,
        }),
    ],
    [
      'updateLabelAndActive',
      (r: OrganizationAccountRepository) => r.updateLabelAndActive('acc-1', '', { label: 'X' }),
    ],
    [
      'setAccountType',
      (r: OrganizationAccountRepository) => r.setAccountType('acc-1', '', 'TITLE'),
    ],
    ['deleteCustom', (r: OrganizationAccountRepository) => r.deleteCustom('acc-1', '')],
    ['countCustom', (r: OrganizationAccountRepository) => r.countCustom('')],
  ])('%s refuses an empty organizationId before touching the inner repo', async (_name, call) => {
    const { repo, inner } = buildHarness();
    await expect(call(repo)).rejects.toThrow(/Tenant scope violation/);
    expect(inner.findOne).not.toHaveBeenCalled();
    expect(inner.find).not.toHaveBeenCalled();
    expect(inner.count).not.toHaveBeenCalled();
    expect(inner.save).not.toHaveBeenCalled();
    expect(inner.update).not.toHaveBeenCalled();
    expect(inner.createQueryBuilder).not.toHaveBeenCalled();
  });

  // ─── deleteCustom safety net ───────────────────────────────────────

  describe('deleteCustom', () => {
    it('returns 0 when the SQL guard rejects a reference-backed row', async () => {
      const { repo, qb } = buildHarness({
        execute: jest.fn().mockResolvedValue({ affected: 0 }),
      });
      const affected = await repo.deleteCustom('acc-ref', 'org-1');
      expect(affected).toBe(0);
      // Confirm the SQL guard `reference_account_id IS NULL` was applied.
      const calls = qb.andWhere.mock.calls.map((c) => c[0] as string);
      expect(calls.some((s) => s.includes('reference_account_id IS NULL'))).toBe(true);
    });

    it('returns the affected row count on a successful delete', async () => {
      const { repo } = buildHarness({
        execute: jest.fn().mockResolvedValue({ affected: 1 }),
      });
      const affected = await repo.deleteCustom('acc-custom', 'org-1');
      expect(affected).toBe(1);
    });

    it('returns 0 when affected is undefined in the driver response', async () => {
      const { repo } = buildHarness({
        execute: jest.fn().mockResolvedValue({}),
      });
      const affected = await repo.deleteCustom('acc-x', 'org-1');
      expect(affected).toBe(0);
    });
  });

  // ─── existsAnyByCodePrefix ─────────────────────────────────────────

  describe('existsAnyByCodePrefix', () => {
    it('builds a strict-descendant LIKE pattern (prefix + `_%`)', async () => {
      const { repo, qb } = buildHarness({ getCount: jest.fn().mockResolvedValue(1) });
      const found = await repo.existsAnyByCodePrefix('41', 'org-1');
      expect(found).toBe(true);
      const params = qb.andWhere.mock.calls[0]?.[1] as { prefix: string };
      expect(params.prefix).toBe('41_%');
    });

    it('returns false when no descendant exists (count = 0)', async () => {
      const { repo } = buildHarness({ getCount: jest.fn().mockResolvedValue(0) });
      const found = await repo.existsAnyByCodePrefix('999', 'org-1');
      expect(found).toBe(false);
    });

    it('escapes LIKE wildcards `%`, `_`, and backslash in the prefix', async () => {
      const { repo, qb } = buildHarness();
      await repo.existsAnyByCodePrefix('4_1%\\', 'org-1');
      const params = qb.andWhere.mock.calls[0]?.[1] as { prefix: string };
      // Expect every wildcard char to be preceded by a backslash escape.
      expect(params.prefix).toBe('4\\_1\\%\\\\_%');
    });

    it('passes ESCAPE \\ to the SQL so the escape backslash is interpreted', async () => {
      const { repo, qb } = buildHarness();
      await repo.existsAnyByCodePrefix('41', 'org-1');
      const sql = qb.andWhere.mock.calls[0]?.[0] as string;
      expect(sql).toContain("ESCAPE '\\'");
    });
  });

  // ─── updateLabelAndActive ──────────────────────────────────────────

  describe('updateLabelAndActive', () => {
    it('is a no-op when the patch has no fields (no DB call)', async () => {
      const { repo, inner } = buildHarness();
      await repo.updateLabelAndActive('acc-1', 'org-1', {});
      expect(inner.update).not.toHaveBeenCalled();
    });

    it('updates only the label when isActive is omitted', async () => {
      const { repo, inner } = buildHarness();
      await repo.updateLabelAndActive('acc-1', 'org-1', { label: 'New' });
      expect(inner.update).toHaveBeenCalledWith(
        { id: 'acc-1', organizationId: 'org-1' },
        { label: 'New' },
      );
    });

    it('updates only isActive when the label is omitted', async () => {
      const { repo, inner } = buildHarness();
      await repo.updateLabelAndActive('acc-1', 'org-1', { isActive: false });
      expect(inner.update).toHaveBeenCalledWith(
        { id: 'acc-1', organizationId: 'org-1' },
        { isActive: false },
      );
    });
  });

  // ─── countChildren ─────────────────────────────────────────────────

  describe('countChildren', () => {
    it('does not include isActive in the where clause when activeOnly is false', async () => {
      const { repo, inner } = buildHarness();
      await repo.countChildren('parent', 'org-1');
      const where = inner.count.mock.calls[0]?.[0]?.where as Record<string, unknown>;
      expect(where['isActive']).toBeUndefined();
    });

    it('adds isActive=true to the where clause when activeOnly is true', async () => {
      const { repo, inner } = buildHarness();
      await repo.countChildren('parent', 'org-1', { activeOnly: true });
      const where = inner.count.mock.calls[0]?.[0]?.where as Record<string, unknown>;
      expect(where['isActive']).toBe(true);
    });
  });
});
