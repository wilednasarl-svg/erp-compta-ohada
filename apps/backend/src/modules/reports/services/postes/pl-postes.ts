/**
 * Référentiel exhaustif des postes lettrés du COMPTE DE RÉSULTAT
 * SYSCOHADA AUDCIF.
 *
 * Source officielle : Guide d'application du SYSCOHADA Révisé,
 * Volume 3 « Présentation des états financiers annuels », page 33
 * (tableau du Compte de résultat « en liste » avec cascade des
 * 9 Soldes Intermédiaires de Gestion — SIG).
 *
 * Référentiel synthétisé : `.local/synthese/tome-3-etats-financiers.md`
 * section 2.3 (« Compte de résultat ») et section 3 (« Cascade SIG »).
 *
 * Ce fichier est un RÉFÉRENTIEL PUR (données statiques uniquement) :
 * il ne contient aucune logique d'agrégation, aucun appel à la base de
 * données. Il sera consommé par les services `profit-loss.service.ts`
 * et `ohada-classifier.ts` (vagues W2.1/W2.2 de la roadmap).
 *
 * Convention :
 *   - `sourceAccountPrefixes` : préfixes de comptes PCG OHADA dont le
 *     solde alimente le poste (sens créditeur pour les PRODUITS,
 *     débiteur pour les CHARGES — cf. colonne « sens » page 33).
 *   - `deductionPrefixes` : préfixes venant en déduction (RRR obtenus
 *     sur achats, comptes de stockage terminant en 9, etc.). Voir
 *     `notes` poste par poste pour le détail.
 *   - `computationFormula` : OBLIGATOIRE pour les SIG. Formule en
 *     CODES DE POSTES, transcrite mot pour mot depuis le tableau page 33.
 *   - `sign` : +1 pour PRODUITS et SIG, -1 pour CHARGES. Permet à un
 *     consommateur de sommer mécaniquement sans avoir à connaître le
 *     `kind`.
 *   - `parentGroup` : code du SIG immédiat auquel le poste contribue
 *     dans la cascade. Les SIG eux-mêmes pointent vers le SIG suivant.
 *
 * Note méthodologique sur la formule XC (Valeur ajoutée) :
 *   La doctrine OHADA exprime XC sous deux formes équivalentes :
 *     - "XC = XB + RA + RB + Σ(TE..RJ)"  (forme additive, doctrine p. 33)
 *     - "XC = XA + Σ(TB..TI) + Σ(RC..RJ)" (forme par accumulation SIG)
 *   Nous retenons la forme additive doctrinale telle qu'écrite p. 33.
 */

/** Nature d'un poste du Compte de résultat. */
export type PlPosteKind = 'CHARGE' | 'PRODUIT' | 'SIG' | 'RESULTAT';

/** Section éditoriale du Compte de résultat. */
export type PlSection =
  | 'Activités ordinaires'
  | 'HAO'
  | 'Soldes intermédiaires'
  | 'Résultats';

/** Définition d'un poste lettré du Compte de résultat. */
export interface PlPosteRef {
  /** Code lettré officiel (2 lettres : RA..TO côté flux, XA..XI côté SIG). */
  readonly code: string;
  /** Libellé officiel exact (doctrine OHADA Tome 3, page 33). */
  readonly label: string;
  /** Nature du poste. */
  readonly kind: PlPosteKind;
  /** Section éditoriale (cf. type `PlSection`). */
  readonly section: PlSection;
  /**
   * Préfixes de comptes OHADA dont le solde alimente le poste.
   * Vide pour les SIG (calculés par formule).
   */
  readonly sourceAccountPrefixes: readonly string[];
  /**
   * Préfixes venant en déduction (RRR sur achats, comptes terminant
   * en 9 pour la chaîne 60x9, etc.). Vide si non applicable.
   */
  readonly deductionPrefixes: readonly string[];
  /**
   * OBLIGATOIRE pour `kind === 'SIG'`. Formule exprimée en codes de
   * postes, transcrite mot pour mot depuis la doctrine p. 33.
   */
  readonly computationFormula?: string;
  /** +1 pour PRODUITS / SIG, -1 pour CHARGES. */
  readonly sign: 1 | -1;
  /** Code du SIG immédiat auquel ce poste contribue. */
  readonly parentGroup?: string;
  /** Page de référence dans le Guide d'application (Tome 3). */
  readonly doctrinePage: number;
  /** Commentaire libre sur les retraitements ou particularités. */
  readonly notes?: string;
}

