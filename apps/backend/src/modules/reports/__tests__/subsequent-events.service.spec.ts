import { BadRequestException, NotFoundException } from '@nestjs/common';

import { asTenantId } from '../../../common/persistence/tenant-scope';
import type { AccountingPeriodEntity } from '../../journals/entities/accounting-period.entity';
import type { AccountingPeriodRepository } from '../../journals/repositories/accounting-period.repository';
import type { SubsequentEventEntity } from '../entities/subsequent-event.entity';
import type { SubsequentEventsRepository } from '../repositories/subsequent-events.repository';
import { SubsequentEventsService } from '../services/subsequent-events.service';

const ORG_ID = asTenantId('00000000-0000-4000-8000-000000000001');
const EXERCISE_ID = '11111111-2222-4333-8444-555555555555';
const EVENT_ID = '22222222-3333-4444-8555-666666666666';
const ACTOR_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const REVIEWER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function annualPeriod(
  overrides: Partial<AccountingPeriodEntity> = {},
): AccountingPeriodEntity {
  return {
    id: EXERCISE_ID,
    organizationId: ORG_ID,
    parentId: null,
    kind: 'ANNUAL',
    label: 'Exercice 2026',
    startDate: '2026-01-01',
    endDate: '2026-12-31',
    status: 'closed',
    closedAt: new Date(),
    closedBy: null,
    reopenedReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as AccountingPeriodEntity;
}

function event(overrides: Partial<SubsequentEventEntity> = {}): SubsequentEventEntity {
  return {
    id: EVENT_ID,
    organizationId: ORG_ID,
    exerciseId: EXERCISE_ID,
    eventDate: '2027-01-15',
    classification: 'NON_ADJUSTING',
    description: 'Incendie entrepôt principal',
    financialImpact: '125000.00',
    journalEntryId: null,
    createdById: ACTOR_ID,
    reviewedById: null,
    reviewedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as unknown as SubsequentEventEntity;
}

function buildHarness(overrides: {
  period?: AccountingPeriodEntity | null;
  existing?: SubsequentEventEntity | null;
} = {}) {
  const period = overrides.period === undefined ? annualPeriod() : overrides.period;
  const existing = overrides.existing === undefined ? event() : overrides.existing;

  const periodRepo = {
    findById: jest.fn().mockResolvedValue(period),
  };
  const eventsRepo = {
    create: jest.fn().mockImplementation(async (input) => event({ ...input })),
    findById: jest.fn().mockResolvedValue(existing),
    listByExercise: jest.fn().mockResolvedValue([]),
    update: jest.fn().mockImplementation(async (_org, _id, patch) =>
      existing ? event({ ...existing, ...patch }) : null,
    ),
    markReviewed: jest.fn().mockImplementation(async (_org, _id, reviewerId) =>
      existing ? event({ ...existing, reviewedById: reviewerId, reviewedAt: new Date() }) : null,
    ),
    delete: jest.fn().mockResolvedValue(true),
  };

  const service = new SubsequentEventsService(
    periodRepo as unknown as AccountingPeriodRepository,
    eventsRepo as unknown as SubsequentEventsRepository,
  );

  return { service, periodRepo, eventsRepo };
}

describe('SubsequentEventsService.record', () => {
  it('crée un événement valide', async () => {
    const h = buildHarness();

    const result = await h.service.record(ORG_ID, EXERCISE_ID, ACTOR_ID, {
      eventDate: '2027-01-15',
      classification: 'NON_ADJUSTING',
      description: 'Incendie entrepôt principal',
      financialImpact: '125000.00',
    });

    expect(result.classification).toBe('NON_ADJUSTING');
    expect(h.eventsRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ORG_ID,
        exerciseId: EXERCISE_ID,
        eventDate: '2027-01-15',
        description: 'Incendie entrepôt principal',
        createdById: ACTOR_ID,
      }),
    );
  });

  it('NotFound si la période n\'existe pas', async () => {
    const h = buildHarness({ period: null });
    await expect(
      h.service.record(ORG_ID, EXERCISE_ID, ACTOR_ID, {
        eventDate: '2027-01-15',
        classification: 'NON_ADJUSTING',
        description: 'X',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('NotFound si la période n\'est pas annuelle', async () => {
    const h = buildHarness({ period: annualPeriod({ kind: 'MONTHLY' }) });
    await expect(
      h.service.record(ORG_ID, EXERCISE_ID, ACTOR_ID, {
        eventDate: '2027-01-15',
        classification: 'NON_ADJUSTING',
        description: 'X',
      }),
    ).rejects.toThrow(/not an annual/);
  });

  it('BadRequest si eventDate est avant ou égale à la clôture', async () => {
    const h = buildHarness();
    await expect(
      h.service.record(ORG_ID, EXERCISE_ID, ACTOR_ID, {
        eventDate: '2026-12-31',
        classification: 'ADJUSTING',
        description: 'Trop tôt',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('BadRequest si la description est vide ou whitespace', async () => {
    const h = buildHarness();
    await expect(
      h.service.record(ORG_ID, EXERCISE_ID, ACTOR_ID, {
        eventDate: '2027-01-15',
        classification: 'NON_ADJUSTING',
        description: '   ',
      }),
    ).rejects.toThrow(/must not be empty/);
  });

  it('trim la description avant persistance', async () => {
    const h = buildHarness();

    await h.service.record(ORG_ID, EXERCISE_ID, ACTOR_ID, {
      eventDate: '2027-01-15',
      classification: 'NON_ADJUSTING',
      description: '  Mention en blanc  ',
    });

    expect(h.eventsRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ description: 'Mention en blanc' }),
    );
  });
});

describe('SubsequentEventsService.update', () => {
  it('met à jour les champs fournis', async () => {
    const h = buildHarness();

    const updated = await h.service.update(ORG_ID, EVENT_ID, {
      classification: 'ADJUSTING',
      financialImpact: '200000.00',
    });

    expect(updated.classification).toBe('ADJUSTING');
    expect(updated.financialImpact).toBe('200000.00');
  });

  it('BadRequest si nouvelle eventDate avant clôture', async () => {
    const h = buildHarness();
    await expect(
      h.service.update(ORG_ID, EVENT_ID, { eventDate: '2026-12-30' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('BadRequest si description vide', async () => {
    const h = buildHarness();
    await expect(
      h.service.update(ORG_ID, EVENT_ID, { description: '   ' }),
    ).rejects.toThrow(/must not be empty/);
  });

  it('NotFound si l\'événement n\'existe pas', async () => {
    const h = buildHarness({ existing: null });
    h.eventsRepo.update.mockResolvedValue(null);
    await expect(
      h.service.update(ORG_ID, EVENT_ID, { classification: 'ADJUSTING' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('SubsequentEventsService.markReviewed — four-eyes', () => {
  it("BadRequest si le reviewer est le créateur (principe quatre yeux)", async () => {
    const h = buildHarness({ existing: event({ createdById: REVIEWER_ID }) });
    await expect(
      h.service.markReviewed(ORG_ID, EVENT_ID, REVIEWER_ID),
    ).rejects.toThrow(/four-eyes/);
  });

  it("marque reviewed quand l'utilisateur est différent du créateur", async () => {
    const h = buildHarness();
    const result = await h.service.markReviewed(ORG_ID, EVENT_ID, REVIEWER_ID);
    expect(result.reviewedById).toBe(REVIEWER_ID);
    expect(result.reviewedAt).toBeInstanceOf(Date);
  });
});

describe('SubsequentEventsService.get + list + delete', () => {
  it('get délègue au repo', async () => {
    const h = buildHarness();
    const result = await h.service.get(ORG_ID, EVENT_ID);
    expect(result.id).toBe(EVENT_ID);
  });

  it('get NotFound quand absent', async () => {
    const h = buildHarness({ existing: null });
    await expect(h.service.get(ORG_ID, EVENT_ID)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('list délègue listByExercise', async () => {
    const h = buildHarness();
    await h.service.list(ORG_ID, EXERCISE_ID);
    expect(h.eventsRepo.listByExercise).toHaveBeenCalledWith(ORG_ID, EXERCISE_ID);
  });

  it('delete NotFound si rien à supprimer', async () => {
    const h = buildHarness();
    h.eventsRepo.delete.mockResolvedValue(false);
    await expect(h.service.delete(ORG_ID, EVENT_ID)).rejects.toBeInstanceOf(NotFoundException);
  });
});
