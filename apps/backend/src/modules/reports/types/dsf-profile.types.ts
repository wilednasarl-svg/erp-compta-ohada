/**
 * Types carried by `DsfIdentificationService` to assemble the SYSCOHADA
 * filing bundle. All fields are readonly to avoid exposing shared mutation.
 *
 * Fiches R1 to R4 follow Tome 3:
 *   - R1: cover page
 *   - R2: entity identification
 *   - R3: directors and statutory auditors
 *   - R4: applicability table for annex notes and sub-notes
 */

/** R1 - Cover page. */
export interface CoverPageData {
  readonly organizationName: string;
  readonly organizationSlug: string;
  readonly legalForm: string | null;
  readonly capital: string | null;
  readonly currency: string;
  readonly exerciseId: string;
  readonly exerciseLabel: string;
  readonly exerciseStartDate: string;
  readonly exerciseEndDate: string;
  readonly country: string | null;
}

/** R2 - Identification (ZA-ZS lettered codes in the doctrine). */
export interface IdentificationFicheData {
  readonly organizationName: string;
  readonly legalForm: string | null;
  readonly taxRegime: string | null;
  readonly country: string | null;
  readonly ninea: string | null;
  readonly rccm: string | null;
  readonly siegeAddress: string | null;
  readonly siegeCity: string | null;
  readonly phone: string | null;
  readonly email: string | null;
  readonly activitySector: string | null;
  readonly workforceByQualification: Readonly<Record<string, number>>;
  readonly workforceTotal: number;
}

/** R3 - Directors (ZAU codes). */
export interface DirectorsFicheData {
  readonly directorName: string | null;
  readonly directorTitle: string | null;
  readonly presidentName: string | null;
  readonly auditorName: string | null;
}

/** Applicability status for an annex note. */
export type NoteApplicabilityStatus = 'APPLICABLE' | 'NOT_APPLICABLE';

export interface NoteApplicabilityEntry {
  readonly noteId: string;
  readonly status: NoteApplicabilityStatus;
}

/** R4 - Applicability table for AUDCIF annex notes and sub-notes. */
export interface NotesApplicabilityFicheData {
  readonly totalNotes: number;
  readonly applicableCount: number;
  readonly notApplicableCount: number;
  readonly entries: ReadonlyArray<NoteApplicabilityEntry>;
}

/**
 * Final bundle returned by `buildAllFiches`, consumed by the PDF builder,
 * REST controller, and XLSX exporter.
 */
export interface DsfIdentificationBundle {
  readonly coverPage: CoverPageData;
  readonly r2: IdentificationFicheData;
  readonly r3: DirectorsFicheData;
  readonly r4: NotesApplicabilityFicheData;
}

/**
 * Official AUDCIF annex note/sub-note list (46 entries).
 *
 * This constant re-exports `ALL_NOTE_IDS` from the canonical note registry
 * so R4 stays synchronized with the rendered annex engine.
 *
 * Canonical order: N1, N2, N3A, N3B, N3C, N3D, N3E, N3F, N4..N12,
 * N13, N14, N15A, N15B, N16A, N16B, N16Bbis, N16C, N17..N20,
 * N21..N26, N27A, N27B, N28..N36.
 */
import { ALL_NOTE_IDS } from '../services/notes-annexes/note-registry';

export const AUDCIF_ANNEXE_NOTES: ReadonlyArray<string> = Object.freeze(
  ALL_NOTE_IDS.map((id) => String(id)),
);
