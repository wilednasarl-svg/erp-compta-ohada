/**
 * Module 9 — Notes annexes SYSCOHADA Tome 3 (pages 35-70).
 *
 * Registre canonique des notes annexes telles que définies par la doctrine
 * officielle SYSCOHADA Révisé (AUDCIF) Tome 3 « Présentation des états
 * financiers annuels ». La liste, l'ordre et les intitulés sont issus de
 * la fiche d'applicabilité R4 (Tome 3 p. 31) et confirmés par chaque
 * en-tête « NOTE n : … » des pages 35-70.
 *
 * Périmètre doctrine :
 *
 *   N1   Dettes garanties par des sûretés réelles
 *   N2   Informations obligatoires (déclaration conformité + méthodes)
 *   N3A  Immobilisation brute
 *   N3B  Biens pris en location-acquisition
 *   N3C  Immobilisations : amortissements
 *   N3D  Immobilisations : plus-values et moins-values de cession
 *   N3E  Informations sur les réévaluations effectuées par l'entité
 *   N3F  Tableau d'étalement des charges immobilisées
 *   N4   Immobilisations financières
 *   N5   Actif circulant et dettes circulantes HAO
 *   N6   Stocks et en-cours
 *   N7   Clients
 *   N8   Autres créances
 *   N9   Titres de placement
 *   N10  Valeurs à encaisser
 *   N11  Disponibilités
 *   N12  Écarts de conversion et transferts de charges
 *   N13  Capital : valeur nominale des actions ou parts
 *   N14  Primes et réserves
 *   N15A Subventions et provisions réglementées
 *   N15B Autres fonds propres
 *   N16A Dettes financières et ressources assimilées
 *   N16B Engagements de retraite et avantages assimilés (méthode actuarielle)
 *   N16Bbis Actifs et passifs éventuels
 *   N16C Banques, crédit d'escompte et de trésorerie
 *   N17  Fournisseurs d'exploitation
 *   N18  Dettes fiscales et sociales
 *   N19  Autres dettes et provisions pour risques à court terme
 *   N20  (note réservée — non utilisée dans la grille R4 de référence)
 *   N21  Chiffre d'affaires et autres produits
 *   N22  Achats
 *   N23  Transports
 *   N24  Services extérieurs
 *   N25  Impôts et taxes
 *   N26  Autres charges
 *   N27A Charges de personnel
 *   N27B Effectifs, masse salariale et personnel extérieur
 *   N28  Provisions et dépréciations inscrites au bilan
 *   N29  Charges et revenus financiers
 *   N30  Autres charges et produits HAO
 *   N31  Répartition du résultat et autres éléments caractéristiques
 *   N32  Production de l'exercice
 *   N33  Achats destinés à la production
 *   N34  Fiche de synthèse des principaux indicateurs financiers
 *   N35  Liste des informations sociales, environnementales et sociétales
 *   N36  Tables des codes
 *
 * ─────────────────────────────────────────────────────────────────────
 * TABLEAU DE REMAPPING (ancien id → nouvel id doctrine) — migration 0107
 * ─────────────────────────────────────────────────────────────────────
 *   Ancien id (label legacy)                  → Nouveau id doctrine
 *   N1  (Référentiel comptable, méthodes)     → N2   (informations obligatoires)
 *   N2  (Déclaration de conformité)           → N2   (déjà conforme)
 *   N3A (Immobilisations corporelles)         → N3A  (immobilisation brute) — handler OK
 *   N3B (Immobilisations incorporelles)       → N3A  (incorpo. incluses dans la brute)
 *                                                 ↳ N3B doctrine = location-acquisition
 *   N3C (Plus-values / moins-values cession)  → N3D  (cessions)
 *   N3D (Amortissements)                      → N3C  (amortissements)
 *   N4..N11                                   → inchangé (handler & doctrine alignés)
 *   N12 (Écarts conversion-actif)             → N12  (actif + passif + transferts)
 *   N13 (Capital social et primes)            → N13  (capital)
 *   N14 (Réserves et report)                  → N14  (primes et réserves)
 *   N15 (Subventions d'investissement)        → N15A (subventions et provisions règl.)
 *   N16 (Emprunts et dettes financières)      → N16A (dettes financières)
 *   N17, N18                                  → inchangé
 *   N19 (Autres dettes d'exploitation)        → N19  (autres dettes + provisions CT)
 *   N20 (Concours bancaires courants)         → N16C (banques crédit d'escompte trés.)
 *   N21 (Écarts conversion-passif)            → _legacy (couvert par N12 doctrine)
 *   N22 (Chiffre d'affaires)                  → N21  (CA et autres produits)
 *   N23 (Achats)                              → N22  (achats)
 *   N24 (Services extérieurs)                 → N24  (services extérieurs)
 *   N25 (Charges de personnel)                → N27A (charges de personnel)
 *   N26 (Dotations amortissements)            → _legacy (réparti N3C + N28)
 *   N27 (Charges et produits financiers)      → N29  (charges et revenus financiers)
 *   N28 (Provisions risques et charges)       → N28  (provisions et dépréciations)
 *   N29 (Charges et produits HAO)             → N30  (autres charges et produits HAO)
 *   N30 (Impôt sur le résultat)               → N31  (répartition du résultat — inclut impôt)
 *   N31 (TFT détail)                          → N31  (TODO A2 : remplacer par doctrine
 *                                                   « répartition du résultat » ;
 *                                                   le handler TFT reste branché temporairement)
 *   N32 (Effectif et dirigeants)              → N27B (effectifs et masse salariale)
 *   N33 (Engagements hors bilan)              → N16Bbis (actifs et passifs éventuels)
 *   N34 (Parties liées)                       → _legacy (à créer en suivi)
 *   N35 (Événements postérieurs à la clôture) → _legacy (à créer en suivi)
 *   N36 (Informations sectorielles)           → _legacy (à créer en suivi)
 *
 * Les notes doctrine qui n'ont pas encore de handler calculé (N1, N3B,
 * N3E, N3F, N15B, N16B, N16Bbis, N23, N25, N26, N27B, N32..N36) sont
 * branchées sur `freeCommentNote` : la note apparaît dans la liasse,
 * applicable par défaut, et le comptable la complète via le commentaire
 * libre. À implémenter au fil de l'eau.
 *
 * Migration `0107_remap_note_annexe_comments.ts` : remappe les `note_id`
 * stockés en base selon ce tableau. Les ids sans correspondance directe
 * sont préfixés `_legacy_` pour préservation des saisies historiques.
 *
 * ─────────────────────────────────────────────────────────────────────
 * Wiring service / dépendances :
 *   Le handler N31 (TFT) consomme la dépendance `cashFlow`. Tant que
 *   A2 n'a pas livré la refonte « répartition du résultat », le label
 *   doctrine est appliqué mais le calcul reste celui du TFT ventilé.
 *   À traiter en follow-up (cf. TODO N31 ci-dessus).
 */

