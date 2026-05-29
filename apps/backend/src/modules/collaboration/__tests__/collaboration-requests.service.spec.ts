import type { AuditTrailService } from '../../audit/services/audit-trail.service';
import type { CollaborationCommentEntity } from '../entities/collaboration-comment.entity';
import type { CollaborationRequestEntity } from '../entities/collaboration-request.entity';
import type { CollaborationCommentRepository } from '../repositories/collaboration-comment.repository';
import type { CollaborationRequestRepository } from '../repositories/collaboration-request.repository';
import { asTenantId } from '../../../common/persistence/tenant-scope';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import { AppException } from '../../../common/errors/app-exception';
import { isStatusTransitionAllowed, type CollaborationStatus } from '../types/collaboration-status';
import { type CollaborationNotificationsService } from '../services/collaboration-notifications.service';
import { CollaborationRequestsService } from '../services/collaboration-requests.service';

const ORG_ID = asTenantId('00000000-0000-4000-8000-000000000001');
const CABINET_USER_ID = '00000000-0000-4000-8000-000000000010';
const CLIENT_USER_ID = '00000000-0000-4000-8000-000000000020';
const OTHER_CLIENT_ID = '00000000-0000-4000-8000-000000000021';
const REQUEST_ID = '00000000-0000-4000-8000-000000000030';
const COMMENT_ID = '00000000-0000-4000-8000-000000000040';
const DOCUMENT_ID = '00000000-0000-4000-8000-000000000050';

function makeRequest(
  overrides: Partial<CollaborationRequestEntity> = {},
): CollaborationRequestEntity {
  return {
    id: REQUEST_ID,
    organizationId: ORG_ID,
    requesterId: CABINET_USER_ID,
    assigneeId: CLIENT_USER_ID,
    status: 'open' as CollaborationStatus,
    title: 'Envoyez la facture EDF',
    description: 'Pour passer la dotation des charges externes',
    linkedEntryId: null,
    linkedDocumentId: null,
    dueDate: '2026-06-30',
    completedAt: null,
    completedBy: null,
    createdAt: new Date('2026-05-25T10:00:00Z'),
    updatedAt: new Date('2026-05-25T10:00:00Z'),
    ...overrides,
  } as CollaborationRequestEntity;
}

function makeComment(
  overrides: Partial<CollaborationCommentEntity> = {},
): CollaborationCommentEntity {
  return {
    id: COMMENT_ID,
    organizationId: ORG_ID,
    requestId: REQUEST_ID,
    authorId: CLIENT_USER_ID,
    body: 'Voici la facture',
    createdAt: new Date('2026-05-25T11:00:00Z'),
    ...overrides,
  } as CollaborationCommentEntity;
}

interface Mocks {
  requests: jest.Mocked<CollaborationRequestRepository>;
  comments: jest.Mocked<CollaborationCommentRepository>;
  notifications: jest.Mocked<CollaborationNotificationsService>;
  audit: jest.Mocked<AuditTrailService>;
}

function buildService(overrides: Partial<Mocks> = {}): {
  service: CollaborationRequestsService;
  mocks: Mocks;
} {
  const requests = {
    findById: jest.fn(),
    createOne: jest.fn(),
    updateStatus: jest.fn(),
    listForOrg: jest.fn(),
    ...overrides.requests,
  } as unknown as jest.Mocked<CollaborationRequestRepository>;

  const comments = {
    createOne: jest.fn(),
    listByRequest: jest.fn(),
    ...overrides.comments,
  } as unknown as jest.Mocked<CollaborationCommentRepository>;

  const notifications = {
    notifyRequestCreated: jest.fn().mockResolvedValue(undefined),
    notifyStatusChanged: jest.fn().mockResolvedValue(undefined),
    notifyCommentAdded: jest.fn().mockResolvedValue(undefined),
    ...overrides.notifications,
  } as unknown as jest.Mocked<CollaborationNotificationsService>;

  const audit = {
    record: jest.fn().mockResolvedValue(null),
    ...overrides.audit,
  } as unknown as jest.Mocked<AuditTrailService>;

  const service = new CollaborationRequestsService(requests, comments, notifications, audit);
  return { service, mocks: { requests, comments, notifications, audit } };
}

