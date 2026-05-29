import type { SyscohadaDomain } from '../services/syscohada-knowledge.service';

/**
 * Sévérité d'un contrôle métier au regard du référentiel SYSCOHADA.
 * - `blocking` : non-conformité qui empêche la validation/clôture (équilibre, pièce justificative).
 * - `warning`  : écart à corriger avant dépôt mais non bloquant techniquement.
 * - `info`     : bonne pratique ou rappel doctrinal.
 */
export type SyscohadaControlSeverity = 'blocking' | 'warning' | 'info';

export interface SyscohadaControl {
  /** Identifiant stable, utilisé comme clé d'affichage et de wiring module. */
  readonly id: string;
  readonly domain: SyscohadaDomain;
  /** Intitulé court du contrôle. */
  readonly label: string;
  /** Ce que le contrôle vérifie concrètement, en langage métier. */
  readonly description: string;
  readonly severity: SyscohadaControlSeverity;
  /**
   * Rattachement doctrinal explicite. On ne cite l'Acte uniforme (AUDCIF) que
   * pour les articles dont la formulation est stable et certaine ; le reste
   * renvoie au Guide d'application (Tome + chapitre), corroboré à l'exécution
   * par l'extrait verbatim retourné via `evidenceQuery`.
   */
  readonly legalBasis: ReadonlyArray<string>;
  /** Tome du Guide d'application qui porte le contrôle (0 = transversal). */
  readonly tome: number;
  /** Requête de recherche servant à rapatrier l'extrait sourcé du Guide. */
  readonly evidenceQuery: string;
}