import { freeCommentNote } from './handlers/_free-comment-note';
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
import { handleN22CaProduits } from './handlers/note-22-ca-produits';
import { handleN23Achats } from './handlers/note-23-achats';
import { handleN24ServicesExterieurs } from './handlers/note-24-services-exterieurs';
import { handleN25ChargesPersonnel } from './handlers/note-25-charges-personnel';
import { handleN27Financiers } from './handlers/note-27-financiers';
import { handleN28Provisions } from './handlers/note-28-provisions';
import { handleN29Hao } from './handlers/note-29-hao';
// Note: handleN30Impot reste disponible côté handlers/ pour le follow-up
// A2 (refonte N31 « répartition du résultat ») mais n'est pas branché
// dans ce registry — l'impôt est aujourd'hui couvert via le freeComment
// de N31 et restera ainsi jusqu'à la refonte du handler.
import { handleN31FluxTresorerie } from './handlers/note-31-flux-tresorerie';
import { handleN34FicheSynthese } from './handlers/note-34-fiche-synthese';
import { handleN3aImmoCorp } from './handlers/note-3a-immo-corp';
import { handleN3cCessions } from './handlers/note-3c-cessions';
import { handleN3dAmort } from './handlers/note-3d-amort';
import { handleN3eReevaluations } from './handlers/note-3e-reevaluations';
import { handleN3fChargesImmobilisees } from './handlers/note-3f-charges-immobilisees';
import { handleN15bAutresFondsPropres } from './handlers/note-15b-autres-fonds-propres';
import { handleN16bEngagementsRetraite } from './handlers/note-16b-engagements-retraite';
import { handleN16bbisSuretesDonnees } from './handlers/note-16bbis-suretes-donnees';
import { handleN27bEffectifs } from './handlers/note-27b-effectifs';
import { handleN4ImmoFinancieres } from './handlers/note-4-immo-financieres';
import { handleN5ActifHao } from './handlers/note-5-actif-hao';
import { handleN6Stocks } from './handlers/note-6-stocks';
import { handleN7Clients } from './handlers/note-7-clients';
import { handleN8AutresCreances } from './handlers/note-8-autres-creances';
import { handleN9TitresPlacement } from './handlers/note-9-titres-placement';
import { type NoteHandler, type NoteId, type NoteMetadata } from './types';