describe('isStatusTransitionAllowed (state machine)', () => {
  it.each<[CollaborationStatus, CollaborationStatus, boolean]>([
    ['open', 'in_progress', true],
    ['open', 'cancelled', true],
    ['open', 'completed', false],
    ['open', 'open', false],
    ['in_progress', 'completed', true],
    ['in_progress', 'open', true],
    ['in_progress', 'cancelled', true],
    ['completed', 'in_progress', true],
    ['completed', 'cancelled', false],
    ['completed', 'open', false],
    ['cancelled', 'in_progress', false],
    ['cancelled', 'open', false],
    ['cancelled', 'completed', false],
  ])('%s → %s allowed=%s', (from, to, expected) => {
    expect(isStatusTransitionAllowed(from, to)).toBe(expected);
  });
});

describe('CollaborationRequestsService.createRequest', () => {
  it('crée une demande, journalise et notifie', async () => {
    const { service, mocks } = buildService();
    const row = makeRequest();
    mocks.requests.createOne.mockResolvedValue(row);

    const view = await service.createRequest(ORG_ID, CABINET_USER_ID, {
      title: '  Envoyez la facture EDF  ',
      description: '  Pour la dotation  ',
      assigneeId: CLIENT_USER_ID,
      linkedEntryId: null,
      linkedDocumentId: DOCUMENT_ID,
      dueDate: '2026-06-30',
    });

    expect(view.id).toBe(REQUEST_ID);
    expect(view.status).toBe('open');
    expect(mocks.requests.createOne).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Envoyez la facture EDF',
        description: 'Pour la dotation',
        assigneeId: CLIENT_USER_ID,
        linkedDocumentId: DOCUMENT_ID,
      }),
    );
    expect(mocks.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        module: 'collaboration',
        action: 'request_created',
        entityId: REQUEST_ID,
      }),
    );
    // Fire-and-forget — la notification est appelée mais non awaitée
    // dans le service ; on vérifie qu'elle a bien été déclenchée.
    expect(mocks.notifications.notifyRequestCreated).toHaveBeenCalledWith(row);
  });

  it('rejette un titre vide en COLLAB_TITLE_REQUIRED', async () => {
    const { service, mocks } = buildService();
    await expect(
      service.createRequest(ORG_ID, CABINET_USER_ID, {
        title: '   ',
        description: null,
        assigneeId: null,
        linkedEntryId: null,
        linkedDocumentId: null,
        dueDate: null,
      }),
    ).rejects.toMatchObject({
      code: ERROR_CODES.COLLAB_TITLE_REQUIRED,
    });
    expect(mocks.requests.createOne).not.toHaveBeenCalled();
  });

  it('mappe une violation de FK en COLLAB_LINKED_NOT_FOUND (422)', async () => {
    const { service } = buildService();
    const fkError = Object.assign(new Error('FK fail'), { code: '23503' });
    const { mocks } = buildService({
      requests: { createOne: jest.fn().mockRejectedValue(fkError) } as never,
    });
    // On rebranche le service sur ces mocks-ci.
    const svc = new CollaborationRequestsService(
      mocks.requests,
      mocks.comments,
      mocks.notifications,
      mocks.audit,
    );

    await expect(
      svc.createRequest(ORG_ID, CABINET_USER_ID, {
        title: 'X',
        description: null,
        assigneeId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        linkedEntryId: null,
        linkedDocumentId: null,
        dueDate: null,
      }),
    ).rejects.toMatchObject({
      code: ERROR_CODES.COLLAB_LINKED_NOT_FOUND,
    });
    // Variable inutilisée — éteint le lint.
    expect(service).toBeDefined();
  });
});

