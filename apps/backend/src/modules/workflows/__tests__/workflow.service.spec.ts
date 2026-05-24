import { ERROR_CODES } from '../../../common/errors/error-codes';
import type { WorkflowDefinitionEntity } from '../entities/workflow-definition.entity';
import type { WorkflowEventEntity } from '../entities/workflow-event.entity';
import type { WorkflowInstanceEntity } from '../entities/workflow-instance.entity';
import type { WorkflowDefinitionRepository } from '../repositories/workflow-definition.repository';
import type { WorkflowEventRepository } from '../repositories/workflow-event.repository';
import type { WorkflowInstanceRepository } from '../repositories/workflow-instance.repository';
import { WorkflowService } from '../services/workflow.service';

const ORG_ID = '00000000-0000-4000-8000-000000000001';
const USER_ID = '00000000-0000-4000-8000-000000000002';
const DEF_ID = '00000000-0000-4000-8000-000000000003';
const INSTANCE_ID = '00000000-0000-4000-8000-000000000004';
const TARGET_ID = '00000000-0000-4000-8000-000000000005';

const CTX = {
  userId: USER_ID,
  organizationId: ORG_ID,
  ipAddress: '127.0.0.1',
  userAgent: 'jest',
};

function makeDefinition(): WorkflowDefinitionEntity {
  return {
    id: DEF_ID,
    name: 'Test workflow',
    description: null,
    targetType: 'import_session',
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as WorkflowDefinitionEntity;
}

function makeInstance(status = 'draft'): WorkflowInstanceEntity {
  return {
    id: INSTANCE_ID,
    workflowDefinitionId: DEF_ID,
    organizationId: ORG_ID,
    targetType: 'import_session' as const,
    targetId: TARGET_ID,
    currentStatus: status as WorkflowInstanceEntity['currentStatus'],
    startedBy: USER_ID,
    startedAt: new Date(),
    completedAt: null,
    updatedAt: new Date(),
    events: [],
  } as unknown as WorkflowInstanceEntity;
}

function buildService(
  overrides: {
    definitions?: Partial<WorkflowDefinitionRepository>;
    instances?: Partial<WorkflowInstanceRepository>;
    events?: Partial<WorkflowEventRepository>;
  } = {},
) {
  const definitions: WorkflowDefinitionRepository = {
    findActiveByTargetType: jest.fn().mockResolvedValue(makeDefinition()),
    ...overrides.definitions,
  } as unknown as WorkflowDefinitionRepository;

  const instances: WorkflowInstanceRepository = {
    create: jest.fn().mockResolvedValue(makeInstance()),
    findById: jest.fn().mockResolvedValue(makeInstance()),
    findByTarget: jest.fn().mockResolvedValue(null),
    updateStatus: jest.fn().mockResolvedValue(undefined),
    ...overrides.instances,
  } as unknown as WorkflowInstanceRepository;

  const events: WorkflowEventRepository = {
    record: jest.fn().mockResolvedValue({ id: 'ev_1' } as WorkflowEventEntity),
    listByInstance: jest.fn().mockResolvedValue([]),
    ...overrides.events,
  } as unknown as WorkflowEventRepository;

  const audit = { record: jest.fn().mockResolvedValue(null) };

  const service = new WorkflowService(definitions, instances, events, audit as never);

  return { service, definitions, instances, events, audit };
}

// ─── startWorkflow ───────────────────────────────────────────────────────────

describe('WorkflowService.startWorkflow', () => {
  it('creates an instance and records the start event', async () => {
    const { service, instances, events, audit } = buildService();

    const result = await service.startWorkflow({
      organizationId: ORG_ID,
      targetType: 'import_session',
      targetId: TARGET_ID,
      ctx: CTX,
    });

    expect(instances.create).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ORG_ID,
        targetType: 'import_session',
        targetId: TARGET_ID,
        startedBy: USER_ID,
      }),
    );
    expect(events.record).toHaveBeenCalledWith(
      expect.objectContaining({ fromStatus: null, toStatus: 'draft' }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ module: 'workflows', action: 'started' }),
    );
    expect(result.currentStatus).toBe('draft');
  });

  it('returns the existing instance without creating a duplicate', async () => {
    const existing = makeInstance('in_review');
    const { service, instances } = buildService({
      instances: { findByTarget: jest.fn().mockResolvedValue(existing) },
    });

    const result = await service.startWorkflow({
      organizationId: ORG_ID,
      targetType: 'import_session',
      targetId: TARGET_ID,
      ctx: CTX,
    });

    expect(instances.create).not.toHaveBeenCalled();
    expect(result.currentStatus).toBe('in_review');
  });

  it('throws WORKFLOW_TRANSITION_INVALID when no active definition exists', async () => {
    const { service } = buildService({
      definitions: { findActiveByTargetType: jest.fn().mockResolvedValue(null) },
    });

    await expect(
      service.startWorkflow({
        organizationId: ORG_ID,
        targetType: 'import_session',
        targetId: TARGET_ID,
        ctx: CTX,
      }),
    ).rejects.toMatchObject({ code: ERROR_CODES.WORKFLOW_TRANSITION_INVALID });
  });
});

// ─── transition ──────────────────────────────────────────────────────────────

