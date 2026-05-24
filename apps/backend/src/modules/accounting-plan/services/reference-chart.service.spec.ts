import type { ReferenceAccountRepository } from '../repositories/reference-account.repository';
import { ReferenceChartService } from './reference-chart.service';

function buildHarness(): {
  service: ReferenceChartService;
  listBySystem: jest.Mock;
} {
  const listBySystem = jest.fn();
  const repo = { listBySystem } as unknown as ReferenceAccountRepository;
  return { service: new ReferenceChartService(repo), listBySystem };
}

describe('ReferenceChartService (BE-PC-05)', () => {
  it('projects entity rows into the public ReferenceAccountView and preserves the repo order', async () => {
    const h = buildHarness();
    h.listBySystem.mockResolvedValue([
      {
        id: 'id-1',
        code: '40',
        label: 'Fournisseurs et comptes rattachés',
        class: 4,
        accountType: 'TITLE',
        normalBalance: 'C',
        applicableSystems: ['NORMAL', 'MINIMAL', 'ALLEGE'],
      },
      {
        id: 'id-2',
        code: '41',
        label: 'Clients et comptes rattachés',
        class: 4,
        accountType: 'TITLE',
        normalBalance: 'D',
        applicableSystems: ['NORMAL', 'MINIMAL', 'ALLEGE'],
      },
    ]);

    const result = await h.service.listBySystem('NORMAL');

    expect(h.listBySystem).toHaveBeenCalledWith('NORMAL');
    expect(result).toEqual([
      {
        id: 'id-1',
        code: '40',
        label: 'Fournisseurs et comptes rattachés',
        class: 4,
        accountType: 'TITLE',
        normalBalance: 'C',
        applicableSystems: ['NORMAL', 'MINIMAL', 'ALLEGE'],
      },
      {
        id: 'id-2',
        code: '41',
        label: 'Clients et comptes rattachés',
        class: 4,
        accountType: 'TITLE',
        normalBalance: 'D',
        applicableSystems: ['NORMAL', 'MINIMAL', 'ALLEGE'],
      },
    ]);
  });

  it('returns an empty array when no reference rows match the system', async () => {
    const h = buildHarness();
    h.listBySystem.mockResolvedValue([]);
    expect(await h.service.listBySystem('MINIMAL')).toEqual([]);
  });

  it('forwards the system filter verbatim to the repository', async () => {
    const h = buildHarness();
    h.listBySystem.mockResolvedValue([]);
    await h.service.listBySystem('ALLEGE');
    expect(h.listBySystem).toHaveBeenCalledWith('ALLEGE');
  });
});