describe('CollaborationRequestsService.updateStatus', () => {
  it('open → in_progress autorisé pour un cabinet', async () => {
    const { service, mocks } = buildService();
    const row = makeRequest({ status: 'open' });
    mocks.requests.findById
      .mockResolvedValueOnce(row)
      .mockResolvedValueOnce({ ...row, status: 'in_progress' } as CollaborationRequestEntity);
    mocks.requests.updateStatus.mockResolvedValue(true);

    const view = await service.updateStatus(
      ORG_ID,
      REQUEST_ID,
      CABINET_USER_ID,
      'cabinet',
      'in_progress',
    );

    expect(view.status).toBe('in_progress');
    expect(mocks.requests.updateStatus).toHaveBeenCalledWith(
      ORG_ID,
      REQUEST_ID,
      expect.objectContaining({ status: 'in_progress', completedAt: null, completedBy: null }),
    );
    expect(mocks.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'request_status_changed',
        before: { status: 'open' },
        after: { status: 'in_progress' },
      }),
    );
  });

  it('in_progress → completed stamp completed_at + completed_by', async () => {
    const { service, mocks } = buildService();
    const row = makeRequest({ status: 'in_progress' });
    const refreshed = makeRequest({
      status: 'completed',
      completedAt: new Date('2026-05-25T12:00:00Z'),
      completedBy: CLIENT_USER_ID,
    });
    mocks.requests.findById.mockResolvedValueOnce(row).mockResolvedValueOnce(refreshed);
    mocks.requests.updateStatus.mockResolvedValue(true);

    const view = await service.updateStatus(
      ORG_ID,
      REQUEST_ID,
      CLIENT_USER_ID,
      'client',
      'completed',
    );

    expect(view.status).toBe('completed');
    expect(view.completedBy).toBe(CLIENT_USER_ID);
    expect(mocks.requests.updateStatus).toHaveBeenCalledWith(
      ORG_ID,
      REQUEST_ID,
      expect.objectContaining({
        status: 'completed',
        completedBy: CLIENT_USER_ID,
        completedAt: expect.any(Date),
      }),
    );
  });

  it('open → completed rejeté en COLLAB_INVALID_TRANSITION', async () => {
    const { service, mocks } = buildService();
    mocks.requests.findById.mockResolvedValue(makeRequest({ status: 'open' }));

    await expect(
      service.updateStatus(ORG_ID, REQUEST_ID, CABINET_USER_ID, 'cabinet', 'completed'),
    ).rejects.toMatchObject({
      code: ERROR_CODES.COLLAB_INVALID_TRANSITION,
      details: { from: 'open', to: 'completed' },
    });
    expect(mocks.requests.updateStatus).not.toHaveBeenCalled();
  });

  it('un client ne peut pas voir / muter une demande non assignée', async () => {
    const { service, mocks } = buildService();
    mocks.requests.findById.mockResolvedValue(
      makeRequest({ status: 'open', assigneeId: OTHER_CLIENT_ID }),
    );

    await expect(
      service.updateStatus(ORG_ID, REQUEST_ID, CLIENT_USER_ID, 'client', 'in_progress'),
    ).rejects.toMatchObject({
      code: ERROR_CODES.COLLAB_REQUEST_NOT_FOUND,
    });
  });

  it('demande inexistante remonte COLLAB_REQUEST_NOT_FOUND', async () => {
    const { service, mocks } = buildService();
    mocks.requests.findById.mockResolvedValue(null);

    await expect(
      service.updateStatus(ORG_ID, REQUEST_ID, CABINET_USER_ID, 'cabinet', 'in_progress'),
    ).rejects.toBeInstanceOf(AppException);
  });
});

