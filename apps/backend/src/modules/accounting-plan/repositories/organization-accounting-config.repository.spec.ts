import type { EntityManager, Repository } from 'typeorm';

import type { OrganizationAccountingConfigEntity } from '../entities/organization-accounting-config.entity';
import { OrganizationAccountingConfigRepository } from './organization-accounting-config.repository';

/**
 * `OrganizationAccountingConfigRepository` unit tests (Module 2 audit
 * HIGH-5). Same tenant-scope invariant as the rest of Module 2 repos +
 * coverage of the `EntityManager` join path used by the transactional
 * org creation flow.
 */
describe('OrganizationAccountingConfigRepository', () => {
  function buildHarness(): {
    repo: OrganizationAccountingConfigRepository;
    inner: jest.Mocked<
      Pick<Repository<OrganizationAccountingConfigEntity>, 'findOne' | 'create' | 'save'>
    >;
  } {
    const inner = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation((x) => x as OrganizationAccountingConfigEntity),
      save: jest
        .fn()
        .mockImplementation((x) => Promise.resolve(x as OrganizationAccountingConfigEntity)),
    } as unknown as jest.Mocked<
      Pick<Repository<OrganizationAccountingConfigEntity>, 'findOne' | 'create' | 'save'>
    >;
    const repo = new OrganizationAccountingConfigRepository(
      inner as unknown as Repository<OrganizationAccountingConfigEntity>,
    );
    return { repo, inner };
  }

  it.each([
    [
      'findByOrganizationId',
      (r: OrganizationAccountingConfigRepository) => r.findByOrganizationId(''),
    ],
    [
      'create',
      (r: OrganizationAccountingConfigRepository) =>
        r.create({ organizationId: '', system: 'NORMAL' }),
    ],
  ])('%s refuses an empty organizationId before touching the inner repo', async (_name, call) => {
    const { repo, inner } = buildHarness();
    await expect(call(repo)).rejects.toThrow(/Tenant scope violation/);
    expect(inner.findOne).not.toHaveBeenCalled();
    expect(inner.save).not.toHaveBeenCalled();
  });

  it('findByOrganizationId scopes the query on organization_id', async () => {
    const { repo, inner } = buildHarness();
    await repo.findByOrganizationId('org-1');
    expect(inner.findOne).toHaveBeenCalledWith({ where: { organizationId: 'org-1' } });
  });

  it('create persists the config with the given system', async () => {
    const { repo, inner } = buildHarness();
    await repo.create({ organizationId: 'org-1', system: 'NORMAL' });
    expect(inner.create).toHaveBeenCalledWith({ organizationId: 'org-1', system: 'NORMAL' });
    expect(inner.save).toHaveBeenCalled();
  });

  it('create routes through the EntityManager when provided (transactional join)', async () => {
    const { repo, inner } = buildHarness();
    const managerRepo = {
      create: jest.fn().mockImplementation((x) => x as OrganizationAccountingConfigEntity),
      save: jest
        .fn()
        .mockImplementation((x) => Promise.resolve(x as OrganizationAccountingConfigEntity)),
    };
    const manager = {
      getRepository: jest.fn().mockReturnValue(managerRepo),
    } as unknown as EntityManager;

    await repo.create({ organizationId: 'org-1', system: 'NORMAL' }, manager);

    expect(manager.getRepository).toHaveBeenCalled();
    expect(managerRepo.save).toHaveBeenCalled();
    // The injected repository must stay untouched on this path.
    expect(inner.save).not.toHaveBeenCalled();
  });
});
