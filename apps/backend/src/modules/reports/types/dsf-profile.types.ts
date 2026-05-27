/**
 * Types véhiculés par `DsfIdentificationService` pour assembler la
 * liasse SYSCOHADA. Tous immuables (readonly) pour ne pas exposer la
 * mutation d'un état partagé à travers les couches.
 *
 * Les Fiches R1 à R4 correspondent à la nomenclature du Tome 3
 * (p. 18-31) de la doctrine SYSCOHADA :
 *   - R1 : page de garde
 *   - R2 : identification de l'entité
 *   - R3 : dirigeants et commissaires aux comptes
 *   - R4 : tableau d'applicabilité des 36 notes annexes
 */

/** R1 — Page de garde. */
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

/** R2 — Identification (codes lettrés ZA-ZS de la doctrine). */
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

/** R3 — Dirigeants (codes ZAU). */
export interface DirectorsFicheData {
  readonly directorName: string | null;
  readonly directorTitle: string | null;
  readonly presidentName: string | null;
  readonly auditorName: string | null;
}

/** Statut d'applicabilité d'une note annexe. */
export type NoteApplicabilityStatus = 'APPLICABLE' | 'NOT_APPLICABLE';

export interface NoteApplicabilityEntry {
  readonly noteId: string;
  readonly status: NoteApplicabilityStatus;
}

/** R4 — Tableau d'applicabilité des 36 notes annexes AUDCIF. */
export interface NotesApplicabilityFicheData {
  readonly totalNotes: number;
  readonly applicableCount: number;
  readonly notApplicableCount: number;
  readonly entries: ReadonlyArray<NoteApplicabilityEntry>;
}

/**
 * Bundle final retourné par `buildAllFiches` — assemble R1+R2+R3+R4
 * en un seul payload pour les consommateurs (PDF builder, controller
 * REST, exporter XLSX).
 */
export interface DsfIdentificationBundle {
  readonly coverPage: CoverPageData;
  readonly r2: IdentificationFicheData;
  readonly r3: DirectorsFicheData;
  readonly r4: NotesApplicabilityFicheData;
}

/**
 * Liste OFFICIELLE des 45 notes annexes AUDCIF doctrine (Tome 3 p. 31).
 *
 * **B4 (sync registry)** — Cette constante était auparavant une
 * énumération en literal qui divergeait du `NOTE_REGISTRY` (nomenclature
 * legacy 41 entrées). Elle est désormais un re-export du
 * `ALL_NOTE_IDS` calculé depuis le registry pour garantir l'unicité de
 * la source de vérité. Toute note ajoutée / supprimée dans
 * `note-registry.ts` se propage automatiquement à la fiche R4.
 *
 * Ordre canonique (45 entrées) : N1, N2, N3A, N3B, N3C, N3D, N3E, N3F,
 * N4..N12, N13, N14, N15A, N15B, N16A, N16B, N16Bbis, N16C, N17..N19,
 * N21..N26, N27A, N27B, N28..N36. (N20 omis : non-réservé en R4.)
 */
import { ALL_NOTE_IDS } from '../services/notes-annexes/note-registry';

export const AUDCIF_ANNEXE_NOTES: ReadonlyArray<string> = Object.freeze(
  ALL_NOTE_IDS.map((id) => String(id)),
);
