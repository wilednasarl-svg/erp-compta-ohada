import type { JournalEntryEntity } from '../entities/journal-entry.entity';
import type { EntryView } from '../services/entries.service';
import {
  JournalEntryDetailResponse,
  JournalEntryLineResponse,
  JournalEntryListItemResponse,
  ListEntriesResponse,
} from '../dto/responses';

/**
 * Mappers purs entité TypeORM / EntryView -> DTO de réponse OpenAPI.
 *
 * Règle d'or : aucune mutation de la source, aucun side-effect. Les
 * mappers sont le seul endroit qui connaît la forme des colonnes
 * TypeORM ; les controllers manipulent uniquement des DTO bien typés.
 *
 * Forme JSON **strictement préservée** par rapport au comportement
 * pré-DTO (sérialisation TypeORM directe ou retour EntryView) —
 * c'est un refactor de contrat, pas une refonte d'API.
 */

export function toJournalEntryListItem(
  entity: JournalEntryEntity,
): JournalEntryListItemResponse {
  return {
    id: entity.id,
    organizationId: entity.organizationId,
    journalId: entity.journalId,
    periodId: entity.periodId,
    entryNumber: entity.entryNumber,
    entryDate: entity.entryDate,
    description: entity.description,
    reference: entity.reference,
    status: entity.status,
    sourceType: entity.sourceType,
    sourceImportSessionId: entity.sourceImportSessionId,
    cancelsId: entity.cancelsId,
    createdById: entity.createdById,
    validatedById: entity.validatedById,
    validatedAt: entity.validatedAt,
    cancelledAt: entity.cancelledAt,
    cancelledById: entity.cancelledById,
    cancelledReason: entity.cancelledReason,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
  };
}

export function toJournalEntryDetail(view: EntryView): JournalEntryDetailResponse {
  const lines: JournalEntryLineResponse[] = view.lines.map((l) => ({
    id: l.id,
    accountId: l.accountId,
    position: l.position,
    description: l.description,
    debit: l.debit,
    credit: l.credit,
  }));

  return {
    id: view.id,
    organizationId: view.organizationId,
    journalCode: view.journalCode,
    periodId: view.periodId,
    entryNumber: view.entryNumber,
    entryDate: view.entryDate,
    description: view.description,
    reference: view.reference,
    status: view.status,
    sourceType: view.sourceType,
    createdById: view.createdById,
    validatedAt: view.validatedAt,
    cancelledAt: view.cancelledAt,
    lines,
  };
}

export function toListEntries(
  entities: ReadonlyArray<JournalEntryEntity>,
  total: number,
): ListEntriesResponse {
  return {
    entries: entities.map(toJournalEntryListItem),
    total,
  };
}
