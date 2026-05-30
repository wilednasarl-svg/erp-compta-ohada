import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import { asTenantId } from '../../../common/persistence/tenant-scope';
import type {
  BracketInput,
  FiscalTaxBracketRepository,
} from '../repositories/fiscal-tax-bracket.repository';
import { FiscalBracketsService } from './fiscal-brackets.service';

const ORG = asTenantId('11111111-1111-1111-1111-111111111111');

function makeService(): { service: FiscalBracketsService; replace: jest.Mock; count: jest.Mock } {
  const replace = jest.fn((_o, _t, _e, brackets: BracketInput[]) => Promise.resolve(brackets));
  const count = jest.fn().mockResolvedValue(0);
  const repo = {
    replace,
    countForDate: count,
    list: jest.fn(),
    findEffective: jest.fn(),
  } as unknown as FiscalTaxBracketRepository;
  return { service: new FiscalBracketsService(repo), replace, count };
}

const VALID: BracketInput[] = [
  { bracketOrder: 1, fromAmount: '0.00', toAmount: '75000.00', rate: '0.0000' },
  { bracketOrder: 2, fromAmount: '75000.00', toAmount: null, rate: '16.0000' },
];

describe('FiscalBracketsService.replace', () => {
  it('accepts a contiguous, ascending scale ending open', async () => {
    const { service, replace } = makeService();
    await service.replace(ORG, 'ITS', '2026-01-01', VALID);
    expect(replace).toHaveBeenCalled();
  });

  it('rejects a gap between brackets', async () => {
    const { service } = makeService();
    const gapped: BracketInput[] = [
      { bracketOrder: 1, fromAmount: '0.00', toAmount: '75000.00', rate: '0.0000' },
      { bracketOrder: 2, fromAmount: '80000.00', toAmount: null, rate: '16.0000' },
    ];
    await expect(service.replace(ORG, 'ITS', '2026-01-01', gapped)).rejects.toMatchObject({
      code: ERROR_CODES.FISCAL_BRACKET_INVALID,
    });
  });

  it('rejects a non-final open bracket', async () => {
    const { service } = makeService();
    const bad: BracketInput[] = [
      { bracketOrder: 1, fromAmount: '0.00', toAmount: null, rate: '0.0000' },
      { bracketOrder: 2, fromAmount: '75000.00', toAmount: null, rate: '16.0000' },
    ];
    await expect(service.replace(ORG, 'ITS', '2026-01-01', bad)).rejects.toBeInstanceOf(
      AppException,
    );
  });

  it('seeds ITS defaults only when absent', async () => {
    const { service, count, replace } = makeService();
    count.mockResolvedValueOnce(0);
    const res = await service.seedItsDefaults(ORG, 2026);
    expect(replace).toHaveBeenCalled();
    expect(res.created).toBeGreaterThan(0);
  });

  it('skips seeding when a scale already exists', async () => {
    const { service, count, replace } = makeService();
    count.mockResolvedValueOnce(6);
    const res = await service.seedItsDefaults(ORG, 2026);
    expect(replace).not.toHaveBeenCalled();
    expect(res.created).toBe(0);
  });
});