/* ========================================================================== */
/* SECTION 1 — ACTIVITÉS ORDINAIRES — Marge commerciale                       */
/* ========================================================================== */

const MARGE_COMMERCIALE: readonly PlPosteRef[] = [
  {
    code: 'TA',
    label: 'Ventes de marchandises',
    kind: 'PRODUIT',
    section: 'Activités ordinaires',
    sourceAccountPrefixes: ['701'],
    deductionPrefixes: ['7019'],
    sign: 1,
    parentGroup: 'XA',
    doctrinePage: 33,
    notes:
      'Solde créditeur 701 net des RRR accordés (7019). Ventilation Note 21.',
  },
  {
    code: 'RA',
    label: 'Achats de marchandises',
    kind: 'CHARGE',
    section: 'Activités ordinaires',
    sourceAccountPrefixes: ['601'],
    deductionPrefixes: ['6019'],
    sign: -1,
    parentGroup: 'XA',
    doctrinePage: 33,
    notes:
      'Solde débiteur 601 net des RRR obtenus (6019). Ventilation Note 22.',
  },
  {
    code: 'RB',
    label: 'Variation de stocks de marchandises',
    kind: 'CHARGE',
    section: 'Activités ordinaires',
    sourceAccountPrefixes: ['6031'],
    deductionPrefixes: [],
    sign: -1,
    parentGroup: 'XA',
    doctrinePage: 33,
    notes:
      'Compte 6031 : solde débiteur = déstockage (charge positive), solde créditeur = stockage (vient en moins). Le sens algébrique est porté par le solde lui-même. Note 6.',
  },
];

/* ========================================================================== */
/* SECTION 2 — SIG : Marge commerciale (XA)                                   */
/* ========================================================================== */

const SIG_XA: PlPosteRef = {
  code: 'XA',
  label: 'MARGE COMMERCIALE',
  kind: 'SIG',
  section: 'Soldes intermédiaires',
  sourceAccountPrefixes: [],
  deductionPrefixes: [],
  computationFormula: 'XA = TA + RA + RB',
  sign: 1,
  parentGroup: 'XC',
  doctrinePage: 33,
  notes:
    'Formule additive doctrinale p. 33 : signes algébriques portés par RA (-) et RB (-/+). Équivaut à TA − |RA| ± RB.',
};

/* ========================================================================== */
/* SECTION 3 — ACTIVITÉS ORDINAIRES — Chiffre d'affaires                      */
/* ========================================================================== */

const CHIFFRE_AFFAIRES: readonly PlPosteRef[] = [
  {
    code: 'TB',
    label: 'Ventes de produits fabriqués',
    kind: 'PRODUIT',
    section: 'Activités ordinaires',
    sourceAccountPrefixes: ['702', '703', '704'],
    deductionPrefixes: ['7029', '7039', '7049'],
    sign: 1,
    parentGroup: 'XB',
    doctrinePage: 33,
    notes: 'Solde créditeur 702 à 704 net des RRR accordés. Note 21.',
  },
  {
    code: 'TC',
    label: 'Travaux, services vendus',
    kind: 'PRODUIT',
    section: 'Activités ordinaires',
    sourceAccountPrefixes: ['705', '706'],
    deductionPrefixes: ['7059', '7069'],
    sign: 1,
    parentGroup: 'XB',
    doctrinePage: 33,
    notes: 'Solde créditeur 705-706 net des RRR. Note 21.',
  },
  {
    code: 'TD',
    label: 'Produits accessoires',
    kind: 'PRODUIT',
    section: 'Activités ordinaires',
    sourceAccountPrefixes: ['707'],
    deductionPrefixes: ['7079'],
    sign: 1,
    parentGroup: 'XB',
    doctrinePage: 33,
    notes: 'Solde créditeur 707 net des RRR. Note 21.',
  },
];

