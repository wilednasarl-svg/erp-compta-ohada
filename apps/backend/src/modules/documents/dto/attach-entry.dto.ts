import { IsUUID } from 'class-validator';

/**
 * Body of `POST /documents/:docId/attach-entry` — Module 10 wave 2.
 *
 * The path supplies the document id; the body carries the journal
 * entry id. Both ids must resolve within the caller's tenant — the
 * service rejects with `DOC_NOT_FOUND` / `JOURNAL_ENTRY_NOT_FOUND`
 * otherwise.
 */
export class AttachEntryDto {
  @IsUUID('4')
  journalEntryId!: string;
}
