/**
 * Module 9 — W2.4 : registre des 36 notes annexes SYSCOHADA.
 *
 * Chaque entrée :
 *   - métadonnées statiques (id, label, section, applicableByDefault)
 *   - handler associé (fonction asynchrone qui calcule les rows)
 *
 * 10 notes critiques implémentées dans cette session (W2.4.a) :
 *   N1, N2, N3A, N3C, N3D, N6, N7, N17, N18, N28
 *
 * 26 notes restantes en stub avec `NotImplementedError` :
 *   N3B, N4, N5, N8, N9, N10, N11, N12, N13, N14, N15, N16, N19, N20,
 *   N21, N22, N23, N24, N25, N26, N27, N29, N30, N31, N32, N33, N34,
 *   N35, N36
 *
 * Implémentation des restantes : voir issue de roadmap W2.4.b.
 */

import { handleN1Referentiel } from './handlers/note-1-referentiel';
import { handleN17Fournisseurs } from './handlers/note-17-fournisseurs';
import { handleN18FiscalSocial } from './handlers/note-18-fiscal-social';
import { handleN2Conformite } from './handlers/note-2-conformite';
import { handleN28Provisions } from './handlers/note-28-provisions';
import { handleN3aImmoCorp } from './handlers/note-3a-immo-corp';
import { handleN3cCessions } from './handlers/note-3c-cessions';
import { handleN3dAmort } from './handlers/note-3d-amort';
import { handleN6Stocks } from './handlers/note-6-stocks';
import { handleN7Clients } from './handlers/note-7-clients';
import { type NoteHandler, type NoteId, type NoteMetadata, NotImplementedError } from './types';

/** Factory pour un handler stub. */
function stub(noteId: NoteId, jsdocSummary: string): NoteHandler {
  // jsdocSummary est conservé pour la doc API future.
  void jsdocSummary;
  return async () => {
    throw new NotImplementedError(noteId, 'W2.4.b');
  };
}

interface NoteRegistryEntry {
  readonly metadata: NoteMetadata;
  readonly handler: NoteHandler;
}

/**
 * Mapping ordonné NoteId → { metadata, handler }. L'ordre d'itération
 * suit la numérotation de la liasse SYSCOHADA (annexe Tome 3).
 */
export const NOTE_REGISTRY: ReadonlyMap<NoteId, NoteRegistryEntry> = new Map<
  NoteId,
  NoteRegistryEntry
