import type { Repository } from 'typeorm';

import type { ReferenceAccountEntity } from '../entities/reference-account.entity';
import { ReferenceAccountRepository } from './reference-account.repository';

/**
 * `ReferenceAccountRepository` unit tests (Module 2 audit HIGH-5).
 *
 * The reference chart is NOT tenant-scoped (global catalogue), so the
 * tenant-scope guard does not apply here. The invariant we verify is:
 *   - `listBySystem` filters via the `&&` ANY(applicable_systems)
 *     predicate, parameterised — not via string concatenation.
 *   - `system` filtering returns ordered results (by code ASC).
 *   - `findByCode` is a strict equality lookup.
 */
describe('ReferenceAccountRepository', () => {
  interface QbStub {
    where: jest.Mock;
    orderBy: jest.Mock;
    getMany: jest.Mock;
  }

  function buildHarness(qbOverrides: Partial<QbStub> = {}): {
    repo: ReferenceAccountRepository;
    inner: jest.Mocked<
      Pick<Repository<ReferenceAccountEntity>, 'createQueryBuilder' | 'findOne' | 'count'>
    >;
    qb: QbStub;
  } {
    const qb: QbStub = {
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
      ...qbOverrides,
    };
    const inner = {
      createQueryBuilder: jest.fn().mockReturnValue(qb),
      findOne: jest.fn().mockResolvedValue(null),
      count: jest.fn().mockResolvedValue(0),
    } as unknown as jest.Mocked<
      Pick<Repository<ReferenceAccountEntity>, 'createQueryBuilder' | 'findOne' | 'count'>
    >;
    const repo = new ReferenceAccountRepository(
      inner as unknown as Repository<ReferenceAccountEntity>,
    );
    return { repo, inner, qb };
  }

  describe('listBySystem', () => {
    it('uses ANY(applicable_systems) predicate with a parameterised `:system`', async () => {
      const { repo, qb } = buildHarness();
      await repo.listBySystem('NORMAL');
      const [sql, params] = qb.where.mock.calls[0] as [string, { system: string }];
      expect(sql).toContain('ANY(a.applicable_systems)');
      expect(sql).toContain(':system');
      expect(params).toEqual({ system: 'NORMAL' });
    });

    it('orders results by code ASC', async () => {
      const { repo, qb } = buildHarness();
      await repo.listBySystem('NORMAL');
      expect(qb.orderBy).toHaveBeenCalledWith('a.code', 'ASC');
    });

    it('returns the raw entity list from getMany', async () => {
      const rows = [{ code: '101' }, { code: '411' }] as ReferenceAccountEntity[];
      const { repo } = buildHarness({ getMany: jest.fn().mockResolvedValue(rows) });
      const result = await repo.listBySystem('NORMAL');
      expect(result).toEqual(rows);
    });
  });

  describe('findByCode', () => {
    it('is a strict equality lookup on `code`', async () => {
      const { repo, inner } = buildHarness();
      await repo.findByCode('411');
      expect(inner.findOne).toHaveBeenCalledWith({ where: { code: '411' } });
    });
  });

  describe('countAll', () => {
    it('counts the catalogue without filters', async () => {
      const { repo, inner } = buildHarness();
      await repo.countAll();
      expect(inner.count).toHaveBeenCalledWith();
    });
  });
});
