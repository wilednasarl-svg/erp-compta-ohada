import { NotFoundException } from '@nestjs/common';

import type { EntrySignatureEntity } from '../entities/entry-signature.entity';
import type { JournalEntryEntity } from '../entities/journal-entry.entity';
import { SignatureVerifyController } from '../controllers/signature-verify.controller';
import { computeEntrySignatureHash } from '../lib/signature-hash';

const ORG_ID = '00000000-0000-4000-8000-000000000001';
const ENTRY_ID = '00000000-0000-4000-8000-000000000010';
const SIG_ID = '00000000-0000-4000-8000-000000000020';

function makeEntry(overrides: Partial<JournalEntryEntity> = {}): JournalEntryEntity {
  return {
    id: ENTRY_ID,
    organizationId: ORG_ID,
    journalId: 'j-1',
    periodId: 'p-1',
    entryNumber: 42,
    entryDate: '2026-02-15',
    description: 'Originale',
    reference: null,
    status: 'validated',
    cancelsId: null,
    sourceType: 'manual',
    sourceImportSessionId: null,
    createdById: null,
    validatedAt: null,
    validatedById: null,
    cancelledAt: null,
    cancelledById: null,
    cancelledReason: null,
    ...overrides,
  } as JournalEntryEntity;
}

function makeSignature(hash: string): EntrySignatureEntity {
  return {
    id: SIG_ID,
    organizationId: ORG_ID,
    journalEntryId: ENTRY_ID,
    signerId: 'u-1',
    signerRole: 'expert_comptable',
    signatureHash: hash,
    comment: null,
    signedAt: new Date('2026-02-16T09:00:00Z'),
  } as EntrySignatureEntity;
}

function build(opts: {
  entry?: JournalEntryEntity | null;
  signature?: EntrySignatureEntity | null;
  lines?: unknown[];
}) {
  const signatures = {
    findById: jest.fn().mockResolvedValue(opts.signature ?? null),
  };
  const entries = {
    findById: jest.fn().mockResolvedValue(opts.entry ?? null),
  };
  const lines = {
    listByEntry: jest.fn().mockResolvedValue(opts.lines ?? []),
  };
  const controller = new SignatureVerifyController(
    signatures as never,
    entries as never,
    lines as never,
  );
  return { controller, signatures, entries, lines };
}

describe('SignatureVerifyController.verify', () => {
  it('returns valid: true when the recomputed hash still matches', async () => {
    const entry = makeEntry();
    const hash = computeEntrySignatureHash(entry, []);
    const sig = makeSignature(hash);
    const { controller } = build({ entry, signature: sig, lines: [] });

    const result = await controller.verify(SIG_ID);

    expect(result.valid).toBe(true);
    expect(result.signerRole).toBe('expert_comptable');
    expect(result.entryRef).toBe(ENTRY_ID);
    expect(result.reason).toBeUndefined();
  });

  it('returns valid: false with reason=tampered when entry description was mutated post-signature', async () => {
    const original = makeEntry();
    const originalHash = computeEntrySignatureHash(original, []);
    // The signature carries the ORIGINAL hash. The repo returns a
    // mutated entry (e.g. description changed after signing).
    const tampered = makeEntry({ description: 'Modifie apres signature' });
    const sig = makeSignature(originalHash);
    const { controller } = build({ entry: tampered, signature: sig, lines: [] });

    const result = await controller.verify(SIG_ID);

    expect(result.valid).toBe(false);
    expect(result.reason).toBe('tampered');
    expect(result.signerRole).toBe('expert_comptable');
  });

  it('throws NotFoundException when the signature id does not exist', async () => {
    const { controller } = build({ signature: null });
    await expect(controller.verify(SIG_ID)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns valid: false when the signed entry has been deleted', async () => {
    const sig = makeSignature('a'.repeat(64));
    const { controller } = build({ signature: sig, entry: null });
    const result = await controller.verify(SIG_ID);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('tampered');
    expect(result.entryRef).toBeNull();
  });
});