describe('CollaborationRequestsService.addComment', () => {
  it('crée un commentaire pour le client assignee', async () => {
    const { service, mocks } = buildService();
    const row = makeRequest({ status: 'in_progress' });
    mocks.requests.findById.mockResolvedValue(row);
    mocks.comments.createOne.mockResolvedValue(makeComment());

    const view = await service.addComment(
      ORG_ID,
      REQUEST_ID,
      CLIENT_USER_ID,
      'client',
      'Voici la facture',
    );

    expect(view.id).toBe(COMMENT_ID);
    expect(view.authorId).toBe(CLIENT_USER_ID);
    expect(mocks.comments.createOne).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      requestId: REQUEST_ID,
      authorId: CLIENT_USER_ID,
      body: 'Voici la facture',
    });
    expect(mocks.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'comment_added',
        after: expect.objectContaining({ requestId: REQUEST_ID }),
      }),
    );
    // PII guard : le body n'est PAS journalisé dans `after`.
    const afterPayload = (
      mocks.audit.record.mock.calls[0][0] as { after?: Record<string, unknown> }
    ).after;
    expect(afterPayload).not.toHaveProperty('body');
  });

  it('refuse un commentaire vide (post-trim)', async () => {
    const { service, mocks } = buildService();
    await expect(
      service.addComment(ORG_ID, REQUEST_ID, CABINET_USER_ID, 'cabinet', '   \n  '),
    ).rejects.toMatchObject({
      code: ERROR_CODES.COLLAB_COMMENT_EMPTY,
    });
    expect(mocks.requests.findById).not.toHaveBeenCalled();
  });

  it("bloque l'ajout d'un commentaire sur une demande completed", async () => {
    const { service, mocks } = buildService();
    mocks.requests.findById.mockResolvedValue(makeRequest({ status: 'completed' }));

    await expect(
      service.addComment(ORG_ID, REQUEST_ID, CABINET_USER_ID, 'cabinet', 'Encore un mot'),
    ).rejects.toMatchObject({
      code: ERROR_CODES.COLLAB_REQUEST_CLOSED,
    });
    expect(mocks.comments.createOne).not.toHaveBeenCalled();
  });

  it('un client ne peut pas commenter une demande non assignée', async () => {
    const { service, mocks } = buildService();
    mocks.requests.findById.mockResolvedValue(
      makeRequest({ status: 'in_progress', assigneeId: OTHER_CLIENT_ID }),
    );

    await expect(
      service.addComment(ORG_ID, REQUEST_ID, CLIENT_USER_ID, 'client', 'bonjour'),
    ).rejects.toMatchObject({
      code: ERROR_CODES.COLLAB_REQUEST_NOT_FOUND,
    });
  });
});

describe('CollaborationRequestsService.listForActor', () => {
  it('scope cabinet : pas de filtre assignee imposé', async () => {
    const { service, mocks } = buildService();
    mocks.requests.listForOrg.mockResolvedValue({ rows: [], total: 0 });

    await service.listForActor(
      ORG_ID,
      CABINET_USER_ID,
      'cabinet',
      { status: 'open' },
      { page: 1, pageSize: 20 },
    );

    expect(mocks.requests.listForOrg).toHaveBeenCalledWith(
      ORG_ID,
      { status: 'open' },
      { page: 1, pageSize: 20 },
    );
  });

  it('scope client : assignee_id forcé à actorUserId (même si client passe un autre id)', async () => {
    const { service, mocks } = buildService();
    mocks.requests.listForOrg.mockResolvedValue({ rows: [], total: 0 });

    await service.listForActor(
      ORG_ID,
      CLIENT_USER_ID,
      'client',
      { assigneeId: OTHER_CLIENT_ID },
      { page: 1, pageSize: 20 },
    );

    // L'override hostile assignee=<autre> doit avoir été écrasé par
    // l'actorUserId.
    expect(mocks.requests.listForOrg).toHaveBeenCalledWith(
      ORG_ID,
      expect.objectContaining({ assigneeId: CLIENT_USER_ID }),
      { page: 1, pageSize: 20 },
    );
  });
});