/* ========================================================================== */
/* SECTION 4 — SIG : Chiffre d'affaires (XB)                                  */
/* ========================================================================== */

const SIG_XB: PlPosteRef = {
  code: 'XB',
  label: "CHIFFRE D'AFFAIRES",
  kind: 'SIG',
  section: 'Soldes intermédiaires',
  sourceAccountPrefixes: [],
  deductionPrefixes: [],
  computationFormula: 'XB = TA + TB + TC + TD',
  sign: 1,
  parentGroup: 'XC',
  doctrinePage: 33,
  notes:
    "Somme des ventes de marchandises (TA), produits fabriqués (TB), travaux/services (TC), produits accessoires (TD). Doctrine p. 33.",
};

/* ========================================================================== */
/* SECTION 5 — ACTIVITÉS ORDINAIRES — Production & autres produits expl.      */
/* ========================================================================== */

const PRODUCTION_ET_AUTRES_PRODUITS: readonly PlPosteRef[] = [
  {
    code: 'TE',
    label: 'Production stockée (ou déstockage)',
    kind: 'PRODUIT',
    section: 'Activités ordinaires',
    sourceAccountPrefixes: ['73'],
    deductionPrefixes: [],
    sign: 1,
    parentGroup: 'XC',
    doctrinePage: 33,
    notes:
      'Compte 73 : solde créditeur (stockage) = +, solde débiteur (déstockage) = −. Note 6.',
  },
  {
    code: 'TF',
    label: 'Production immobilisée',
    kind: 'PRODUIT',
    section: 'Activités ordinaires',
    sourceAccountPrefixes: ['72'],
    deductionPrefixes: [],
    sign: 1,
    parentGroup: 'XC',
    doctrinePage: 33,
    notes: 'Solde créditeur 72. Note 21.',
  },
  {
    code: 'TG',
    label: "Subventions d'exploitation",
    kind: 'PRODUIT',
    section: 'Activités ordinaires',
    sourceAccountPrefixes: ['71'],
    deductionPrefixes: [],
    sign: 1,
    parentGroup: 'XC',
    doctrinePage: 33,
    notes: 'Solde créditeur 71.',
  },
  {
    code: 'TH',
    label: 'Autres produits',
    kind: 'PRODUIT',
    section: 'Activités ordinaires',
    sourceAccountPrefixes: ['75'],
    deductionPrefixes: [],
    sign: 1,
    parentGroup: 'XC',
    doctrinePage: 33,
    notes:
      "Solde créditeur 75 (auquel la doctrine adjoint 781 hors 7813 ; voir TI pour 781). Note 21.",
  },
  {
    code: 'TI',
    label: "Transferts de charges d'exploitation",
    kind: 'PRODUIT',
    section: 'Activités ordinaires',
    sourceAccountPrefixes: ['781'],
    deductionPrefixes: [],
    sign: 1,
    parentGroup: 'XC',
    doctrinePage: 33,
    notes: 'Solde créditeur 781. Note 12.',
  },
];

/* ========================================================================== */
/* SECTION 6 — ACTIVITÉS ORDINAIRES — Achats matières & autres charges expl.  */
/* ========================================================================== */

