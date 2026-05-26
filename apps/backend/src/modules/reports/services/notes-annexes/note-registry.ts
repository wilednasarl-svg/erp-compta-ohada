/**
 * Module 9 — W2.4 : registre des 36 notes annexes SYSCOHADA.
 *
 * Chaque entrée :
 *   - métadonnées statiques (id, label, section, applicableByDefault)
 *   - handler associé (fonction asynchrone qui calcule les rows)
 *
 * 31 notes implémentées (W2.4.a + W2.4.b) :
 *   N1, N2, N3A, N3C, N3D, N4, N6, N7, N8, N9, N10, N11, N12, N13, N14,
 *   N15, N16, N17, N18, N19, N20, N21, N22, N23, N24, N25, N26, N27,
 *   N28, N29, N30
 *
 * 5 notes restantes en stub avec `NotImplementedError` :
 *   N3B (variation incorporelles — analogue N3A à scoper sur 21x)
 *   N5  (actif circulant HAO 485/488)
 *   N31 (TFT détaillé — dépend du module cash-flow)
 *   N32, N33, N34, N35, N36 (textes / infos non comptables)
 */

import { handleN1Referentiel } from './handlers/note-1-referentiel';
import { handleN10ValeursEncaisser } from './handlers/note-10-valeurs-encaisser';
import { handleN11Disponibilites } from './handlers/note-11-disponibilites';
import { handleN12ConversionActif } from './handlers/note-12-conversion-actif';
import { handleN13Capital } from './handlers/note-13-capital';
import { handleN14ReservesReport } from './handlers/note-14-reserves-report';
import { handleN15Subventions } from './handlers/note-15-subventions';
import { handleN16Emprunts } from './handlers/note-16-emprunts';
import { handleN17Fournisseurs } from './handlers/note-17-fournisseurs';
import { handleN18FiscalSocial } from './handlers/note-18-fiscal-social';
import { handleN19AutresDettes } from './handlers/note-19-autres-dettes';
import { handleN2Conformite } from './handlers/note-2-conformite';
import { handleN20ConcoursBancaires } from './handlers/note-20-concours-bancaires';
import { handleN21ConversionPassif } from './handlers/note-21-conversion-passif';
import { handleN22CaProduits } from './handlers/note-22-ca-produits';
import { handleN23Achats } from './handlers/note-23-achats';
import { handleN24ServicesExterieurs } from './handlers/note-24-services-exterieurs';
import { handleN25ChargesPersonnel } from './handlers/note-25-charges-personnel';
import { handleN26Dotations } from './handlers/note-26-dotations';
import { handleN27Financiers } from './handlers/note-27-financiers';
import { handleN28Provisions } from './handlers/note-28-provisions';
import { handleN29Hao } from './handlers/note-29-hao';
import { handleN30Impot } from './handlers/note-30-impot';
import { handleN3aImmoCorp } from './handlers/note-3a-immo-corp';
import { handleN3cCessions } from './handlers/note-3c-cessions';
import { handleN3dAmort } from './handlers/note-3d-amort';
import { handleN4ImmoFinancieres } from './handlers/note-4-immo-financieres';
import { handleN6Stocks } from './handlers/note-6-stocks';
import { handleN7Clients } from './handlers/note-7-clients';
import { handleN8AutresCreances } from './handlers/note-8-autres-creances';
import { handleN9TitresPlacement } from './handlers/note-9-titres-placement';
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
  [
    'N4' as NoteId,
    {
      metadata: meta('N4', 'Note 4 — Immobilisations financières', 'BILAN', true),
      handler: handleN4ImmoFinancieres,
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
  [
    'N8' as NoteId,
    {
      metadata: meta('N8', 'Note 8 — Autres créances', 'BILAN', true),
      handler: handleN8AutresCreances,
    },
  ],
  [
    'N9' as NoteId,
    {
      metadata: meta('N9', 'Note 9 — Titres de placement', 'BILAN', false),
      handler: handleN9TitresPlacement,
    },
  ],
  [
    'N10' as NoteId,
    {
      metadata: meta('N10', 'Note 10 — Valeurs à encaisser', 'BILAN', true),
      handler: handleN10ValeursEncaisser,
    },
  ],
  [
    'N11' as NoteId,
    {
      metadata: meta('N11', 'Note 11 — Disponibilités', 'BILAN', true),
      handler: handleN11Disponibilites,
    },
  ],
  [
    'N12' as NoteId,
    {
      metadata: meta('N12', 'Note 12 — Écarts de conversion-actif', 'BILAN', false),
      handler: handleN12ConversionActif,
    },
  ],
  [
    'N13' as NoteId,
    {
      metadata: meta('N13', 'Note 13 — Capital social et primes', 'BILAN', true),
      handler: handleN13Capital,
    },
  ],
  [
    'N14' as NoteId,
    {
      metadata: meta('N14', 'Note 14 — Réserves et report à nouveau', 'BILAN', true),
      handler: handleN14ReservesReport,
    },
  ],
  [
    'N15' as NoteId,
    {
      metadata: meta('N15', "Note 15 — Subventions d'investissement", 'BILAN', false),
      handler: handleN15Subventions,
    },
  ],
  [
    'N16' as NoteId,
    {
      metadata: meta('N16', 'Note 16 — Emprunts et dettes financières', 'BILAN', true),
      handler: handleN16Emprunts,
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
  [
    'N19' as NoteId,
    {
      metadata: meta('N19', "Note 19 — Autres dettes d'exploitation", 'BILAN', true),
      handler: handleN19AutresDettes,
    },
  ],
  [
    'N20' as NoteId,
    {
      metadata: meta('N20', 'Note 20 — Concours bancaires courants', 'BILAN', false),
      handler: handleN20ConcoursBancaires,
    },
  ],
  [
    'N21' as NoteId,
    {
      metadata: meta('N21', 'Note 21 — Écarts de conversion-passif', 'BILAN', false),
      handler: handleN21ConversionPassif,
    },
  ],

  // ───────────────────────────── Section COMPTE DE RÉSULTAT ────────────────────
  [
    'N22' as NoteId,
    {
      metadata: meta('N22', "Note 22 — Chiffre d'affaires et autres produits", 'CR', true),
      handler: handleN22CaProduits,
    },
  ],
  [
    'N23' as NoteId,
    {
      metadata: meta('N23', 'Note 23 — Achats consommés', 'CR', true),
      handler: handleN23Achats,
    },
  ],
  [
    'N24' as NoteId,
    {
      metadata: meta('N24', 'Note 24 — Services extérieurs et autres', 'CR', true),
      handler: handleN24ServicesExterieurs,
    },
  ],
  [
    'N25' as NoteId,
    {
      metadata: meta('N25', 'Note 25 — Charges de personnel', 'CR', true),
      handler: handleN25ChargesPersonnel,
    },
  ],
  [
    'N26' as NoteId,
    {
      metadata: meta('N26', 'Note 26 — Dotations amortissements et provisions', 'CR', true),
      handler: handleN26Dotations,
    },
  ],
  [
    'N27' as NoteId,
    {
      metadata: meta('N27', 'Note 27 — Charges et produits financiers', 'CR', true),
      handler: handleN27Financiers,
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
  [
    'N29' as NoteId,
    {
      metadata: meta('N29', 'Note 29 — Charges et produits HAO', 'CR', false),
      handler: handleN29Hao,
    },
  ],
  [
    'N30' as NoteId,
    {
      metadata: meta('N30', 'Note 30 — Impôt sur le résultat', 'CR', true),
      handler: handleN30Impot,
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
