/**
 * Types miroir du module backend `journals`. Voir
 *   apps/backend/src/modules/journals/services/entries.service.ts
 *   apps/backend/src/modules/journals/entities/journal-entry.entity.ts
 */

export type JournalEntryStatus = 'draft' | 'validated' | 'cancelled';

export type JournalEntrySourceType = 'manual' | 'import' | 'transformation';

export type JournalKind = 'AC' | 'VE' | 'BQ' | 'CA' | 'OD';

/** Shape retournée par POST /entries et GET /entries/:id (avec lignes). */
export interface EntryView {
  readonly id: string;
  readonly organizationId: string;
  readonly journalCode: string;
  readonly periodId: string;
  readonly entryNumber: number;
  readonly entryDate: string;
  readonly description: string;
  readonly reference: string | null;
  readonly status: JournalEntryStatus;
  readonly sourceType: JournalEntrySourceType;
  readonly createdById: string | null;
  readonly validatedAt: string | null;
  readonly cancelledAt: string | null;
  readonly lines: ReadonlyArray<EntryLineView>;
}

export interface EntryLineView {
  readonly id: string;
  readonly accountId: string;
  readonly position: number;
  readonly description: string | null;
  readonly debit: string; // DECIMAL serialisé en string (précision préservée)
  readonly credit: string;
}

/** Shape retournée par GET /entries (sans lignes, paginée). */
export interface EntryRow {
  readonly id: string;
  readonly journalId: string;
  readonly periodId: string;
  readonly entryNumber: number;
  readonly entryDate: string;
  readonly description: string;
  readonly reference: string | null;
  readonly status: JournalEntryStatus;
  readonly sourceType: JournalEntrySourceType;
  readonly createdAt: string;
  readonly validatedAt: string | null;
  readonly cancelledAt: string | null;
}

export interface JournalView {
  readonly id: string;
  readonly code: string;
  readonly label: string;
  readonly kind: JournalKind;
  readonly nextEntryNumber: number;
  readonly isActive: boolean;
}

export interface AccountingPeriodView {
  readonly id: string;
  readonly parentId: string | null;
  readonly kind: 'ANNUAL' | 'QUARTERLY' | 'MONTHLY';
  readonly label: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly status: 'open' | 'closed';
}

/** Payload pour POST /entries — miroir du DTO backend. */
export interface CreateEntryPayload {
  readonly journalCode: string;
  readonly entryDate: string;
  readonly description: string;
  readonly reference?: string | null;
  readonly lines: ReadonlyArray<CreateEntryLinePayload>;
}

export interface CreateEntryLinePayload {
  readonly accountCode: string;
  readonly debit: number;
  readonly credit: number;
  readonly description?: string | null;
}
