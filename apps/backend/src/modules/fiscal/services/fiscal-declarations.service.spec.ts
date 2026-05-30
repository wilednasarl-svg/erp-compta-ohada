import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import { asTenantId } from '../../../common/persistence/tenant-scope';
import type { FiscalDeclarationEntity } from '../entities/fiscal-declaration.entity';
import type { FiscalParameterEntity } from '../entities/fiscal-parameter.entity';
import type { FiscalDeclarationRepository } from '../repositories/fiscal-declaration.repository';
import type { FiscalParameterRepository } from '../repositories/fiscal-parameter.repository';
import { FiscalDeclarationsService } from './fiscal-declarations.service';

const ORG = asTenantId('11111111-1111-1111-1111-111111111111');

function tvaParam(): FiscalParameterEntity {
  return {
    taxCode: 'TVA',
    label: 'TVA',
    rate: '18.0000',
    ceiling: null,
    periodicity: 'monthly',
    dueDay: 15,
    chargeAccount: '4434',
    liabilityAccount: '4431',
  } as FiscalParameterEntity;
}

function makeService(opts: {
  param?: FiscalParameterEntity | null;
  existing?: FiscalDeclarationEntity | null;
  create?: jest.Mock;
  update?: jest.Mock;
}): {
  service: FiscalDeclarationsService;
  create: jest.Mock;
  update: jest.Mock;
} {
  const create = opts.create ?? jest.fn((input) => Promise.resolve({ id: 'new', ...input }));
  const update =
    opts.update ?? jest.fn((entity, input) => Promise.resolve({ ...entity, ...input }));
  const declRepo = {
    findByNaturalKey: jest.fn().mockResolvedValue(opts.existing ?? null),
    create,
    update,
  } as unknown as FiscalDeclarationRepository;
  const paramRepo = {
    findEffective: jest.fn().mockResolvedValue(opts.param ?? null),
  } as unknown as FiscalParameterRepository;
  const baseService = {
    computeBase: jest.fn().mockResolvedValue('0.00'),
  } as unknown as import('./fiscal-base.service').FiscalBaseService;
  return {
    service: new FiscalDeclarationsService(declRepo, paramRepo, baseService),
    create,
    update,
  };
}

describe('FiscalDeclarationsService.generate', () => {
  it('computes amount due and due date, then creates the declaration', async () => {
    const { service, create } = makeService({ param: tvaParam() });

    const decl = await service.generate(ORG, {
      taxCode: 'TVA',
      periodYear: 2026,
      periodMonth: 3,
      baseAmount: '45000000.00',
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        taxCode: 'TVA',
        amountDue: '8100000.00',
        rate: '18.0000',
        dueDate: '2026-04-15',
      }),
    );
    expect(decl.amountDue).toBe('8100000.00');
  });

  it('throws FISCAL_NO_RATE_FOR_PERIOD when no parameter is effective', async () => {
    const { service } = makeService({ param: null });

    await expect(
      service.generate(ORG, {
        taxCode: 'TVA',
        periodYear: 2026,
        periodMonth: 3,
        baseAmount: '100',
      }),
    ).rejects.toMatchObject({ code: ERROR_CODES.FISCAL_NO_RATE_FOR_PERIOD });
  });

  it('recomputes an existing editable declaration instead of duplicating', async () => {
    const existing = {
      id: 'd1',
      status: 'a_deposer',
      comment: null,
    } as FiscalDeclarationEntity;
    const { service, create, update } = makeService({ param: tvaParam(), existing });

    await service.generate(ORG, {
      taxCode: 'TVA',
      periodYear: 2026,
      periodMonth: 3,
      baseAmount: '45000000.00',
    });

    expect(create).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(
      existing,
      expect.objectContaining({ amountDue: '8100000.00' }),
    );
  });

  it('refuses to recompute a filed declaration', async () => {
    const existing = { id: 'd1', status: 'depose' } as FiscalDeclarationEntity;
    const { service } = makeService({ param: tvaParam(), existing });

    await expect(
      service.generate(ORG, { taxCode: 'TVA', periodYear: 2026, periodMonth: 3, baseAmount: '1' }),
    ).rejects.toBeInstanceOf(AppException);
  });
});
