/**
 * E2 — Tests unitaires `ActuarialCommitmentsService`.
 *
 * Couvre :
 *   - create() persiste + normalise + dérive offBalanceSheet
 *   - update() recalcule offBalanceSheet et exige status=active
 *   - expire() bascule active → expired (+ rejet si déjà non-active)
 *   - listByOrg() délègue avec filtre status
 *   - getLatestByType() expose le repository
 *   - sumOffBalanceSheetAsOf() somme `obligation - provisioned` (clamp 0)
 *   - toSnapshot() produit le shape stable consommé par N16B
 *   - garde-fou ACTUARIAL_COMMITMENT_PROVISION_OVERFLOW (montants invalides,
 *     provision > obligation, négatifs)
 *   - tenant isolation : tout passage de TenantId est ré-asserté
 */
import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import { asTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import type { CreateActuarialCommitmentDto } from '../dto/create-commitment.dto';
import type { UpdateActuarialCommitmentDto } from '../dto/update-commitment.dto';
import type { ActuarialCommitmentEntity } from '../entities/actuarial-commitment.entity';
import type {
  ActuarialCommitmentsRepository,
  ListActuarialCommitmentsFilters,
} from '../repositories/actuarial-commitments.repository';
import { ActuarialCommitmentsService } from '../services/actuarial-commitments.service';

const ORG_ID: TenantId = asTenantId('11111111-1111-1111-1111-111111111111');
const OTHER_ORG_ID: TenantId = asTenantId('99999999-9999-9999-9999-999999999999');
const ACTOR_ID = '22222222-2222-2222-2222-222222222222';

function makeEntity(overrides: Partial<ActuarialCommitmentEntity> = {}): ActuarialCommitmentEntity {
  return {
    id: 'commit-1',
    organizationId: String(ORG_ID),
    commitmentType: 'retraite_ifc',
    label: 'IFC Cadres',
    valuationDate: '2026-12-31',
    obligationAmount: '120000.00',
    provisionedAmount: '50000.00',
    discountRate: '0.0350',
    mortalityTable: 'TGH/TGF05',
    staffTurnover: '0.0500',
    salaryGrowthRate: '0.0200',
    methodology: 'PUC IAS 19',
    actuaryName: 'Cabinet Actuariel CI',
    status: 'active',
    comment: null,
    createdById: ACTOR_ID,
    createdAt: new Date('2026-01-15T10:00:00Z'),
    updatedAt: new Date('2026-01-15T10:00:00Z'),
    organization: undefined as never,
    ...overrides,
  } as ActuarialCommitmentEntity;
}

interface Harness {
  service: ActuarialCommitmentsService;
  repo: jest.Mocked<ActuarialCommitmentsRepository>;
  store: ActuarialCommitmentEntity[];
}

function buildHarness(): Harness {
  const store: ActuarialCommitmentEntity[] = [];
  let counter = 0;

  const repo = {
    create: jest.fn(async (input) => {
      counter += 1;
      const entity = makeEntity({
        id: `commit-${counter}`,
        organizationId: String(input.organizationId),
        commitmentType: input.commitmentType,
        label: input.label,
        valuationDate: input.valuationDate,
        obligationAmount: input.obligationAmount,
        provisionedAmount: input.provisionedAmount,
        discountRate: input.discountRate,
        mortalityTable: input.mortalityTable,
        staffTurnover: input.staffTurnover ?? null,
        salaryGrowthRate: input.salaryGrowthRate ?? null,
        methodology: input.methodology,
        actuaryName: input.actuaryName ?? null,
        comment: input.comment ?? null,
        createdById: input.createdById ?? null,
        status: 'active',
      });
      store.push(entity);
      return entity;
    }),
    findById: jest.fn(async (id: string, organizationId: TenantId | string) => {
      const row = store.find(
        (x) => x.id === id && x.organizationId === String(organizationId),
      );
      return row ?? null;
    }),
    listByOrganization: jest.fn(
      async (organizationId: TenantId | string, filters: ListActuarialCommitmentsFilters = {}) => {
        return store.filter((x) => {
          if (x.organizationId !== String(organizationId)) return false;
          if (filters.status && x.status !== filters.status) return false;
          if (filters.commitmentType && x.commitmentType !== filters.commitmentType) return false;
          return true;
        });
      },
    ),
    findLatestActiveByType: jest.fn(async (organizationId, commitmentType) => {
      return (
        store
          .filter(
            (x) =>
              x.organizationId === String(organizationId) &&
              x.commitmentType === commitmentType &&
              x.status === 'active',
          )
          .sort((a, b) => (a.valuationDate < b.valuationDate ? 1 : -1))[0] ?? null
      );
    }),
    listActiveAsOf: jest.fn(async (organizationId, asAtDate: string) => {
      return store.filter(
        (x) =>
          x.organizationId === String(organizationId) &&
          x.status === 'active' &&
          x.valuationDate <= asAtDate,
      );
    }),
    update: jest.fn(async (id: string, organizationId: TenantId | string, patch) => {
      const idx = store.findIndex(
        (x) => x.id === id && x.organizationId === String(organizationId),
      );
      if (idx === -1) {
        throw new Error(`Missing ${id}`);
      }
      const merged = { ...store[idx], ...patch } as ActuarialCommitmentEntity;
      store[idx] = merged;
      return merged;
    }),
  } as unknown as jest.Mocked<ActuarialCommitmentsRepository>;

  const service = new ActuarialCommitmentsService(repo);
  return { service, repo, store };
}

const BASE_CREATE: CreateActuarialCommitmentDto = {
  commitmentType: 'retraite_ifc',
  label: 'IFC Cadres',
  valuationDate: '2026-12-31',
  obligationAmount: '120000.00',
  provisionedAmount: '50000.00',
  discountRate: '0.0350',
  mortalityTable: 'TGH/TGF05',
  methodology: 'PUC IAS 19',
  actuaryName: 'Cabinet Actuariel CI',
};

describe('ActuarialCommitmentsService.create', () => {
  it('persiste l\'évaluation et normalise les montants', async () => {
    const { service, repo, store } = buildHarness();
    const entity = await service.create(ORG_ID, BASE_CREATE, ACTOR_ID);

    expect(repo.create).toHaveBeenCalledTimes(1);
    expect(entity.obligationAmount).toBe('120000.00');
    expect(entity.provisionedAmount).toBe('50000.00');
    expect(entity.status).toBe('active');
    expect(store).toHaveLength(1);
  });

  it('rejette une provision > obligation avec ACTUARIAL_COMMITMENT_PROVISION_OVERFLOW', async () => {
    const { service } = buildHarness();
    await expect(
      service.create(
        ORG_ID,
        { ...BASE_CREATE, obligationAmount: '100.00', provisionedAmount: '500.00' },
        ACTOR_ID,
      ),
    ).rejects.toMatchObject({
      code: ERROR_CODES.ACTUARIAL_COMMITMENT_PROVISION_OVERFLOW,
    });
  });

  it('rejette un montant négatif', async () => {
    const { service } = buildHarness();
    await expect(
      service.create(
        ORG_ID,
        { ...BASE_CREATE, obligationAmount: '-1.00' },
        ACTOR_ID,
      ),
    ).rejects.toBeInstanceOf(AppException);
  });
});

describe('ActuarialCommitmentsService.update', () => {
  it('recalcule offBalanceSheet via toSnapshot après patch', async () => {
    const { service } = buildHarness();
    const created = await service.create(ORG_ID, BASE_CREATE, ACTOR_ID);
    expect(service.toSnapshot(created).offBalanceSheetAmount).toBe('70000.00');

    const patch: UpdateActuarialCommitmentDto = {
      obligationAmount: '150000.00',
      provisionedAmount: '50000.00',
    };
    const updated = await service.update(ORG_ID, created.id, patch);
    expect(service.toSnapshot(updated).offBalanceSheetAmount).toBe('100000.00');
  });

  it('refuse de patcher un engagement non-actif', async () => {
    const { service } = buildHarness();
    const created = await service.create(ORG_ID, BASE_CREATE, ACTOR_ID);
    await service.expire(ORG_ID, created.id);

    await expect(
      service.update(ORG_ID, created.id, { label: 'noop' }),
    ).rejects.toMatchObject({ code: ERROR_CODES.ACTUARIAL_COMMITMENT_NOT_ACTIVE });
  });

  it('rejette un patch qui pousse provisioned au-delà d\'obligation', async () => {
    const { service } = buildHarness();
    const created = await service.create(ORG_ID, BASE_CREATE, ACTOR_ID);
    await expect(
      service.update(ORG_ID, created.id, { provisionedAmount: '999999.00' }),
    ).rejects.toMatchObject({
      code: ERROR_CODES.ACTUARIAL_COMMITMENT_PROVISION_OVERFLOW,
    });
  });
});

describe('ActuarialCommitmentsService.expire', () => {
  it('bascule active → expired', async () => {
    const { service } = buildHarness();
    const created = await service.create(ORG_ID, BASE_CREATE, ACTOR_ID);
    const expired = await service.expire(ORG_ID, created.id);
    expect(expired.status).toBe('expired');
  });

  it('rejette si l\'engagement n\'est pas trouvé', async () => {
    const { service } = buildHarness();
    await expect(service.expire(ORG_ID, 'unknown')).rejects.toMatchObject({
      code: ERROR_CODES.ACTUARIAL_COMMITMENT_NOT_FOUND,
    });
  });
});

describe('ActuarialCommitmentsService.listByOrg + tenant isolation', () => {
  it('ne renvoie que les engagements du tenant courant', async () => {
    const { service, store } = buildHarness();
    await service.create(ORG_ID, BASE_CREATE, ACTOR_ID);
    // Injecte un engagement d'un autre tenant via le store partagé.
    store.push(
      makeEntity({ id: 'commit-other', organizationId: String(OTHER_ORG_ID) }),
    );

    const mine = await service.listByOrg(ORG_ID);
    expect(mine).toHaveLength(1);
    expect(mine[0].organizationId).toBe(String(ORG_ID));

    const theirs = await service.listByOrg(OTHER_ORG_ID);
    expect(theirs).toHaveLength(1);
    expect(theirs[0].id).toBe('commit-other');
  });

  it('filtre status=active par défaut quand câblé par la factory', async () => {
    const { service } = buildHarness();
    const created = await service.create(ORG_ID, BASE_CREATE, ACTOR_ID);
    await service.expire(ORG_ID, created.id);
    await service.create(ORG_ID, BASE_CREATE, ACTOR_ID);

    const actives = await service.listByOrg(ORG_ID, { status: 'active' });
    expect(actives).toHaveLength(1);
    expect(actives[0].status).toBe('active');
  });
});

describe('ActuarialCommitmentsService.sumOffBalanceSheetAsOf', () => {
  it('somme `obligation - provisioned` (clamp 0) pour les engagements actifs ≤ asAtDate', async () => {
    const { service } = buildHarness();
    await service.create(ORG_ID, BASE_CREATE, ACTOR_ID); // 120k - 50k = 70k
    await service.create(
      ORG_ID,
      { ...BASE_CREATE, obligationAmount: '40000.00', provisionedAmount: '40000.00' },
      ACTOR_ID,
    ); // 0
    await service.create(
      ORG_ID,
      {
        ...BASE_CREATE,
        commitmentType: 'medaille_du_travail',
        obligationAmount: '8000.00',
        provisionedAmount: '0.00',
      },
      ACTOR_ID,
    ); // 8k

    const total = await service.sumOffBalanceSheetAsOf(ORG_ID, '2026-12-31');
    expect(total).toBe('78000.00');
  });
});

describe('ActuarialCommitmentsService.toSnapshot', () => {
  it('produit le shape stable consommé par le handler N16B', async () => {
    const { service } = buildHarness();
    const created = await service.create(ORG_ID, BASE_CREATE, ACTOR_ID);
    const snap = service.toSnapshot(created);

    expect(snap).toMatchObject({
      commitmentType: 'retraite_ifc',
      obligationAmount: '120000.00',
      provisionedAmount: '50000.00',
      offBalanceSheetAmount: '70000.00',
      status: 'active',
    });
  });

  it('edge case : obligation = provisioned → hors-bilan = 0.00', async () => {
    const { service } = buildHarness();
    const created = await service.create(
      ORG_ID,
      { ...BASE_CREATE, obligationAmount: '5000.00', provisionedAmount: '5000.00' },
      ACTOR_ID,
    );
    const snap = service.toSnapshot(created);
    expect(snap.offBalanceSheetAmount).toBe('0.00');
  });
});

describe('ActuarialCommitmentsService.getLatestByType', () => {
  it('renvoie l\'évaluation active la plus récente pour un type', async () => {
    const { service } = buildHarness();
    await service.create(ORG_ID, BASE_CREATE, ACTOR_ID);
    const latest = await service.getLatestByType(ORG_ID, 'retraite_ifc');
    expect(latest).not.toBeNull();
    expect(latest?.commitmentType).toBe('retraite_ifc');

    const none = await service.getLatestByType(ORG_ID, 'autre');
    expect(none).toBeNull();
  });
});
