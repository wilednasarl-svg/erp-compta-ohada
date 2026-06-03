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
  /**
   * Recommandation de correction, en langage métier, surfacée quand un
   * contrôle exécutable détecte une non-conformité. Optionnelle tant que
   * tous les contrôles du catalogue ne sont pas dotés d'un remède rédigé.
   */
  readonly remediation?: string;
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
    remediation:
      "Contrôler les comptes au solde inhabituel : un fournisseur (40) débiteur ou un client (41) créditeur traduit le plus souvent une avance mal imputée ou une erreur de compte. Reclasser sur le compte d'avance dédié (409 fournisseurs débiteurs, 419 clients créditeurs) ou corriger l'imputation de l'écriture fautive.",
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
    remediation:
      "Rouvrir chaque écriture déséquilibrée signalée et rétablir l'égalité débit = crédit (ligne manquante, montant ou sens erroné). Une écriture ne peut être validée tant que la partie double n'est pas respectée (AUDCIF art. 17).",
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
    remediation:
      "Un bilan déséquilibré révèle une écriture non équilibrée ou un report à nouveau erroné. Rapprocher le total des soldes débiteurs et créditeurs de la balance générale, corriger l'imputation fautive, puis vérifier l'affectation du résultat (compte 13) avant de regénérer le bilan.",
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

  // ── Contrats de location ──────────────────────────────────────────────────
  {
    id: 'leases-retraitement-acquisition',
    domain: 'leases',
    label: 'Location-acquisition portée à l’actif',
    description:
      'Un contrat de location-acquisition (transfert des risques et avantages) inscrit le bien à l’actif immobilisé et la dette correspondante au passif, avec amortissement du bien.',
    severity: 'warning',
    legalBasis: ['Guide SYSCOHADA Tome 2 — Contrats de location-acquisition'],
    tome: 2,
    evidenceQuery:
      'location acquisition contrat redevance immobilisation dette preneur amortissement',
  },
  {
    id: 'leases-redevances-location-simple',
    domain: 'leases',
    label: 'Redevances de location simple en charges',
    description:
      'Les redevances d’un contrat de location simple sont comptabilisées en charges de la période, sans inscription du bien à l’actif du preneur.',
    severity: 'info',
    legalBasis: ['Guide SYSCOHADA Tome 2 — Location simple'],
    tome: 2,
    evidenceQuery: 'location simple redevance charge loyer bailleur preneur exploitation',
  },

  // ── Provisions pour risques et charges ────────────────────────────────────
  {
    id: 'provisions-risques-charges-justifiee',
    domain: 'provisions',
    label: 'Provision pour risques et charges justifiée',
    description:
      'Une provision n’est constituée que face à une obligation actuelle, probable et évaluable de façon fiable (litige, garantie donnée, restructuration) à la clôture.',
    severity: 'warning',
    legalBasis: ['AUDCIF — provisions pour risques et charges', 'Guide SYSCOHADA Tome 2'],
    tome: 2,
    evidenceQuery: 'provision risques charges litige obligation dotation probable evaluation',
  },
  {
    id: 'provisions-reprise-sans-objet',
    domain: 'provisions',
    label: 'Reprise des provisions devenues sans objet',
    description:
      'Toute provision devenue sans objet ou excédentaire est reprise au résultat de l’exercice où la cause de la provision a disparu.',
    severity: 'warning',
    legalBasis: ['Guide SYSCOHADA Tome 2 — Reprises de provisions'],
    tome: 2,
    evidenceQuery: 'provision reprise sans objet devenue excedentaire resultat',
  },

  // ── Dépréciations et pertes de valeur ─────────────────────────────────────
  {
    id: 'impairments-perte-valeur-inventaire',
    domain: 'impairments',
    label: 'Perte de valeur si valeur actuelle < VNC',
    description:
      'À l’inventaire, lorsque la valeur actuelle d’un actif est inférieure à sa valeur nette comptable, une dépréciation ramène l’actif à sa valeur actuelle (prudence).',
    severity: 'warning',
    legalBasis: [
      'Guide SYSCOHADA Tome 2 — Ch.12 Dépréciations des immobilisations',
      'Guide SYSCOHADA Tome 1 — Dépréciations (stocks, créances)',
      'Principe de prudence',
    ],
    tome: 1,
    evidenceQuery: 'depreciation perte valeur actuelle nette comptable prudence inventaire',
  },
  {
    id: 'impairments-reprise-depreciation',
    domain: 'impairments',
    label: 'Reprise de dépréciation à la hausse de valeur',
    description:
      'Si la valeur actuelle d’un actif déprécié redevient supérieure à sa valeur nette comptable, la dépréciation est reprise dans la limite de la valeur d’origine amortie.',
    severity: 'info',
    legalBasis: ['Guide SYSCOHADA Tome 1 — Reprises de dépréciation'],
    tome: 1,
    evidenceQuery: 'reprise depreciation valeur actuelle augmentation limite origine',
  },

  // ── Subventions ───────────────────────────────────────────────────────────
  {
    id: 'subsidies-investissement-quote-part',
    domain: 'subsidies',
    label: 'Subvention d’investissement rapportée au résultat',
    description:
      'La subvention d’investissement est inscrite au passif (compte 14) puis rapportée au résultat (compte 865) au rythme de l’amortissement du bien financé.',
    severity: 'warning',
    legalBasis: ['Guide SYSCOHADA Tome 2 — Subventions d’investissement'],
    tome: 2,
    evidenceQuery: 'subvention investissement quote part resultat reprise amortissement bien',
  },
  {
    id: 'subsidies-exploitation-produit',
    domain: 'subsidies',
    label: 'Subvention d’exploitation ou d’équilibre en produit',
    description:
      'Les subventions d’exploitation (compte 71) et d’équilibre (compte 88) sont comptabilisées en produits de l’exercice qu’elles concernent.',
    severity: 'info',
    legalBasis: ['Guide SYSCOHADA Tome 2 — Subventions d’exploitation et d’équilibre'],
    tome: 2,
    evidenceQuery: 'subvention exploitation equilibre produit exercice etat',
  },

  // ── Engagements de retraite et avantages du personnel ─────────────────────
  {
    id: 'actuarial-engagement-retraite-provisionne',
    domain: 'actuarial-commitments',
    label: 'Engagement de retraite évalué et provisionné',
    description:
      'Les indemnités de fin de carrière et autres avantages du personnel constituent un engagement évalué (méthode actuarielle) et provisionné, ou mentionné en notes annexes.',
    severity: 'warning',
    legalBasis: ['Guide SYSCOHADA Tome 2 — Engagements de retraite et avantages du personnel'],
    tome: 2,
    evidenceQuery: 'engagement retraite indemnite depart personnel provision evaluation actuariel',
  },

  // ── Régularisations (cut-off) ─────────────────────────────────────────────
  {
    id: 'regularizations-rattachement-exercice',
    domain: 'regularizations',
    label: 'Rattachement des charges et produits à l’exercice',
    description:
      'Charges et produits sont rattachés à l’exercice qu’ils concernent via les comptes de régularisation (charges/produits constatés d’avance, charges à payer, produits à recevoir).',
    severity: 'warning',
    legalBasis: ['Principe de spécialisation des exercices', 'Guide SYSCOHADA Tome 1'],
    tome: 1,
    evidenceQuery:
      'regularisation charges produits constates avance rattachement exercice specialisation',
  },
  {
    id: 'regularizations-charges-a-payer',
    domain: 'regularizations',
    label: 'Charges à payer et produits à recevoir constatés',
    description:
      'Les charges engagées non encore facturées et les produits acquis non encore facturés sont constatés à la clôture pour donner une image fidèle du résultat.',
    severity: 'info',
    legalBasis: ['Guide SYSCOHADA Tome 1 — Charges à payer et produits à recevoir'],
    tome: 1,
    evidenceQuery: 'charges payer produits recevoir constates cloture facture exercice',
  },

  // ── Fusions, apports et transformations de sociétés ───────────────────────
  {
    id: 'business-combinations-evaluation-apports',
    domain: 'business-combinations',
    label: 'Évaluation des apports de fusion',
    description:
      'Les apports d’une fusion, scission ou apport partiel d’actif sont évalués (valeur réelle ou comptable selon le sens de l’opération) et la parité d’échange est justifiée.',
    severity: 'warning',
    legalBasis: ['Guide SYSCOHADA Tome 2 — Fusions et opérations assimilées'],
    tome: 2,
    evidenceQuery: 'fusion apport evaluation valeur echange absorption societe scission parite',
  },

  // ── Effets de commerce ────────────────────────────────────────────────────
  {
    id: 'bills-effets-comptabilisation',
    domain: 'bills-of-exchange',
    label: 'Effets à recevoir et à payer comptabilisés',
    description:
      'Les effets de commerce acceptés sont enregistrés en effets à recevoir (412) ou à payer (402) distincts des comptes de tiers ordinaires jusqu’à leur échéance.',
    severity: 'info',
    legalBasis: ['Guide SYSCOHADA Tome 1 — Effets de commerce'],
    tome: 1,
    evidenceQuery: 'effet commerce recevoir payer traite echeance acceptation tiers',
  },
  {
    id: 'bills-escompte-produits-financiers',
    domain: 'bills-of-exchange',
    label: 'Escompte d’effet et charges financières',
    description:
      'À l’escompte d’un effet auprès de la banque, les agios (intérêts et commissions) sont comptabilisés en charges financières et l’effet reste suivi jusqu’à son échéance.',
    severity: 'warning',
    legalBasis: ['Guide SYSCOHADA Tome 1 — Escompte des effets'],
    tome: 1,
    evidenceQuery: 'escompte effet banque agios interets commissions charges financieres echeance',
  },

  // ── Opérations en devises ─────────────────────────────────────────────────
  {
    id: 'multicurrency-conversion-cloture',
    domain: 'multi-currency',
    label: 'Conversion des créances/dettes en devises à la clôture',
    description:
      'Les créances et dettes en monnaie étrangère sont converties au cours de clôture ; la différence avec la valeur d’entrée génère un écart de conversion.',
    severity: 'warning',
    legalBasis: ['Guide SYSCOHADA Tome 2 — Opérations en devises'],
    tome: 2,
    evidenceQuery: 'devise conversion creance dette cloture cours ecart monnaie etrangere',
  },
  {
    id: 'multicurrency-ecart-conversion-provision',
    domain: 'multi-currency',
    label: 'Provision sur perte latente de change',
    description:
      'Les écarts de conversion-actif (pertes latentes) donnent lieu à une provision pour perte de change, conformément au principe de prudence.',
    severity: 'warning',
    legalBasis: ['Guide SYSCOHADA Tome 2 — Écarts de conversion', 'Principe de prudence'],
    tome: 2,
    evidenceQuery: 'ecart conversion actif passif perte latente provision change prudence',
  },

  // ── Garanties et engagements (hors bilan) ─────────────────────────────────
  {
    id: 'pledged-engagements-notes-annexes',
    domain: 'pledged-assets',
    label: 'Engagements donnés/reçus en notes annexes',
    description:
      'Les garanties, gages, hypothèques, cautions et avals (engagements donnés ou reçus) sont recensés et présentés dans les notes annexes (engagements hors bilan).',
    severity: 'info',
    legalBasis: [
      'Guide SYSCOHADA Tome 3 — Notes annexes (engagements hors bilan donnés et reçus)',
      'Guide SYSCOHADA Tome 2 — Garanties et sûretés',
    ],
    tome: 2,
    evidenceQuery: 'garantie gage hypotheque caution aval engagement donne recu notes annexes',
  },

  // ── Tableau des flux de trésorerie ────────────────────────────────────────
  {
    id: 'cashflow-trois-categories',
    domain: 'cash-flow',
    label: 'TFT structuré en trois catégories de flux',
    description:
      'Le Tableau des flux de trésorerie ventile les flux en activités opérationnelles, d’investissement et de financement pour expliquer la variation de trésorerie.',
    severity: 'warning',
    legalBasis: ['Guide SYSCOHADA Tome 3 — Tableau des flux de trésorerie'],
    tome: 3,
    evidenceQuery: 'tableau flux tresorerie operationnel investissement financement variation',
  },
  {
    id: 'cashflow-variation-coherente',
    domain: 'cash-flow',
    label: 'Variation de trésorerie réconciliée au bilan',
    description:
      'La variation nette de trésorerie du TFT (entre ouverture et clôture) est égale à la variation des comptes de trésorerie active et passive du bilan.',
    severity: 'blocking',
    legalBasis: ['Guide SYSCOHADA Tome 3 — Cohérence du TFT'],
    tome: 3,
    evidenceQuery: 'variation tresorerie nette ouverture cloture flux bilan reconciliation',
    remediation:
      "L'écart entre la trésorerie de clôture du TFT (poste ZH) et le solde des comptes de classe 5 révèle un flux mal classé ou un compte de trésorerie oublié. Vérifier les exclusions BFR (485, 414…) et l'exhaustivité des comptes 52-58 retenus dans le périmètre de trésorerie.",
  },

  // ── Rapprochement bancaire ────────────────────────────────────────────────
  {
    id: 'bankrec-etat-rapprochement',
    domain: 'bank-reconciliation',
    label: 'État de rapprochement bancaire périodique',
    description:
      'Le solde du compte banque (521) est rapproché périodiquement du relevé bancaire via un état de rapprochement justifiant chaque écart (chèques en circulation, virements en attente).',
    severity: 'warning',
    legalBasis: ['Guide SYSCOHADA Tome 1 — Comptes de trésorerie et rapprochement'],
    tome: 1,
    evidenceQuery: 'rapprochement banque releve solde compte tresorerie ecart cheque',
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
