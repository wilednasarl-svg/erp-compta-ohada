import type { Repository } from 'typeorm';

import { type MembershipEntity } from '../entities/membership.entity';
import { MembershipRepository } from './membership.repository';

/**
 * Architectural guardrail for BE-DB-11: `memberships` carries
 * `organization_id`, so every public method of `MembershipRepository`
 * MUST require a non-empty `organizationId` parameter at runtime. The
 * one documented exception is `listOrganizationsForUser`, which is
 * scoped by `userId` and used by login *before* an org is selected.
 *
 * These tests do NOT exercise SQL. They only assert that the tenant
 * scope guard rejects empty values without ever calling the underlying
 * `Repository<MembershipEntity>` — proving that a missing scope fails
 * fast at the boundary instead of running an unscoped query.
 */
describe('MembershipRepository — multi-tenant invariant', () => {
  function buildRepo(): {
    repo: MembershipRepository;
    inner: jest.Mocked<
      Pick<
        Repository<MembershipEntity>,
        'find' | 'findOne' | 'count' | 'create' | 'save' | 'update' | 'delete'
      >
    >;
  } {
    const inner = {
      find: jest.fn(),
      findOne: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    } as unknown as jest.Mocked<
      Pick<
        Repository<MembershipEntity>,
        'find' | 'findOne' | 'count' | 'create' | 'save' | 'update' | 'delete'
      >
    >;
    const repo = new MembershipRepository(inner as unknown as Repository<MembershipEntity>);
    return { repo, inner };
  }

  it.each([
    [
      'findActiveByUserAndOrganization',
      (r: MembershipRepository) => r.findActiveByUserAndOrganization('user-1', ''),
    ],
    [
      'findByUserAndOrganization',
      (r: MembershipRepository) => r.findByUserAndOrganization('user-1', ''),
    ],
    ['listActiveByOrganization', (r: MembershipRepository) => r.listActiveByOrganization('')],
    [
      'countActiveAdminsForOrganization',
      (r: MembershipRepository) => r.countActiveAdminsForOrganization('', 'role-id'),
    ],
    [
      'create',
      (r: MembershipRepository) =>
        r.create({ userId: 'user-1', organizationId: '', roleId: 'role-id' }),
    ],
    ['updateRole', (r: MembershipRepository) => r.updateRole('user-1', '', 'role-id')],
    ['updateStatus', (r: MembershipRepository) => r.updateStatus('user-1', '', 'active')],
    ['remove', (r: MembershipRepository) => r.remove('user-1', '')],
  ])('%s rejects an empty organizationId before touching the DB', async (_name, call) => {
    const { repo, inner } = buildRepo();
    await expect(call(repo)).rejects.toThrow(/Tenant scope violation/);
    expect(inner.find).not.toHaveBeenCalled();
    expect(inner.findOne).not.toHaveBeenCalled();
    expect(inner.count).not.toHaveBeenCalled();
    expect(inner.save).not.toHaveBeenCalled();
    expect(inner.update).not.toHaveBeenCalled();
    expect(inner.delete).not.toHaveBeenCalled();
  });

  it('listOrganizationsForUser is the documented exception (no organizationId required)', async () => {
    const { repo, inner } = buildRepo();
    inner.find.mockResolvedValue([]);
    await expect(repo.listOrganizationsForUser('user-1')).resolves.toEqual([]);
    expect(inner.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user-1', status: 'active' },
      }),
    );
  });
});