const ACHATS_ET_CHARGES_EXTERNES: readonly PlPosteRef[] = [
  {
    code: 'RC',
    label: 'Achats de matières premières et fournitures liées',
    kind: 'CHARGE',
    section: 'Activités ordinaires',
    sourceAccountPrefixes: ['602'],
    deductionPrefixes: ['6029'],
    sign: -1,
    parentGroup: 'XC',
    doctrinePage: 33,
    notes: 'Solde débiteur 602 net des RRR obtenus (6029). Note 22.',
  },
  {
    code: 'RD',
    label: 'Variation de stocks de matières premières et fournitures liées',
    kind: 'CHARGE',
    section: 'Activités ordinaires',
    sourceAccountPrefixes: ['6032'],
    deductionPrefixes: [],
    sign: -1,
    parentGroup: 'XC',
    doctrinePage: 33,
    notes: 'Compte 6032. Même logique de sens que RB. Note 6.',
  },
  {
    code: 'RE',
    label: 'Autres achats',
    kind: 'CHARGE',
    section: 'Activités ordinaires',
    sourceAccountPrefixes: ['604', '605', '608'],
    deductionPrefixes: ['6049', '6059', '6089'],
    sign: -1,
    parentGroup: 'XC',
    doctrinePage: 33,
    notes:
      'Solde débiteur 604/605/608 net des RRR obtenus. Note 22.',
  },
  {
    code: 'RF',
    label: "Variation de stocks d'autres approvisionnements",
    kind: 'CHARGE',
    section: 'Activités ordinaires',
    sourceAccountPrefixes: ['6033'],
    deductionPrefixes: [],
    sign: -1,
    parentGroup: 'XC',
    doctrinePage: 33,
    notes: 'Compte 6033. Même logique de sens que RB. Note 6.',
  },
  {
    code: 'RG',
    label: 'Transports',
    kind: 'CHARGE',
    section: 'Activités ordinaires',
    sourceAccountPrefixes: ['61'],
    deductionPrefixes: [],
    sign: -1,
    parentGroup: 'XC',
    doctrinePage: 33,
    notes: 'Solde débiteur classe 61. Note 23.',
  },
  {
    code: 'RH',
    label: 'Services extérieurs',
    kind: 'CHARGE',
    section: 'Activités ordinaires',
    sourceAccountPrefixes: ['62', '63'],
    deductionPrefixes: [],
    sign: -1,
    parentGroup: 'XC',
    doctrinePage: 33,
    notes:
      'Contracte les classes 62 et 63 (solde débiteur cumulé). Note 24.',
  },
  {
    code: 'RI',
    label: 'Impôts et taxes',
    kind: 'CHARGE',
    section: 'Activités ordinaires',
    sourceAccountPrefixes: ['64'],
    deductionPrefixes: [],
    sign: -1,
    parentGroup: 'XC',
    doctrinePage: 33,
    notes: 'Solde débiteur classe 64. Note 25.',
  },
  {
    code: 'RJ',
    label: 'Autres charges',
    kind: 'CHARGE',
    section: 'Activités ordinaires',
    sourceAccountPrefixes: ['65'],
    deductionPrefixes: [],
    sign: -1,
    parentGroup: 'XC',
    doctrinePage: 33,
    notes: 'Solde débiteur classe 65. Note 26.',
  },
];

/* ========================================================================== */
/* SECTION 7 — SIG : Valeur ajoutée (XC)                                      */
/* ========================================================================== */

const SIG_XC: PlPosteRef = {
  code: 'XC',
  label: 'VALEUR AJOUTÉE',
  kind: 'SIG',
  section: 'Soldes intermédiaires',
  sourceAccountPrefixes: [],
  deductionPrefixes: [],
  computationFormula:
    'XC = XB + RA + RB + TE + TF + TG + TH + TI + RC + RD + RE + RF + RG + RH + RI + RJ',
  sign: 1,
  parentGroup: 'XD',
  doctrinePage: 33,
  notes:
    "Forme additive doctrinale p. 33 : « XC = (XB + RA + RB) + Σ(TE..RJ) ». Les charges (RA, RB, RC..RJ) sont déjà signées −, donc la sommation algébrique est correcte.",
};

/* ========================================================================== */
/* SECTION 8 — ACTIVITÉS ORDINAIRES — Charges de personnel                    */
/* ========================================================================== */