describe('WorkflowService.transition', () => {
  it('transitions draft → in_review and records the event', async () => {
    const { service, instances, events, audit } = buildService();

    const result = await service.transition({
      instanceId: INSTANCE_ID,
      organizationId: ORG_ID,
      toStatus: 'in_review',
      comment: 'Prêt pour revue',
      ctx: CTX,
    });

    expect(instances.updateStatus).toHaveBeenCalledWith(INSTANCE_ID, 'in_review', null);
    expect(events.record).toHaveBeenCalledWith(
      expect.objectContaining({ fromStatus: 'draft', toStatus: 'in_review' }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ module: 'workflows', action: 'transition' }),
    );
    expect(result.currentStatus).toBe('in_review');
  });

  it('sets completedAt when transitioning to locked', async () => {
    const instance = makeInstance('approved');
    const { service, instances } = buildService({
      instances: {
        findById: jest.fn().mockResolvedValue(instance),
        updateStatus: jest.fn().mockResolvedValue(undefined),
        findByTarget: jest.fn().mockResolvedValue(null),
      },
    });

    const before = new Date();
    await service.transition({
      instanceId: INSTANCE_ID,
      organizationId: ORG_ID,
      toStatus: 'locked',
      ctx: CTX,
    });
    const after = new Date();

    const [, , completedAt] = (instances.updateStatus as jest.Mock).mock.calls[0] as [
      string,
      string,
      Date | null,
    ];
    expect(completedAt).toBeInstanceOf(Date);
    expect((completedAt as Date).getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect((completedAt as Date).getTime()).toBeLessThanOrEqual(after.getTime());
  });

  it('throws WORKFLOW_INSTANCE_NOT_FOUND when instance does not exist', async () => {
    const { service } = buildService({
      instances: {
        findById: jest.fn().mockResolvedValue(null),
        findByTarget: jest.fn().mockResolvedValue(null),
      },
    });

    await expect(
      service.transition({
        instanceId: INSTANCE_ID,
        organizationId: ORG_ID,
        toStatus: 'in_review',
        ctx: CTX,
      }),
    ).rejects.toMatchObject({ code: ERROR_CODES.WORKFLOW_INSTANCE_NOT_FOUND });
  });

  it('throws WORKFLOW_TRANSITION_INVALID when transition is not in the graph', async () => {
    const { service } = buildService();

    // draft → approved is NOT allowed (must go through in_review)
    await expect(
      service.transition({
        instanceId: INSTANCE_ID,
        organizationId: ORG_ID,
        toStatus: 'approved',
        ctx: CTX,
      }),
    ).rejects.toMatchObject({ code: ERROR_CODES.WORKFLOW_TRANSITION_INVALID });
  });

  it('throws WORKFLOW_TRANSITION_INVALID when attempting to leave locked state', async () => {
    const locked = makeInstance('locked');
    const { service } = buildService({
      instances: {
        findById: jest.fn().mockResolvedValue(locked),
        findByTarget: jest.fn().mockResolvedValue(null),
        updateStatus: jest.fn().mockResolvedValue(undefined),
      },
    });

    await expect(
      service.transition({
        instanceId: INSTANCE_ID,
        organizationId: ORG_ID,
        toStatus: 'approved',
        ctx: CTX,
      }),
    ).rejects.toMatchObject({ code: ERROR_CODES.WORKFLOW_TRANSITION_INVALID });
  });
});

// ─── getHistory ──────────────────────────────────────────────────────────────

describe('WorkflowService.getHistory', () => {
  it('returns the ordered list of events', async () => {
    const eventRows = [
      {
        id: 'ev_1',
        fromStatus: null,
        toStatus: 'draft',
        actorId: USER_ID,
        comment: null,
        occurredAt: new Date(),
      },
      {
        id: 'ev_2',
        fromStatus: 'draft',
        toStatus: 'in_review',
        actorId: USER_ID,
        comment: 'ok',
        occurredAt: new Date(),
      },
    ] as WorkflowEventEntity[];

    const { service } = buildService({
      events: { listByInstance: jest.fn().mockResolvedValue(eventRows) },
    });

    const history = await service.getHistory(INSTANCE_ID, ORG_ID);

    expect(history).toHaveLength(2);
    expect(history[0].fromStatus).toBeNull();
    expect(history[1].toStatus).toBe('in_review');
  });

  it('throws WORKFLOW_INSTANCE_NOT_FOUND when instance does not exist', async () => {
    const { service } = buildService({
      instances: {
        findById: jest.fn().mockResolvedValue(null),
        findByTarget: jest.fn().mockResolvedValue(null),
      },
    });

    await expect(service.getHistory(INSTANCE_ID, ORG_ID)).rejects.toMatchObject({
      code: ERROR_CODES.WORKFLOW_INSTANCE_NOT_FOUND,
    });
  });
});

// ─── assertNotLocked ─────────────────────────────────────────────────────────

describe('WorkflowService.assertNotLocked', () => {
  it('passes silently when no workflow instance exists', async () => {
    const { service } = buildService({
      instances: {
        findByTarget: jest.fn().mockResolvedValue(null),
        findById: jest.fn().mockResolvedValue(null),
      },
    });

    await expect(
      service.assertNotLocked(ORG_ID, 'import_session', TARGET_ID),
    ).resolves.toBeUndefined();
  });

  it('passes silently when workflow is in approved state (not locked)', async () => {
    const { service } = buildService({
      instances: {
        findByTarget: jest.fn().mockResolvedValue(makeInstance('approved')),
        findById: jest.fn().mockResolvedValue(makeInstance('approved')),
      },
    });

    await expect(
      service.assertNotLocked(ORG_ID, 'import_session', TARGET_ID),
    ).resolves.toBeUndefined();
  });

  it('throws WORKFLOW_LOCKED when instance is locked', async () => {
    const { service } = buildService({
      instances: {
        findByTarget: jest.fn().mockResolvedValue(makeInstance('locked')),
        findById: jest.fn().mockResolvedValue(makeInstance('locked')),
      },
    });

    await expect(
      service.assertNotLocked(ORG_ID, 'import_session', TARGET_ID),
    ).rejects.toMatchObject({ code: ERROR_CODES.WORKFLOW_LOCKED });
  });
});
