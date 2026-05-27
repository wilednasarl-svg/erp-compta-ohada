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
 * Liste figée des 36 notes annexes AUDCIF (Tome 3 p. 31). Sert de
 * référence pour générer la fiche R4 — toute note absente du profile
 * est considérée NOT_APPLICABLE par défaut.
 */
export const AUDCIF_ANNEXE_NOTES: ReadonlyArray<string> = Object.freeze([
  'N1',
  'N2',
  'N3',
  'N3A',
  'N3B',
  'N3C',
  'N3D',
  'N3E',
  'N4',
  'N5',
  'N6',
  'N7',
  'N8',
  'N9',
  'N10',
  'N11',
  'N12',
  'N13',
  'N14',
  'N15',
  'N16',
  'N17',
  'N18',
  'N19',
  'N20',
  'N21',
  'N22',
  'N23',
  'N24',
  'N25',
  'N26',
  'N27',
  'N28',
  'N29',
  'N30',
  'N31',
  'N32',
  'N33',
  'N34',
  'N35',
  'N36',
]);
