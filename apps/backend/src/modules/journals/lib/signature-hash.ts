import { createHash } from 'node:crypto';

import type { JournalEntryLineEntity } from '../entities/journal-entry-line.entity';
import type { JournalEntryEntity } from '../entities/journal-entry.entity';

/**
 * Canonical SHA-256 of an entry + its lines. Mirrors the projection used
 * by `EntryWorkflowService.computeSignatureHash` (Module 14 wave 1):
 * keys ordered, lines sorted by position, decimals stringified. Lifted
 * to a shared helper so the public `/verify-signature/:id` endpoint can
 * recompute the same hash and detect any post-signature tampering.
 *
 * Any future change to the canonical shape MUST be coordinated across
 * both call sites (signer + verifier) or every existing signature will
 * read as `valid: false`.
 */
export function computeEntrySignatureHash(
  entry: Pick<
    JournalEntryEntity,
    | 'id'
    | 'organizationId'
    | 'journalId'
    | 'periodId'
    | 'entryNumber'
    | 'entryDate'
    | 'description'
    | 'reference'
  >,
  lines: ReadonlyArray<JournalEntryLineEntity>,
): string {
  const canonical = {
    entryId: entry.id,
    organizationId: entry.organizationId,
    journalId: entry.journalId,
    periodId: entry.periodId,
    entryNumber: entry.entryNumber,
    entryDate: entry.entryDate,
    description: entry.description,
    reference: entry.reference,
    lines: lines
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((l) => ({
        position: l.position,
        accountId: l.accountId,
        debit: String(l.debit),
        credit: String(l.credit),
        description: l.description ?? null,
      })),
  };
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}
