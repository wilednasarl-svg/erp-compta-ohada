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
   * contrôle exécutable détecte une non-conformité. Renseignée pour tous les
   * contrôles du catalogue.
   */
  readonly remediation: string;
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
    remediation:
      "Reclasser tout compte dont le code ne respecte pas la codification décimale SYSCOHADA (1ʳᵉ position = classe du plan, code numérique). Un code hors plan provient le plus souvent d'un import : le rattacher au compte normalisé correspondant.",
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
    remediation:
      "Rattacher une pièce justificative (facture, reçu, contrat, relevé) à chaque écriture validée qui en est dépourvue, et la conserver. Sans justificatif, l'opération n'est ni reconstituable ni opposable (AUDCIF art. 17 à 19).",
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
    remediation:
      "Rapprocher chaque écriture dont la date d'opération sort des bornes de sa période comptable : corriger la date ou rattacher l'écriture à la bonne période. L'enregistrement doit rester chronologique et la date cohérente avec la période (AUDCIF art. 17).",
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
    remediation:
      'Lettrer les comptes de tiers : rapprocher chaque facture de son règlement par un code de lettrage. Analyser les lignes anciennes non lettrées (avoir non imputé, règlement non rapproché, créance ou dette à solder, à recouvrer ou à provisionner).',
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
    remediation:
      "Doter chaque immobilisation amortissable d'un plan d'amortissement dès sa mise en service (base amortissable répartie sur la durée d'utilité). Régulariser par une dotation complémentaire toute immobilisation entrée mais non encore amortie.",
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
    remediation:
      'Comparer à la clôture la valeur actuelle de chaque immobilisation à sa valeur nette comptable ; si elle est durablement inférieure, constater une dépréciation (compte 29) au titre du principe de prudence.',
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
    remediation:
      "Comptabiliser la cession en soldant la valeur nette comptable (dotation complémentaire au prorata temporis) via le compte 81, et le produit de cession via le compte 82. Sortir l'immobilisation et ses amortissements de l'actif.",
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
    remediation:
      "Réaliser un inventaire physique des stocks au moins une fois par exercice et ajuster les comptes de stock (classe 3) sur les existants constatés. Documenter et justifier l'écart entre l'inventaire et la comptabilité (AUDCIF art. 17).",
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
    remediation:
      "Évaluer les stocks au coût d'acquisition (achats) ou de production, en appliquant de façon permanente la méthode retenue (CMP ou FIFO). Corriger toute valorisation au prix de vente ou à un coût non justifié.",
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
    remediation:
      "Lorsque la valeur de réalisation nette d'un stock est inférieure à son coût, constater une dépréciation (compte 39) ramenant le stock à sa valeur d'inventaire, conformément au principe de prudence.",
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
    remediation:
      "Reprendre l'imputation des comptes de TVA au sens anormal : la TVA facturée (443) est créditrice, la TVA récupérable (445) débitrice. Corriger l'écriture fautive, puis vérifier la liquidation vers le compte de TVA due (4441) ou crédit de TVA (4449).",
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
    remediation:
      'À chaque déclaration, centraliser la TVA collectée (443) et déductible (445) pour dégager la TVA à décaisser (4441) ou le crédit de TVA (4449). Solder les comptes de TVA de la période déclarée.',
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
    remediation:
      "Produire et déposer ensemble les quatre états du système normal — Bilan, Compte de résultat, Tableau des flux de trésorerie et Notes annexes ; aucun n'est dissociable des autres (AUDCIF art. 8). Compléter l'état manquant avant dépôt.",
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
    remediation:
      "Vérifier l'enchaînement de la cascade SIG (marge commerciale → valeur ajoutée → EBE → résultat d'exploitation → financier → HAO → résultat net) : chaque solde découle du précédent. Corriger l'imputation qui fausse un palier intermédiaire.",
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
    remediation:
      "Pour un contrat de location-acquisition (transfert des risques et avantages), inscrire le bien à l'actif immobilisé et la dette au passif, puis l'amortir. Retraiter les redevances passées à tort en charges.",
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
    remediation:
      "Comptabiliser les redevances d'une location simple en charges de la période (compte 622), sans porter le bien à l'actif du preneur. Reclasser toute immobilisation inscrite à tort.",
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
    remediation:
      "Ne maintenir une provision pour risques et charges (classe 19) que si l'obligation est actuelle, probable et évaluable de façon fiable à la clôture. Justifier la base d'évaluation ; à défaut de fondement, reprendre la provision.",
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
    remediation:
      "Reprendre au résultat toute provision devenue sans objet ou excédentaire dès l'exercice où sa cause disparaît. Une provision non reprise surévalue les charges et fausse le résultat.",
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
    remediation:
      "À l'inventaire, déprécier tout actif dont la valeur actuelle est inférieure à sa valeur nette comptable (compte 29 ou 39), conformément au principe de prudence.",
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
    remediation:
      "Reprendre la dépréciation d'un actif dont la valeur actuelle est remontée, dans la limite de la valeur nette comptable qu'il aurait eue sans dépréciation (valeur d'origine amortie).",
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
    remediation:
      "Inscrire la subvention d'investissement au passif (compte 14) et la rapporter au résultat (compte 865) au rythme de l'amortissement du bien financé. Régulariser la quote-part de l'exercice non encore reprise.",
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
    remediation:
      "Comptabiliser les subventions d'exploitation (compte 71) et d'équilibre (compte 88) en produits de l'exercice qu'elles concernent. Reclasser toute subvention portée à tort en capitaux propres ou en report.",
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
    remediation:
      "Évaluer les engagements de retraite et avantages du personnel (méthode actuarielle) et les provisionner (compte 15) ou, à défaut, les mentionner en notes annexes. Ne pas laisser l'engagement hors des comptes sans information.",
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
    remediation:
      "Rattacher charges et produits à l'exercice concerné via les comptes de régularisation (charges et produits constatés d'avance 476/477, charges à payer, produits à recevoir). Corriger tout produit ou charge enregistré sur le mauvais exercice (spécialisation des exercices).",
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
    remediation:
      "Constater à la clôture les charges engagées non encore facturées (charges à payer) et les produits acquis non encore facturés (produits à recevoir), pour donner une image fidèle du résultat de l'exercice.",
  },
  {
    id: 'comptes-attente-soldes',
    domain: 'regularizations',
    label: 'Comptes d’attente et virements de fonds soldés à la clôture',
    description:
      'Les comptes d’attente (471) et de virements de fonds (585) sont soldés à la clôture : un solde résiduel traduit une opération en suspens non imputée définitivement sur son compte de destination.',
    severity: 'warning',
    legalBasis: ['Guide SYSCOHADA Tome 1 — Comptes transitoires et d’attente'],
    tome: 1,
    evidenceQuery: 'compte attente 471 virement fonds 585 transitoire solde regularisation cloture',
    remediation:
      'Solder les comptes d’attente (471) et de virements de fonds (585) avant l’arrêté : imputer définitivement chaque opération en suspens sur son compte de destination. Un solde résiduel signale une opération non régularisée à analyser pièce par pièce.',
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
    remediation:
      "Évaluer les apports de fusion / scission / apport partiel (valeur réelle ou comptable selon le sens de l'opération) et justifier la parité d'échange par un rapport. Comptabiliser conformément au traité d'apport.",
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
    remediation:
      "Enregistrer les effets de commerce acceptés en effets à recevoir (412) ou à payer (402), distincts des comptes de tiers ordinaires, jusqu'à leur échéance. Reclasser les effets restés à tort en 401/411.",
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
    remediation:
      "À l'escompte d'un effet, comptabiliser les agios (intérêts et commissions) en charges financières (compte 67) et continuer à suivre l'effet jusqu'à son échéance. Ne pas solder l'effet dès l'escompte.",
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
    remediation:
      "Convertir les créances et dettes en devises au cours de clôture et constater l'écart de conversion (compte 478) face à la valeur d'entrée. Mettre à jour les comptes de tiers concernés.",
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
    remediation:
      'Constater une provision pour perte de change (compte 19) sur les écarts de conversion-actif (pertes latentes), au titre du principe de prudence ; les gains latents (conversion-passif) ne sont pas constatés en résultat.',
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
    remediation:
      'Recenser et présenter en notes annexes (engagements hors bilan) les garanties, gages, hypothèques, cautions et avals donnés ou reçus. Compléter la note des engagements omis avant dépôt.',
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
    remediation:
      "Ventiler le Tableau des flux de trésorerie en trois catégories — activités opérationnelles, d'investissement et de financement — pour expliquer la variation de trésorerie. Reclasser tout flux affecté à la mauvaise catégorie.",
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
    remediation:
      'Établir périodiquement un état de rapprochement entre le solde du compte banque (521) et le relevé bancaire, justifiant chaque écart (chèques en circulation, virements en attente). Régulariser les écritures manquantes (agios, frais).',
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
    remediation:
      "Toute réponse de l'assistant sur une règle SYSCOHADA doit citer sa source (tome, titre, lignes du Guide) ; à défaut, ne rien affirmer. Reformuler la réponse non sourcée en s'appuyant sur le corpus embarqué.",
  },
];

export function getControlsForDomain(domain: SyscohadaDomain): ReadonlyArray<SyscohadaControl> {
  return SYSCOHADA_CONTROL_CATALOG.filter((control) => control.domain === domain);
}