interface NoteRegistryEntry {
  readonly metadata: NoteMetadata;
  readonly handler: NoteHandler;
}

/**
 * Mapping ordonné NoteId → { metadata, handler }. L'ordre d'itération
 * suit la numérotation de la liasse SYSCOHADA Tome 3 :
 *   N1, N2, N3A, N3B, N3C, N3D, N3E, N3F, N4..N14, N15A, N15B,
 *   N16A, N16B, N16Bbis, N16C, N17..N19, N21..N26, N27A, N27B,
 *   N28..N36.
 *
 * NOTE : N20 n'est pas réservé dans la grille R4 du Tome 3 ; on l'omet
 * volontairement pour respecter l'ordonnancement officiel.
 */
export const NOTE_REGISTRY: ReadonlyMap<NoteId, NoteRegistryEntry> = new Map<
  NoteId,
  NoteRegistryEntry
>([
  // ───────────────────────── Section IDENTIFICATION ───────────────────────────
  [
    'N1' as NoteId,
    {
      metadata: meta(
        'N1',
        'Note 1 — Dettes garanties par des sûretés réelles',
        'IDENTIFICATION',
        false,
      ),
      handler: freeCommentNote,
    },
  ],
  [
    'N2' as NoteId,
    {
      metadata: meta(
        'N2',
        'Note 2 — Informations obligatoires (conformité SYSCOHADA et méthodes)',
        'IDENTIFICATION',
        true,
      ),
      handler: handleN2Conformite,
    },
  ],

  // ─────────────────────────────── Section BILAN ──────────────────────────────
  [
    'N3A' as NoteId,
    {
      metadata: meta('N3A', 'Note 3A — Immobilisation brute', 'BILAN', true),
      handler: handleN3aImmoCorp,
    },
  ],
  [
    'N3B' as NoteId,
    {
      metadata: meta('N3B', 'Note 3B — Biens pris en location-acquisition', 'BILAN', false),
      handler: freeCommentNote,
    },
  ],
  [
    'N3C' as NoteId,
    {
      metadata: meta('N3C', 'Note 3C — Immobilisations : amortissements', 'BILAN', true),
      handler: handleN3dAmort,
    },
  ],
  [
    'N3D' as NoteId,
    {
      metadata: meta(
        'N3D',
        'Note 3D — Immobilisations : plus-values et moins-values de cession',
        'BILAN',
        true,
      ),
      handler: handleN3cCessions,
    },
  ],
  [
    'N3E' as NoteId,
    {
      metadata: meta(
        'N3E',
        "Note 3E — Informations sur les réévaluations effectuées par l'entité",
        'BILAN',
        false,
      ),
      handler: handleN3eReevaluations,
    },
  ],
  [
    'N3F' as NoteId,
    {
      metadata: meta(
        'N3F',
        "Note 3F — Tableau d'étalement des charges immobilisées",
        'BILAN',
        false,
      ),
      handler: handleN3fChargesImmobilisees,
    },
  ],
  [
    'N4' as NoteId,
    {
      metadata: meta('N4', 'Note 4 — Immobilisations financières', 'BILAN', true),
      handler: handleN4ImmoFinancieres,
    },
  ],
  [
    'N5' as NoteId,
    {
      metadata: meta(
        'N5',
        'Note 5 — Actif circulant et dettes circulantes HAO',
        'BILAN',
        false,
      ),
      handler: handleN5ActifHao,
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
      metadata: meta('N7', 'Note 7 — Clients', 'BILAN', true),
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
      metadata: meta(
        'N12',
        'Note 12 — Écarts de conversion et transferts de charges',
        'BILAN',
        false,
      ),
      handler: handleN12ConversionActif,
    },
  ],
  [
    'N13' as NoteId,
    {
      metadata: meta(
        'N13',
        'Note 13 — Capital : valeur nominale des actions ou parts',
        'BILAN',
        true,
      ),
      handler: handleN13Capital,
    },
  ],
  [
    'N14' as NoteId,
    {
      metadata: meta('N14', 'Note 14 — Primes et réserves', 'BILAN', true),
      handler: handleN14ReservesReport,
    },
  ],
  [
    'N15A' as NoteId,
    {
      metadata: meta(
        'N15A',
        'Note 15A — Subventions et provisions réglementées',
        'BILAN',
        false,
      ),
      handler: handleN15Subventions,
    },
  ],
  [
    'N15B' as NoteId,
    {
      metadata: meta('N15B', 'Note 15B — Autres fonds propres', 'BILAN', false),
      handler: handleN15bAutresFondsPropres,
    },
  ],
  [
    'N16A' as NoteId,
    {
      metadata: meta(
        'N16A',
        'Note 16A — Dettes financières et ressources assimilées',
        'BILAN',
        true,
      ),
      handler: handleN16Emprunts,
    },
  ],
  [
    'N16B' as NoteId,
    {
      metadata: meta(
        'N16B',
        'Note 16B — Engagements de retraite et avantages assimilés (méthode actuarielle)',
        'BILAN',
        false,
      ),
      handler: handleN16bEngagementsRetraite,
    },
  ],
  [
    'N16Bbis' as NoteId,
    {
      metadata: meta('N16Bbis', 'Note 16B bis — Actifs et passifs éventuels', 'BILAN', false),
      handler: handleN16bbisSuretesDonnees,
    },
  ],
  [
    'N16C' as NoteId,
    {
      metadata: meta(
        'N16C',
        "Note 16C — Banques, crédit d'escompte et de trésorerie",
        'BILAN',
        false,
      ),
      handler: handleN20ConcoursBancaires,
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
      metadata: meta(
        'N19',
        'Note 19 — Autres dettes et provisions pour risques à court terme',
        'BILAN',
        true,
      ),
      handler: handleN19AutresDettes,
    },
  ],

  // ───────────────────────── Section COMPTE DE RÉSULTAT ───────────────────────
  [
    'N21' as NoteId,
    {
      metadata: meta('N21', "Note 21 — Chiffre d'affaires et autres produits", 'CR', true),
      handler: handleN22CaProduits,
    },
  ],
  [
    'N22' as NoteId,
    {
      metadata: meta('N22', 'Note 22 — Achats', 'CR', true),
      handler: handleN23Achats,
    },
  ],
  [
    'N23' as NoteId,
    {
      metadata: meta('N23', 'Note 23 — Transports', 'CR', false),
      handler: freeCommentNote,
    },
  ],
  [
    'N24' as NoteId,
    {
      metadata: meta('N24', 'Note 24 — Services extérieurs', 'CR', true),
      handler: handleN24ServicesExterieurs,
    },
  ],
  [
    'N25' as NoteId,
    {
      metadata: meta('N25', 'Note 25 — Impôts et taxes', 'CR', false),
      handler: freeCommentNote,
    },
  ],
  [
    'N26' as NoteId,
    {
      metadata: meta('N26', 'Note 26 — Autres charges', 'CR', false),
      handler: freeCommentNote,
    },
  ],
  [
    'N27A' as NoteId,
    {
      metadata: meta('N27A', 'Note 27A — Charges de personnel', 'CR', true),
      handler: handleN25ChargesPersonnel,
    },
  ],
  [
    'N27B' as NoteId,
    {
      metadata: meta(
        'N27B',
        'Note 27B — Effectifs, masse salariale et personnel extérieur',
        'CR',
        true,
      ),
      handler: handleN27bEffectifs,
    },
  ],
  [
    'N28' as NoteId,
    {
      metadata: meta(
        'N28',
        'Note 28 — Provisions et dépréciations inscrites au bilan',
        'BILAN',
        true,
      ),
      handler: handleN28Provisions,
    },
  ],
  [
    'N29' as NoteId,
    {
      metadata: meta('N29', 'Note 29 — Charges et revenus financiers', 'CR', true),
      handler: handleN27Financiers,
    },
  ],
  [
    'N30' as NoteId,
    {
      metadata: meta('N30', 'Note 30 — Autres charges et produits HAO', 'CR', false),
      handler: handleN29Hao,
    },
  ],

  // ───────────────────────────── Section GÉNÉRAL / TFT ────────────────────────
  /**
   * N31 — Doctrine : « Répartition du résultat et autres éléments
   * caractéristiques ». Le handler actuel calcule le détail du TFT
   * (legacy W2.4.c, branché sur `CashFlowService`).
   *
   * TODO (A2) : refondre `handleN31FluxTresorerie` pour produire la
   * ventilation doctrine — ou bien créer une note hors-grille pour le
   * TFT détaillé et brancher `handleN30Impot` (legacy N30 = impôt) sur
   * N31. Pour l'instant on garde le handler TFT pour ne pas bloquer
   * `CashFlowService` ; l'incohérence est documentée dans le mapping.
   */
  [
    'N31' as NoteId,
    {
      metadata: meta(
        'N31',
        'Note 31 — Répartition du résultat et autres éléments caractéristiques',
        'TFT',
        true,
      ),
      handler: handleN31FluxTresorerie,
    },
  ],
  [
    'N32' as NoteId,
    {
      metadata: meta('N32', "Note 32 — Production de l'exercice", 'GENERAL', false),
      handler: freeCommentNote,
    },
  ],
  [
    'N33' as NoteId,
    {
      metadata: meta('N33', 'Note 33 — Achats destinés à la production', 'GENERAL', false),
      handler: freeCommentNote,
    },
  ],
  [
    'N34' as NoteId,
    {
      metadata: meta(
        'N34',
        'Note 34 — Fiche de synthèse des principaux indicateurs financiers',
        'GENERAL',
        true,
      ),
      handler: handleN34FicheSynthese,
    },
  ],
  [
    'N35' as NoteId,
    {
      metadata: meta(
        'N35',
        'Note 35 — Liste des informations sociales, environnementales et sociétales',
        'GENERAL',
        false,
      ),
      handler: freeCommentNote,
    },
  ],
  [
    'N36' as NoteId,
    {
      metadata: meta('N36', 'Note 36 — Tables des codes', 'GENERAL', true),
      handler: freeCommentNote,
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
