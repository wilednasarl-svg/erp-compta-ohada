/**
 * Module 9 — W2.4 : barrel d'export du moteur Notes annexes SYSCOHADA.
 *
 * Le `NotesAnnexesService` n'est PAS encore wiré dans `reports.module.ts`
 * (cf. consignes W2.4.a — wiring en PR de follow-up W2.4.c). Cet
 * `index.ts` est néanmoins prêt à être consommé.
 */

export { NotesAnnexesService, type GetNoteRequest } from './notes-annexes.service';
export { NOTE_REGISTRY, ALL_NOTE_IDS } from './note-registry';
export {
  type NoteId,
  type NoteSection,
  type NoteMetadata,
  type NoteRow,
  type NoteContent,
  type NoteComputationContext,
  type NoteHandler,
  type NoteHandlerDependencies,
  type NoteReportsDeps,
  type NoteAssetsDeps,
  type NoteInventoryDeps,
  type NoteAccountsDeps,
  type NoteAssetRecord,
  type NoteDepreciationRecord,
  type NoteInventoryItem,
  NotImplementedError,
  STOCK_FAMILY_TO_ACCOUNT_ROOT,
  STOCK_FAMILY_LABELS,
} from './types';
