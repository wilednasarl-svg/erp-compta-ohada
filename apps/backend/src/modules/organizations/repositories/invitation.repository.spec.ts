import type { Repository } from 'typeorm';

import { type InvitationEntity } from '../entities/invitation.entity';
import { InvitationRepository } from './invitation.repository';

/**
 * Architectural guardrail for BE-DB-11: `invitations` carries
 * `organization_id`, so every public method of `InvitationRepository`
 * MUST require a non-empty `organizationId` parameter. The tests below
 * prove that the tenant scope guard rejects empty values *before* any
 * DB call — including the token-hash lookup, which intentionally does
 * NOT trust the token alone to derive the org.
 */
describe('InvitationRepository — multi-tenant invariant', () => {
  function buildRepo(): {
    repo: InvitationRepository;
    inner: jest.Mocked<
      Pick<Repository<InvitationEntity>, 'find' | 'findOne' | 'create' | 'save' | 'update'>
    >;
  } {
    const inner = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      update: jest.fn(),
    } as unknown as jest.Mocked<
      Pick<Repository<InvitationEntity>, 'find' | 'findOne' | 'create' | 'save' | 'update'>
    >;
    const repo = new InvitationRepository(inner as unknown as Repository<InvitationEntity>);
    return { repo, inner };
  }

  it.each([
    ['findById', (r: InvitationRepository) => r.findById('inv-1', '')],
    ['findPendingByEmail', (r: InvitationRepository) => r.findPendingByEmail('a@b.c', '')],
    ['listByStatus', (r: InvitationRepository) => r.listByStatus('', 'pending')],
    ['findActiveByTokenHash', (r: InvitationRepository) => r.findActiveByTokenHash('hash', '')],
    [
      'create',
      (r: InvitationRepository) =>
        r.create('', {
          email: 'a@b.c',
          roleId: 'role-id',
          tokenHash: 'hash',
          invitedBy: 'user-id',
          expiresAt: new Date(),
        }),
    ],
    ['markAccepted', (r: InvitationRepository) => r.markAccepted('inv-1', '', new Date())],
    ['markRevoked', (r: InvitationRepository) => r.markRevoked('inv-1', '')],
    ['markExpired', (r: InvitationRepository) => r.markExpired('inv-1', '')],
  ])('%s rejects an empty organizationId before touching the DB', async (_name, call) => {
    const { repo, inner } = buildRepo();
    await expect(call(repo)).rejects.toThrow(/Tenant scope violation/);
    expect(inner.find).not.toHaveBeenCalled();
    expect(inner.findOne).not.toHaveBeenCalled();
    expect(inner.save).not.toHaveBeenCalled();
    expect(inner.update).not.toHaveBeenCalled();
  });
});