export const SYSCOHADA_CONTROL_CATALOG: ReadonlyArray<SyscohadaControl> = [
  // ── Plan comptable ────────────────────────────────────────────────────────
  {
    id: 'plan-numerotation-classes',
    domain: 'accounting-plan',
    label: 'Numérotation conforme au plan SYSCOHADA',
    description:
      'Chaque compte mouvementé appartient à une classe 1 à 8 du plan comptable général SYSCOHADA et respecte la codification décimale officielle.',
    severity: 'blocking',
    legalBasis: ['Guide SYSCOHADA Tome 1 — Plan comptable général'],
    tome: 1,
    evidenceQuery: 'plan comptable classes comptes subdivision codification',
  },
  {
    id: 'plan-sens-normal-comptes',
    domain: 'accounting-plan',
    label: 'Sens normal des comptes respecté',
    description:
      'Les comptes d’actif/charges ont un solde débiteur, les comptes de passif/produits un solde créditeur, hors comptes opposants (29x/39x/49x/59x).',
    severity: 'warning',
    legalBasis: ['Guide SYSCOHADA Tome 1 — Fonctionnement des comptes'],
    tome: 1,
    evidenceQuery: 'compte solde debiteur crediteur fonctionnement classe',
  },

  // ── Journaux et écritures ────────────────────────────────────────────────
  {
    id: 'journal-equilibre-partie-double',
    domain: 'journals',
    label: 'Équilibre de l’écriture (partie double)',
    description:
      'La somme des débits égale la somme des crédits pour chaque écriture comptable. Une écriture déséquilibrée ne peut être validée.',
    severity: 'blocking',
    legalBasis: ['AUDCIF art. 17 — comptabilité en partie double', 'Guide SYSCOHADA Tome 1'],
    tome: 1,
    evidenceQuery: 'partie double debit credit equilibre ecriture enregistrement',
  },
  {
    id: 'journal-piece-justificative',
    domain: 'journals',
    label: 'Pièce justificative obligatoire',
    description:
      'Toute écriture s’appuie sur une pièce justificative datée et conservée, permettant la reconstitution de l’opération.',
    severity: 'blocking',
    legalBasis: ['AUDCIF art. 17 à 19 — organisation comptable', 'Guide SYSCOHADA Tome 1'],
    tome: 1,
    evidenceQuery: 'piece justificative ecriture date conservation organisation comptable',
  },
  {
    id: 'journal-chronologie-continuite',
    domain: 'journals',
    label: 'Enregistrement chronologique et continu',
    description:
      'Les opérations sont enregistrées par ordre de date, opération par opération, sans blanc ni altération, avec une numérotation continue.',
    severity: 'warning',
    legalBasis: ['AUDCIF art. 17 — enregistrement chronologique', 'Guide SYSCOHADA Tome 1'],
    tome: 1,
    evidenceQuery: 'enregistrement chronologique ordre date operation livre journal',
  },
  {
    id: 'journal-lettrage-tiers',
    domain: 'journals',
    label: 'Lettrage des comptes de tiers',
    description:
      'Les comptes de tiers (401, 411, 43 organismes sociaux, 44 État) sont lettrés pour rapprocher chaque dette/créance à son règlement.',
    severity: 'info',
    legalBasis: ['Guide SYSCOHADA Tome 1 — Comptes de tiers et lettrage'],
    tome: 1,
    evidenceQuery: 'lettrage comptes tiers fournisseur client rapprochement reglement',
  },

  // ── Immobilisations ───────────────────────────────────────────────────────
  {
    id: 'assets-plan-amortissement',
    domain: 'assets',
    label: 'Plan d’amortissement dès la mise en service',
    description:
      'Chaque immobilisation amortissable dispose d’un plan d’amortissement fondé sur sa durée d’utilité et sa base amortissable, appliqué dès la mise en service.',
    severity: 'warning',
    legalBasis: ['Guide SYSCOHADA Tome 1 — Amortissements'],
    tome: 1,
    evidenceQuery: 'amortissement plan duree utilite base amortissable mise en service',
  },
  {
    id: 'assets-depreciation-inventaire',
    domain: 'assets',
    label: 'Dépréciation constatée à l’inventaire',
    description:
      'À la clôture, si la valeur actuelle d’une immobilisation est durablement inférieure à sa valeur nette comptable, une dépréciation est constatée (principe de prudence).',
    severity: 'warning',
    legalBasis: ['Guide SYSCOHADA Tome 1 — Dépréciations', 'Principe de prudence'],
    tome: 1,
    evidenceQuery:
      'depreciation immobilisation valeur actuelle nette comptable prudence inventaire',
  },
  {
    id: 'assets-cession-resultat',
    domain: 'assets',
    label: 'Sortie et résultat de cession',
    description:
      'La cession d’une immobilisation solde sa valeur nette comptable et constate le résultat de cession (comptes 81/82) avec amortissement complémentaire au prorata.',
    severity: 'warning',
    legalBasis: ['Guide SYSCOHADA Tome 1 — Cessions d’immobilisations'],
    tome: 1,
    evidenceQuery: 'cession immobilisation valeur nette comptable resultat prorata sortie',
  },

  // ── Inventaire et stocks ──────────────────────────────────────────────────
  {
    id: 'inventory-physique-annuel',
    domain: 'inventory',
    label: 'Inventaire physique au moins annuel',
    description:
      'Un inventaire physique des stocks est réalisé au moins une fois par exercice pour contrôler les existants et leur valeur.',
    severity: 'warning',
    legalBasis: [
      'AUDCIF art. 17 — inventaire au moins une fois par exercice',
      'Guide SYSCOHADA Tome 1',
    ],
    tome: 1,
    evidenceQuery: 'inventaire physique stock existants exercice controle quantite',
  },
  {
    id: 'inventory-cout-evaluation',
    domain: 'inventory',
    label: 'Évaluation au coût d’acquisition/production',
    description:
      'Les stocks sont évalués au coût d’acquisition (achats) ou au coût de production, méthode de coût retenue appliquée de façon permanente.',
    severity: 'warning',
    legalBasis: ['Guide SYSCOHADA Tome 1 — Évaluation des stocks'],
    tome: 1,
    evidenceQuery: 'stock cout acquisition production evaluation methode permanence',
  },
  {
    id: 'inventory-depreciation-stock',
    domain: 'inventory',
    label: 'Dépréciation des stocks si valeur < coût',
    description:
      'Lorsque la valeur de réalisation nette d’un stock est inférieure à son coût, une dépréciation ramène le stock à sa valeur d’inventaire.',
    severity: 'warning',
    legalBasis: ['Guide SYSCOHADA Tome 1 — Dépréciation des stocks', 'Principe de prudence'],
    tome: 1,
    evidenceQuery: 'depreciation stock valeur realisation nette inferieure cout inventaire',
  },

  // ── TVA et fiscalité ──────────────────────────────────────────────────────
  {
    id: 'tva-coherence-comptes',
    domain: 'tva',
    label: 'Cohérence TVA collectée / déductible',
    description:
      'Les montants de TVA collectée (443) et déductible (445) sont cohérents avec les bases déclarées et soldés dans le compte de TVA due (4441).',
    severity: 'warning',
    legalBasis: ['Guide SYSCOHADA Tome 2 — Opérations fiscales (TVA)'],
    tome: 2,
    evidenceQuery: 'tva collectee deductible 443 445 declaration due regularisation',
  },
  {
    id: 'tva-centralisation-declaration',
    domain: 'tva',
    label: 'Centralisation TVA post-déclaration',
    description:
      'À la déclaration, la TVA collectée et la TVA déductible sont centralisées pour dégager la TVA à décaisser ou le crédit de TVA.',
    severity: 'info',
    legalBasis: ['Guide SYSCOHADA Tome 2 — Liquidation et centralisation de la TVA'],
    tome: 2,
    evidenceQuery: 'tva centralisation decaisser credit liquidation declaration',
  },

  // ── États financiers ──────────────────────────────────────────────────────
  {
    id: 'bilan-actif-egal-passif',
    domain: 'reports',
    label: 'Bilan équilibré (Actif = Passif)',
    description:
      'Le total de l’actif est strictement égal au total du passif après affectation du résultat de l’exercice.',
    severity: 'blocking',
    legalBasis: ['AUDCIF art. 8 — états financiers annuels', 'Guide SYSCOHADA Tome 3'],
    tome: 3,
    evidenceQuery: 'bilan total actif passif equilibre resultat affectation',
  },
  {
    id: 'etats-tout-indissociable',
    domain: 'reports',
    label: 'Les quatre états forment un tout indissociable',
    description:
      'Les états financiers du système normal comprennent le Bilan, le Compte de résultat, le Tableau des flux de trésorerie et les Notes annexes, indissociables.',
    severity: 'blocking',
    legalBasis: ['AUDCIF art. 8 — composition des états financiers'],
    tome: 3,
    evidenceQuery:
      'etats financiers bilan compte resultat flux tresorerie notes annexes systeme normal',
  },
  {
    id: 'resultat-cascade-sig',
    domain: 'reports',
    label: 'Cascade des soldes intermédiaires de gestion',
    description:
      'Le compte de résultat décline la cascade SIG (marge commerciale, valeur ajoutée, EBE, résultat d’exploitation, financier, HAO) jusqu’au résultat net.',
    severity: 'warning',
    legalBasis: ['Guide SYSCOHADA Tome 3 — Compte de résultat et SIG'],
    tome: 3,
    evidenceQuery:
      'soldes intermediaires gestion marge valeur ajoutee excedent brut exploitation resultat',
  },

  // ── Assistance métier (IA) ────────────────────────────────────────────────
  {
    id: 'ai-reponse-sourcee',
    domain: 'ai',
    label: 'Réponse obligatoirement sourcée',
    description:
      'Toute réponse de l’assistant sur une règle SYSCOHADA cite le Guide d’application (tome, titre, lignes) afin d’être vérifiable.',
    severity: 'info',
    legalBasis: ['Guide SYSCOHADA — traçabilité des réponses doctrinales'],
    tome: 0,
    evidenceQuery: 'syscohada guide doctrine reference referentiel ohada',
  },
];

export function getControlsForDomain(domain: SyscohadaDomain): ReadonlyArray<SyscohadaControl> {
  return SYSCOHADA_CONTROL_CATALOG.filter((control) => control.domain === domain);
}
