import type { DataSource, EntityManager } from 'typeorm';

import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import { asTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import type { AuditContext } from '../../audit/services/audit-trail.service';
import type { EntriesService } from '../../journals/services/entries.service';
import type {
  FxReevaluationAccountDetail,
  FxReevaluationRunEntity,
} from '../entities/fx-reevaluation-run.entity';
import type { FxReevaluationRunsRepository } from '../repositories/fx-reevaluation-runs.repository';
import type { ExchangeRatesService } from '../services/exchange-rates.service';
import { FxReevaluationService } from '../services/fx-reevaluation.service';

const ORG_ID = asTenantId('11111111-1111-1111-1111-111111111111');
const ACTOR_ID = '22222222-2222-2222-2222-222222222222';
const AUDIT_CTX: AuditContext = {
  ipAddress: '127.0.0.1',
  userAgent: 'jest',
  userId: null,
  organizationId: null,
  requestId: null,
};

interface ServiceUnderTest {
  service: FxReevaluationService;
  runsRepo: jest.Mocked<FxReevaluationRunsRepository>;
  rates: jest.Mocked<ExchangeRatesService>;
  entries: jest.Mocked<EntriesService>;
  createdEntries: Array<{
    journalCode: string;
    entryDate: string;
    description: string;
    lines: Array<{
      accountCode: string;
      debit: number;
      credit: number;
      description?: string | null;
    }>;
  }>;
  storedRuns: FxReevaluationRunEntity[];
}

function buildService(rateByDate: Record<string, string>): ServiceUnderTest {
  const storedRuns: FxReevaluationRunEntity[] = [];
  const createdEntries: ServiceUnderTest['createdEntries'] = [];
  let counter = 0;

  const runsRepo = {
    create: jest.fn(async (input) => {
      const run: FxReevaluationRunEntity = {
        id: `run-${++counter}`,
        organizationId: String(input.organizationId),
        closingDate: input.closingDate,
        reversalDate: input.reversalDate,
        status: input.status ?? 'pending',
        executedAt: input.executedAt ?? null,
        executedById: input.executedById ?? null,
        reversedAt: null,
        journalEntryId: input.journalEntryId ?? null,
        reversalJournalEntryId: null,
        metadata: (input.metadata ?? []) as ReadonlyArray<FxReevaluationAccountDetail>,
        errorMessage: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        organization: undefined as never,
      };
      storedRuns.push(run);
      return run;
    }),
    update: jest.fn(async (id, patch) => {
      const idx = storedRuns.findIndex((r) => r.id === id);
      if (idx >= 0) {
        storedRuns[idx] = { ...storedRuns[idx], ...patch } as FxReevaluationRunEntity;
      }
    }),
    findById: jest.fn(async (_org, id) => storedRuns.find((r) => r.id === id) ?? null),
    findByClosingDate: jest.fn(
      async (_org, date) =>
        storedRuns.find((r) => r.closingDate === date && r.status !== 'failed') ?? null,
    ),
    list: jest.fn(async () => storedRuns),
  } as unknown as jest.Mocked<FxReevaluationRunsRepository>;

  const rates = {
    getRateAtDate: jest.fn(async (_org: TenantId, from: string, _to: string, date: string) => {
      const key = `${from}@${date}`;
      const rate = rateByDate[key];
      if (!rate) {
        throw new Error(`No rate configured in mock for ${key}`);
      }
      return { rate, appliedSource: 'manual' as const, inverted: false };
    }),
  } as unknown as jest.Mocked<ExchangeRatesService>;

  const entries = {
    createDraft: jest.fn(async (_org, input) => {
      createdEntries.push({
        journalCode: input.journalCode,
        entryDate: input.entryDate,
        description: input.description,
        lines: input.lines.map(
          (l: {
            accountCode: string;
            debit: number;
            credit: number;
            description?: string | null;
          }) => ({
            accountCode: l.accountCode,
            debit: l.debit,
            credit: l.credit,
            description: l.description,
          }),
        ),
      });
      return { id: `entry-${createdEntries.length}` } as never;
    }),
    validate: jest.fn(async () => undefined as never),
  } as unknown as jest.Mocked<EntriesService>;

  const dataSource = {
    transaction: jest.fn(async (cb: (m: EntityManager) => Promise<unknown>) =>
      cb({} as EntityManager),
    ),
  } as unknown as DataSource;

  const service = new FxReevaluationService(dataSource, runsRepo, rates, entries);
  return { service, runsRepo, rates, entries, createdEntries, storedRuns };
}

describe('FxReevaluationService', () => {
  // ─── helpers purs ───────────────────────────────────────────────────

  describe('pure helpers', () => {
    it('nextDay rolls over month-end correctly', () => {
      expect(FxReevaluationService.nextDay('2026-12-31')).toBe('2027-01-01');
    });

    it('pickContraAccount: positive ecart → 479 (gain latent)', () => {
      expect(FxReevaluationService.pickContraAccount('1000', '50000')).toBe('479');
      expect(FxReevaluationService.pickContraAccount('-500', '50000')).toBe('479');
    });

    it('pickContraAccount: negative ecart → 478 (perte latente)', () => {
      expect(FxReevaluationService.pickContraAccount('1000', '-50000')).toBe('478');
      expect(FxReevaluationService.pickContraAccount('-500', '-25000')).toBe('478');
    });
  });

  // ─── scénarios d'intégration ───────────────────────────────────────

  it('throws FX_REEVAL_NO_FX_BALANCES when no foreign currency present', async () => {
    const { service } = buildService({});
    await expect(
      service.triggerReevaluation(
        ORG_ID,
        {
          closingDate: '2026-12-31',
          balances: [
            {
              accountCode: '411001',
              currency: 'XOF',
              amountCurrency: '1000',
              currentAmountXof: '1000',
            },
          ],
        },
        ACTOR_ID,
        AUDIT_CTX,
      ),
    ).rejects.toThrow(AppException);
  });

  it('throws FX_REEVAL_RATE_MISSING when closing rate is absent', async () => {
    const { service } = buildService({});
    await expect(
      service.triggerReevaluation(
        ORG_ID,
        {
          closingDate: '2026-12-31',
          balances: [
            {
              accountCode: '411001',
              currency: 'USD',
              amountCurrency: '1000',
              currentAmountXof: '600000',
            },
          ],
        },
        ACTOR_ID,
        AUDIT_CTX,
      ),
    ).rejects.toMatchObject({ code: ERROR_CODES.FX_REEVAL_RATE_MISSING });
  });

  it('EUR/XOF BCEAO parité fixe (655.957) → no journal entry, run persisted', async () => {
    const { service, createdEntries, storedRuns } = buildService({
      'EUR@2026-12-31': '655.957',
    });
    const view = await service.triggerReevaluation(
      ORG_ID,
      {
        closingDate: '2026-12-31',
        balances: [
          {
            accountCode: '411001',
            currency: 'EUR',
            amountCurrency: '1000',
            currentAmountXof: '655957',
          },
        ],
      },
      ACTOR_ID,
      AUDIT_CTX,
    );
    expect(createdEntries).toHaveLength(0);
    expect(view.status).toBe('executed');
    expect(view.journalEntryId).toBeNull();
    expect(storedRuns).toHaveLength(1);
    expect(storedRuns[0].metadata).toHaveLength(1);
    expect(storedRuns[0].metadata[0].ecart).toBe('0');
  });

  it('USD créance avec hausse de taux → écriture D 411x / C 479', async () => {
    const { service, createdEntries } = buildService({
      'USD@2026-12-31': '650',
    });
    const view = await service.triggerReevaluation(
      ORG_ID,
      {
        closingDate: '2026-12-31',
        balances: [
          {
            accountCode: '411001',
            currency: 'USD',
            amountCurrency: '1000',
            currentAmountXof: '600000',
          },
        ],
      },
      ACTOR_ID,
      AUDIT_CTX,
    );
    expect(view.status).toBe('executed');
    expect(view.journalEntryId).toBe('entry-1');
    expect(view.reversalDate).toBe('2027-01-01');
    expect(createdEntries).toHaveLength(1);
    const lines = createdEntries[0].lines;
    expect(lines).toHaveLength(2);
    const debit411 = lines.find((l) => l.accountCode === '411001');
    const credit479 = lines.find((l) => l.accountCode === '479');
    expect(debit411?.debit).toBe(50000);
    expect(debit411?.credit).toBe(0);
    expect(credit479?.credit).toBe(50000);
    expect(credit479?.debit).toBe(0);
  });

  it('USD dette avec hausse de taux → écriture D 478 / C 401x (perte latente)', async () => {
    const { service, createdEntries } = buildService({
      'USD@2026-12-31': '650',
    });
    await service.triggerReevaluation(
      ORG_ID,
      {
        closingDate: '2026-12-31',
        balances: [
          {
            accountCode: '401001',
            currency: 'USD',
            amountCurrency: '-500',
            currentAmountXof: '-300000',
          },
        ],
      },
      ACTOR_ID,
      AUDIT_CTX,
    );
    // Dette USD -500 × (650-600) = écart algébrique -25 000 XOF.
    // Sens comptable : dette plus lourde → CRÉDIT 401x (augmentation
    // de la dette) + DÉBIT 478 (perte latente).
    const lines = createdEntries[0].lines;
    expect(lines).toHaveLength(2);
    const credit401 = lines.find((l) => l.accountCode === '401001');
    const debit478 = lines.find((l) => l.accountCode === '478');
    expect(credit401?.credit).toBe(25000);
    expect(credit401?.debit).toBe(0);
    expect(debit478?.debit).toBe(25000);
    expect(debit478?.credit).toBe(0);
  });

  it('idempotency: a second triggerReevaluation on the same closing date throws FX_REEVAL_ALREADY_EXECUTED', async () => {
    const { service } = buildService({ 'USD@2026-12-31': '650' });
    await service.triggerReevaluation(
      ORG_ID,
      {
        closingDate: '2026-12-31',
        balances: [
          {
            accountCode: '411001',
            currency: 'USD',
            amountCurrency: '1000',
            currentAmountXof: '600000',
          },
        ],
      },
      ACTOR_ID,
      AUDIT_CTX,
    );
    await expect(
      service.triggerReevaluation(
        ORG_ID,
        {
          closingDate: '2026-12-31',
          balances: [
            {
              accountCode: '411001',
              currency: 'USD',
              amountCurrency: '1000',
              currentAmountXof: '600000',
            },
          ],
        },
        ACTOR_ID,
        AUDIT_CTX,
      ),
    ).rejects.toMatchObject({ code: ERROR_CODES.FX_REEVAL_ALREADY_EXECUTED });
  });

  it('triggerReversal generates a fully inverted entry at reversalDate', async () => {
    const { service, createdEntries, storedRuns } = buildService({
      'USD@2026-12-31': '650',
    });
    const initial = await service.triggerReevaluation(
      ORG_ID,
      {
        closingDate: '2026-12-31',
        balances: [
          {
            accountCode: '411001',
            currency: 'USD',
            amountCurrency: '1000',
            currentAmountXof: '600000',
          },
        ],
      },
      ACTOR_ID,
      AUDIT_CTX,
    );
    expect(createdEntries).toHaveLength(1);

    const reversed = await service.triggerReversal(ORG_ID, initial.id, ACTOR_ID, AUDIT_CTX);
    expect(reversed.status).toBe('reversed');
    expect(createdEntries).toHaveLength(2);

    const reversal = createdEntries[1];
    expect(reversal.entryDate).toBe('2027-01-01');
    const debit479 = reversal.lines.find((l) => l.accountCode === '479');
    const credit411 = reversal.lines.find((l) => l.accountCode === '411001');
    expect(debit479?.debit).toBe(50000);
    expect(debit479?.credit).toBe(0);
    expect(credit411?.credit).toBe(50000);
    expect(credit411?.debit).toBe(0);

    expect(storedRuns[0].reversedAt).toBeInstanceOf(Date);
    expect(storedRuns[0].reversalJournalEntryId).toBe('entry-2');
  });

  it('triggerReversal on a non-executed run throws FX_REEVAL_NOT_REVERSIBLE', async () => {
    const { service } = buildService({});
    await expect(
      service.triggerReversal(ORG_ID, 'nonexistent', ACTOR_ID, AUDIT_CTX),
    ).rejects.toMatchObject({ code: ERROR_CODES.FX_REEVAL_NOT_REVERSIBLE });
  });
});