const CHARGES_PERSONNEL: readonly PlPosteRef[] = [
  {
    code: 'RK',
    label: 'Charges de personnel',
    kind: 'CHARGE',
    section: 'Activités ordinaires',
    sourceAccountPrefixes: ['66'],
    deductionPrefixes: [],
    sign: -1,
    parentGroup: 'XD',
    doctrinePage: 33,
    notes: 'Solde débiteur classe 66. Note 27A.',
  },
];

/* ========================================================================== */
/* SECTION 9 — SIG : Excédent brut d'exploitation (XD)                        */
/* ========================================================================== */

const SIG_XD: PlPosteRef = {
  code: 'XD',
  label: "EXCÉDENT BRUT D'EXPLOITATION",
  kind: 'SIG',
  section: 'Soldes intermédiaires',
  sourceAccountPrefixes: [],
  deductionPrefixes: [],
  computationFormula: 'XD = XC + RK',
  sign: 1,
  parentGroup: 'XE',
  doctrinePage: 33,
  notes: 'Doctrine p. 33 : EBE = Valeur ajoutée + Charges de personnel (signe −).',
};

/* ========================================================================== */
/* SECTION 10 — ACTIVITÉS ORDINAIRES — Reprises & dotations d'exploitation    */
/* ========================================================================== */

const REPRISES_DOTATIONS_EXPLOITATION: readonly PlPosteRef[] = [
  {
    code: 'TJ',
    label: "Reprises d'amortissements, provisions et dépréciations",
    kind: 'PRODUIT',
    section: 'Activités ordinaires',
    sourceAccountPrefixes: ['791', '798', '799'],
    deductionPrefixes: [],
    sign: 1,
    parentGroup: 'XE',
    doctrinePage: 33,
    notes: 'Solde créditeur 791/798/799. Note 28.',
  },
  {
    code: 'RL',
    label: 'Dotations aux amortissements, aux provisions et dépréciations',
    kind: 'CHARGE',
    section: 'Activités ordinaires',
    sourceAccountPrefixes: ['681', '691'],
    deductionPrefixes: [],
    sign: -1,
    parentGroup: 'XE',
    doctrinePage: 33,
    notes: 'Solde débiteur 681 (expl.) et 691 (fin.). Notes 3C & 28.',
  },
];

/* ========================================================================== */
/* SECTION 11 — SIG : Résultat d'exploitation (XE)                            */
/* ========================================================================== */

const SIG_XE: PlPosteRef = {
  code: 'XE',
  label: "RÉSULTAT D'EXPLOITATION",
  kind: 'SIG',
  section: 'Soldes intermédiaires',
  sourceAccountPrefixes: [],
  deductionPrefixes: [],
  computationFormula: 'XE = XD + TJ + RL',
  sign: 1,
  parentGroup: 'XG',
  doctrinePage: 33,
  notes: 'Doctrine p. 33.',
};

/* ========================================================================== */
/* SECTION 12 — ACTIVITÉS ORDINAIRES — Volet financier                        */
/* ========================================================================== */