>([
  // ───────────────────────── Section GENERAL / IDENTIFICATION ─────────────────
  [
    'N1' as NoteId,
    {
      metadata: {
        id: 'N1' as NoteId,
        label: 'Note 1 — Référentiel comptable, méthodes et changements',
        section: 'IDENTIFICATION',
        applicableByDefault: true,
      },
      handler: handleN1Referentiel,
    },
  ],
  [
    'N2' as NoteId,
    {
      metadata: {
        id: 'N2' as NoteId,
        label: 'Note 2 — Déclaration de conformité au PCGO',
        section: 'IDENTIFICATION',
        applicableByDefault: true,
      },
      handler: handleN2Conformite,
    },
  ],

  // ─────────────────────────────── Section BILAN ──────────────────────────────
  [
    'N3A' as NoteId,
    {
      metadata: {
        id: 'N3A' as NoteId,
        label: 'Note 3A — Immobilisations corporelles : tableau de variation',
        section: 'BILAN',
        applicableByDefault: true,
      },
      handler: handleN3aImmoCorp,
    },
  ],
  /**
   * Note 3B — Immobilisations incorporelles : tableau de variation.
   * Tableau analogue à 3A mais sur comptes 21x (frais d'étab.,
   * R&D, brevets, logiciels…). Demande filtrage par classe d'actif.
   */
  [
    'N3B' as NoteId,
    {
      metadata: meta('N3B', 'Note 3B — Immobilisations incorporelles', 'BILAN', true),
      handler: stub('N3B' as NoteId, 'Variation des incorporelles (21x)'),
    },
  ],
  [
    'N3C' as NoteId,
    {
      metadata: meta('N3C', 'Note 3C — Plus-values et moins-values de cession', 'BILAN', true),
      handler: handleN3cCessions,
    },
  ],
  [
    'N3D' as NoteId,
    {
      metadata: meta('N3D', 'Note 3D — Amortissements de la période', 'BILAN', true),
      handler: handleN3dAmort,
    },
  ],
  /** Note 4 — Immobilisations financières : titres de participation, créances rattachées. */
  [
    'N4' as NoteId,
    {
      metadata: meta('N4', 'Note 4 — Immobilisations financières', 'BILAN', true),
      handler: stub('N4' as NoteId, 'Titres + créances rattachées (26x/27x)'),
    },
  ],
  /** Note 5 — Actif circulant HAO. */
  [
    'N5' as NoteId,
    {
      metadata: meta('N5', 'Note 5 — Actif circulant HAO', 'BILAN', false),
      handler: stub('N5' as NoteId, 'Comptes 485, 488'),
    },
  ],
  [
    'N6' as NoteId,
    {
      metadata: meta('N6', 'Note 6 — Stocks et en-cours', 'BILAN', true),
      handler: handleN6Stocks,
    },
  ],
  [
    'N7' as NoteId,
    {
      metadata: meta('N7', 'Note 7 — Clients et comptes rattachés', 'BILAN', true),
      handler: handleN7Clients,
    },
  ],
  /** Note 8 — Autres créances (4xx hors clients/fourn.). */
  [
    'N8' as NoteId,
    {
      metadata: meta('N8', 'Note 8 — Autres créances', 'BILAN', true),
      handler: stub('N8' as NoteId, 'Comptes 42x/43x/44x/47x débiteurs'),
    },
  ],
  /** Note 9 — Titres de placement (50x). */
  [
    'N9' as NoteId,
    {
      metadata: meta('N9', 'Note 9 — Titres de placement', 'BILAN', false),
      handler: stub('N9' as NoteId, 'Comptes 50x'),
    },
  ],
  /** Note 10 — Valeurs à encaisser (51x). */
  [
    'N10' as NoteId,
    {
      metadata: meta('N10', 'Note 10 — Valeurs à encaisser', 'BILAN', true),
      handler: stub('N10' as NoteId, 'Comptes 51x'),
    },
  ],
  /** Note 11 — Disponibilités (52x à 57x). */
  [
    'N11' as NoteId,
    {
      metadata: meta('N11', 'Note 11 — Disponibilités', 'BILAN', true),
      handler: stub('N11' as NoteId, 'Banques/caisse 52x..57x'),
    },
  ],
  /** Note 12 — Écarts de conversion-actif (478). */
  [
    'N12' as NoteId,
    {
      metadata: meta('N12', 'Note 12 — Écarts de conversion-actif', 'BILAN', false),
      handler: stub('N12' as NoteId, 'Compte 478'),
    },
  ],
  /** Note 13 — Capital social et primes liées. */
  [
    'N13' as NoteId,
    {
      metadata: meta('N13', 'Note 13 — Capital social et primes', 'BILAN', true),
      handler: stub('N13' as NoteId, 'Comptes 101..104'),
    },
  ],
  /** Note 14 — Réserves et report à nouveau. */
  [
    'N14' as NoteId,
    {
      metadata: meta('N14', 'Note 14 — Réserves et report à nouveau', 'BILAN', true),
      handler: stub('N14' as NoteId, 'Comptes 11x/12x'),
    },
  ],
  /** Note 15 — Subventions d'investissement. */
  [
    'N15' as NoteId,
    {
      metadata: meta('N15', "Note 15 — Subventions d'investissement", 'BILAN', false),
      handler: stub('N15' as NoteId, 'Compte 14'),
    },
  ],
  /** Note 16 — Emprunts et dettes financières. */
  [
    'N16' as NoteId,
    {
      metadata: meta('N16', 'Note 16 — Emprunts et dettes financières', 'BILAN', true),
      handler: stub('N16' as NoteId, 'Comptes 16x/17x ventilés ≤1an / >1an'),
    },
  ],
  [
    'N17' as NoteId,
    {
      metadata: meta('N17', "Note 17 — Fournisseurs d'exploitation", 'BILAN', true),
      handler: handleN17Fournisseurs,
    },
  ],
  [
    'N18' as NoteId,
    {
      metadata: meta('N18', 'Note 18 — Dettes fiscales et sociales', 'BILAN', true),
      handler: handleN18FiscalSocial,
    },
  ],
  /** Note 19 — Autres dettes d'exploitation. */
  [
    'N19' as NoteId,
    {
      metadata: meta('N19', "Note 19 — Autres dettes d'exploitation", 'BILAN', true),
      handler: stub('N19' as NoteId, 'Comptes 42x/47x créditeurs hors fisc/social'),
    },
  ],
  /** Note 20 — Concours bancaires et soldes créditeurs de banques. */
  [
    'N20' as NoteId,
    {
      metadata: meta('N20', 'Note 20 — Concours bancaires courants', 'BILAN', false),
      handler: stub('N20' as NoteId, 'Comptes 56x créditeurs'),
    },
  ],
  /** Note 21 — Écarts de conversion-passif (479). */
  [
    'N21' as NoteId,
    {
      metadata: meta('N21', 'Note 21 — Écarts de conversion-passif', 'BILAN', false),
      handler: stub('N21' as NoteId, 'Compte 479'),
    },
  ],

  // ───────────────────────────── Section COMPTE DE RÉSULTAT ────────────────────
  /** Note 22 — Ventes et autres produits d'exploitation (70x..75x). */
  [
    'N22' as NoteId,
    {
      metadata: meta('N22', "Note 22 — Chiffre d'affaires et autres produits", 'CR', true),
      handler: stub('N22' as NoteId, 'Comptes 70x..75x'),
    },
  ],
  /** Note 23 — Achats consommés (60x). */
  [
    'N23' as NoteId,
    {
      metadata: meta('N23', 'Note 23 — Achats consommés', 'CR', true),
      handler: stub('N23' as NoteId, 'Comptes 60x avec variation de stock'),
    },
  ],
  /** Note 24 — Services extérieurs et autres consommations (61x..65x). */
  [
    'N24' as NoteId,
    {
      metadata: meta('N24', 'Note 24 — Services extérieurs et autres', 'CR', true),
      handler: stub('N24' as NoteId, 'Comptes 61x..65x'),
    },
  ],
  /** Note 25 — Charges de personnel (66x). */
  [
    'N25' as NoteId,
    {
      metadata: meta('N25', 'Note 25 — Charges de personnel', 'CR', true),
      handler: stub('N25' as NoteId, 'Comptes 66x'),
    },
  ],
  /** Note 26 — Dotations aux amortissements et provisions (68x). */
  [
    'N26' as NoteId,
    {
      metadata: meta('N26', 'Note 26 — Dotations amortissements et provisions', 'CR', true),
      handler: stub('N26' as NoteId, 'Comptes 68x — recoupe N3D'),
    },
  ],
  /** Note 27 — Charges et produits financiers (67x/77x). */
  [
    'N27' as NoteId,
    {
      metadata: meta('N27', 'Note 27 — Charges et produits financiers', 'CR', true),
      handler: stub('N27' as NoteId, 'Comptes 67x/77x'),
    },
  ],
  [
    'N28' as NoteId,
    {
      metadata: meta(
        'N28',
        'Note 28 — Provisions financières pour risques et charges',
        'BILAN',
        true,
      ),
      handler: handleN28Provisions,
    },
  ],
  /** Note 29 — Charges et produits HAO (83x/84x). */
  [
    'N29' as NoteId,
    {
      metadata: meta('N29', 'Note 29 — Charges et produits HAO', 'CR', false),
      handler: stub('N29' as NoteId, 'Comptes 83x/84x — hors activité ordinaire'),
    },
  ],
  /** Note 30 — Impôt sur le résultat (89x/87x). */
  [
    'N30' as NoteId,
    {
      metadata: meta('N30', 'Note 30 — Impôt sur le résultat', 'CR', true),
      handler: stub('N30' as NoteId, 'Comptes 89x avec réconciliation taux'),
    },
  ],

  // ───────────────────────────── Section TFT + GÉNÉRAL ─────────────────────────
  /** Note 31 — Tableau des flux de trésorerie (TFT) — détail. */
  [
    'N31' as NoteId,
    {
      metadata: meta('N31', 'Note 31 — Tableau des flux de trésorerie (détail)', 'TFT', true),
      handler: stub('N31' as NoteId, 'Reprise du TFT avec ventilation'),
    },
  ],
  /** Note 32 — Effectif moyen, masse salariale, organes de direction. */
  [
    'N32' as NoteId,
    {
      metadata: meta('N32', 'Note 32 — Effectif et rémunérations dirigeants', 'GENERAL', true),
      handler: stub('N32' as NoteId, 'Effectif moyen + jetons de présence'),
    },
  ],
  /** Note 33 — Engagements hors bilan donnés / reçus. */
  [
    'N33' as NoteId,
    {
      metadata: meta('N33', 'Note 33 — Engagements hors bilan', 'GENERAL', true),
      handler: stub('N33' as NoteId, 'Cautions, garanties, crédits-bails'),
    },
  ],
  /** Note 34 — Parties liées (transactions intragroupe). */
  [
    'N34' as NoteId,
    {
      metadata: meta('N34', 'Note 34 — Parties liées', 'GENERAL', false),
      handler: stub('N34' as NoteId, 'IAS 24 transposé OHADA'),
    },
  ],
  /** Note 35 — Événements postérieurs à la clôture. */
  [
    'N35' as NoteId,
    {
      metadata: meta('N35', 'Note 35 — Événements postérieurs à la clôture', 'GENERAL', true),
      handler: stub('N35' as NoteId, 'Texte libre + classification ajustant/non-ajustant'),
    },
  ],
  /** Note 36 — Informations sectorielles. */
  [
    'N36' as NoteId,
    {
      metadata: meta('N36', 'Note 36 — Informations sectorielles', 'GENERAL', false),
      handler: stub('N36' as NoteId, 'Ventilation CA + résultat par segment'),
    },
  ],
]);

/** Helper interne pour construire une métadonnée. */
function meta(
  id: string,
  label: string,
  section: NoteMetadata['section'],
  applicableByDefault: boolean,
): NoteMetadata {
  return { id: id as NoteId, label, section, applicableByDefault };
}

/** Liste ordonnée des NoteIds (pour `getAllNotes`). */
export const ALL_NOTE_IDS: ReadonlyArray<NoteId> = Array.from(NOTE_REGISTRY.keys());