const VOLET_FINANCIER: readonly PlPosteRef[] = [
  {
    code: 'TK',
    label: 'Revenus financiers et assimilés',
    kind: 'PRODUIT',
    section: 'Activités ordinaires',
    sourceAccountPrefixes: ['77'],
    deductionPrefixes: [],
    sign: 1,
    parentGroup: 'XF',
    doctrinePage: 33,
    notes:
      'Solde créditeur classe 77 (la doctrine adjoint 797 ; voir TL pour le détail des reprises financières). Note 29.',
  },
  {
    code: 'TL',
    label: 'Reprises de provisions et dépréciations financières',
    kind: 'PRODUIT',
    section: 'Activités ordinaires',
    sourceAccountPrefixes: ['797'],
    deductionPrefixes: [],
    sign: 1,
    parentGroup: 'XF',
    doctrinePage: 33,
    notes: 'Solde créditeur 797. Note 29.',
  },
  {
    code: 'TM',
    label: 'Transferts de charges financières',
    kind: 'PRODUIT',
    section: 'Activités ordinaires',
    sourceAccountPrefixes: ['787'],
    deductionPrefixes: [],
    sign: 1,
    parentGroup: 'XF',
    doctrinePage: 33,
    notes: 'Solde créditeur 787. Note 29.',
  },
  {
    code: 'RM',
    label: 'Frais financiers et charges assimilées',
    kind: 'CHARGE',
    section: 'Activités ordinaires',
    sourceAccountPrefixes: ['67'],
    deductionPrefixes: [],
    sign: -1,
    parentGroup: 'XF',
    doctrinePage: 33,
    notes: 'Solde débiteur classe 67. Note 29.',
  },
  {
    code: 'RN',
    label: 'Dotations aux provisions et dépréciations financières',
    kind: 'CHARGE',
    section: 'Activités ordinaires',
    sourceAccountPrefixes: ['697'],
    deductionPrefixes: [],
    sign: -1,
    parentGroup: 'XF',
    doctrinePage: 33,
    notes: 'Solde débiteur 697. Note 29.',
  },
];

/* ========================================================================== */
/* SECTION 13 — SIG : Résultat financier (XF) + Résultat AO (XG)              */
/* ========================================================================== */

const SIG_XF: PlPosteRef = {
  code: 'XF',
  label: 'RÉSULTAT FINANCIER',
  kind: 'SIG',
  section: 'Soldes intermédiaires',
  sourceAccountPrefixes: [],
  deductionPrefixes: [],
  computationFormula: 'XF = TK + TL + TM + RM + RN',
  sign: 1,
  parentGroup: 'XG',
  doctrinePage: 33,
  notes: 'Doctrine p. 33 : Σ TK à RN.',
};

const SIG_XG: PlPosteRef = {
  code: 'XG',
  label: 'RÉSULTAT DES ACTIVITÉS ORDINAIRES',
  kind: 'SIG',
  section: 'Soldes intermédiaires',
  sourceAccountPrefixes: [],
  deductionPrefixes: [],
  computationFormula: 'XG = XE + XF',
  sign: 1,
  parentGroup: 'XI',
  doctrinePage: 33,
  notes: 'Doctrine p. 33 : RAO = Résultat exploitation + Résultat financier.',
};

/* ========================================================================== */
/* SECTION 14 — HORS ACTIVITÉS ORDINAIRES (HAO)                               */
/* ========================================================================== */

const HAO: readonly PlPosteRef[] = [
  {
    code: 'TN',
    label: "Produits des cessions d'immobilisations",
    kind: 'PRODUIT',
    section: 'HAO',
    sourceAccountPrefixes: ['82'],
    deductionPrefixes: [],
    sign: 1,
    parentGroup: 'XH',
    doctrinePage: 33,
    notes: 'Solde créditeur classe 82. Note 3D.',
  },
  {
    code: 'TO',
    label: 'Autres produits HAO',
    kind: 'PRODUIT',
    section: 'HAO',
    sourceAccountPrefixes: ['84', '86', '88'],
    deductionPrefixes: [],
    sign: 1,
    parentGroup: 'XH',
    doctrinePage: 33,
    notes: 'Solde créditeur classes 84/86/88. Note 30.',
  },
  {
    code: 'RO',
    label: "Valeurs comptables des cessions d'immobilisations",
    kind: 'CHARGE',
    section: 'HAO',
    sourceAccountPrefixes: ['81'],
    deductionPrefixes: [],
    sign: -1,
    parentGroup: 'XH',
    doctrinePage: 33,
    notes: 'Solde débiteur classe 81. Note 3D.',
  },
  {
    code: 'RP',
    label: 'Autres charges HAO',
    kind: 'CHARGE',
    section: 'HAO',
    sourceAccountPrefixes: ['83', '85'],
    deductionPrefixes: [],
    sign: -1,
    parentGroup: 'XH',
    doctrinePage: 33,
    notes: 'Solde débiteur classes 83/85. Note 30.',
  },
];

/* ========================================================================== */
/* SECTION 15 — SIG : Résultat HAO (XH)                                       */
/* ========================================================================== */

const SIG_XH: PlPosteRef = {
  code: 'XH',
  label: 'RÉSULTAT HORS ACTIVITÉS ORDINAIRES',
  kind: 'SIG',
  section: 'Soldes intermédiaires',
  sourceAccountPrefixes: [],
  deductionPrefixes: [],
  computationFormula: 'XH = TN + TO + RO + RP',
  sign: 1,
  parentGroup: 'XI',
  doctrinePage: 33,
  notes: 'Doctrine p. 33 : Σ TN à RP.',
};

/* ========================================================================== */
/* SECTION 16 — PARTICIPATION & IMPÔT                                         */
/* ========================================================================== */

const PARTICIPATION_IMPOT: readonly PlPosteRef[] = [
  {
    code: 'RQ',
    label: 'Participation des travailleurs',
    kind: 'CHARGE',
    section: 'Résultats',
    sourceAccountPrefixes: ['87'],
    deductionPrefixes: [],
    sign: -1,
    parentGroup: 'XI',
    doctrinePage: 33,
    notes: 'Solde débiteur classe 87.',
  },
  {
    code: 'RS',
    label: 'Impôts sur le résultat',
    kind: 'CHARGE',
    section: 'Résultats',
    sourceAccountPrefixes: ['89'],
    deductionPrefixes: [],
    sign: -1,
    parentGroup: 'XI',
    doctrinePage: 33,
    notes: 'Solde débiteur classe 89 (impôt exigible + différé éventuel).',
  },
];

/* ========================================================================== */
/* SECTION 17 — SIG : Résultat net (XI)                                       */
/* ========================================================================== */

const SIG_XI: PlPosteRef = {
  code: 'XI',
  label: 'RÉSULTAT NET',
  kind: 'SIG',
  section: 'Soldes intermédiaires',
  sourceAccountPrefixes: [],
  deductionPrefixes: [],
  computationFormula: 'XI = XG + XH + RQ + RS',
  sign: 1,
  doctrinePage: 33,
  notes:
    "Doctrine p. 33 : Résultat net = RAO + HAO − participation − impôt (RQ et RS portent déjà le signe −).",
};

/* ========================================================================== */
/* Export                                                                     */
/* ========================================================================== */

/**
 * Référentiel complet des postes lettrés du Compte de résultat
 * SYSCOHADA AUDCIF (35 postes flux + 9 SIG = 44 entrées).
 *
 * Ordre suivant la cascade éditoriale de la doctrine page 33 :
 *   TA, RA, RB, XA,
 *   TB, TC, TD, XB,
 *   TE, TF, TG, TH, TI, RC, RD, RE, RF, RG, RH, RI, RJ, XC,
 *   RK, XD,
 *   TJ, RL, XE,
 *   TK, TL, TM, RM, RN, XF, XG,
 *   TN, TO, RO, RP, XH,
 *   RQ, RS, XI.
 */
export const PL_POSTES: readonly PlPosteRef[] = [
  ...MARGE_COMMERCIALE,
  SIG_XA,
  ...CHIFFRE_AFFAIRES,
  SIG_XB,
  ...PRODUCTION_ET_AUTRES_PRODUITS,
  ...ACHATS_ET_CHARGES_EXTERNES,
  SIG_XC,
  ...CHARGES_PERSONNEL,
  SIG_XD,
  ...REPRISES_DOTATIONS_EXPLOITATION,
  SIG_XE,
  ...VOLET_FINANCIER,
  SIG_XF,
  SIG_XG,
  ...HAO,
  SIG_XH,
  ...PARTICIPATION_IMPOT,
  SIG_XI,
];

/** Accès direct par code (utilitaire, pas de logique métier). */
export function getPlPoste(code: string): PlPosteRef | undefined {
  return PL_POSTES.find((p) => p.code === code);
}
