/**
 * Référentiel exhaustif des postes lettrés du BILAN SYSCOHADA AUDCIF.
 *
 * Source officielle : Guide d'application du SYSCOHADA Révisé,
 * Volume 3 « Présentation des états financiers annuels »,
 * page 32 (tableau du Bilan — Actif et Passif).
 *
 * Ce fichier est un RÉFÉRENTIEL PUR (données statiques uniquement) :
 * il ne contient aucune logique d'agrégation, aucun appel à la base de
 * données. Il sera consommé par les services `balance-sheet.service.ts`
 * et `bilan-classifier.ts` (vagues W2.1/W2.2 de la roadmap).
 *
 * Convention :
 *   - `sourceAccountPrefixes` : préfixes de comptes PCG OHADA dont le
 *     solde alimente la valeur BRUTE du poste.
 *   - `deductionPrefixes` : préfixes de comptes (amortissements,
 *     dépréciations) dont le solde vient SOUSTRAIRE de la valeur brute
 *     pour obtenir la valeur NETTE du poste (cf. doctrine page 32).
 *   - `sign` : +1 par défaut. -1 lorsque le poste apparaît en
 *     déduction d'un total parent (ex. CB « apporteurs capital non
 *     appelé » se présente en moins du capital).
 *   - `parentGroup` : code du sous-total auquel ce poste contribue.
 *     Les totaux eux-mêmes pointent éventuellement vers un total
 *     englobant (ex. AZ pointe vers BZ via la cascade implicite).
 *   - Les SOUS-TOTAUX (AZ, BG, BK, BT, BZ, CP, DD, DF, DP, DT, DZ)
 *     sont marqués avec `section: '_TOTAL_'` et
 *     `sourceAccountPrefixes: []`. Leur valeur est calculée par
 *     sommation des postes enfants (qui ont leur `parentGroup` pointant
 *     vers le total).
 *
 * Note importante : ce référentiel reflète FIDÈLEMENT la doctrine OHADA
 * synthétisée dans `.local/synthese/tome-3-etats-financiers.md` section 2.1
 * et 2.2. Les libellés sont les libellés OFFICIELS exacts attendus dans
 * une DSF déposable au greffe / DGI.
 */

/** Côté du Bilan. */
export type BilanSide = 'ACTIF' | 'PASSIF';

/** Définition d'un poste lettré du Bilan. */
export interface BilanPosteRef {
  /** Code lettré officiel (2 lettres, ex. 'AE', 'CG', 'DZ'). */
  readonly code: string;
  /** Libellé officiel exact (doctrine OHADA Tome 3, page 32). */
  readonly label: string;
  /**
   * Code de la note annexe associée (Tome 3 p. 32, colonne « Note »).
   * Exemple : '3' pour les Immobilisations, '7' pour les Clients,
   * '11' pour la Trésorerie-Actif. Optionnel — les sous-totaux et
   * les écarts de conversion peuvent en porter aussi (note 12). Les
   * masses pures (AZ, BK, BT, BZ, CP, DD, DF, DP, DT, DZ) n'en
   * portent pas.
   */
  readonly note?: string;
  /** Côté Actif ou Passif. */
  readonly side: BilanSide;
  /**
   * Section éditoriale du bilan (ex. 'Actif immobilisé',
   * 'Capitaux propres'). Pour les sous-totaux : '_TOTAL_'.
   */
  readonly section: string;
  /**
   * Préfixes de comptes OHADA dont le solde brut alimente le poste.
   * Vide pour les sous-totaux.
   */
  readonly sourceAccountPrefixes: readonly string[];
  /**
   * Préfixes de comptes d'amortissements / dépréciations soustraits
   * de la valeur brute pour obtenir la valeur nette.
   */
  readonly deductionPrefixes: readonly string[];
  /** +1 par défaut, -1 si le poste se présente en déduction. */
  readonly sign: 1 | -1;
  /** Code du sous-total parent agrégeant ce poste. */
  readonly parentGroup?: string;
  /** Page de référence dans le Guide d'application (Tome 3). */
  readonly doctrinePage: number;
  /** Commentaire libre sur les retraitements ou particularités. */
  readonly notes?: string;
}

/* ========================================================================== */
/* ACTIF — postes AD à BZ                                                     */
/* ========================================================================== */

const ACTIF_POSTES: readonly BilanPosteRef[] = [
  // --- ACTIF IMMOBILISÉ ---
  {
    code: 'AD',
    label: 'IMMOBILISATIONS INCORPORELLES',
    note: '3',
    side: 'ACTIF',
    section: 'Actif immobilisé',
    sourceAccountPrefixes: ['21'],
    deductionPrefixes: [
      '2811',
      '2812',
      '2813',
      '2814',
      '2815',
      '2816',
      '2817',
      '2818',
      '2911',
      '2912',
      '2913',
      '2914',
      '2915',
      '2916',
      '2917',
      '2918',
      '219',
    ],
    sign: 1,
    parentGroup: 'AZ',
    doctrinePage: 32,
    notes: 'Σ classes 21 brut − amort./dépréc. classe 28/29 incorporel. Note 3.',
  },
  {
    code: 'AE',
    label: 'Frais de développement et de prospection',
    side: 'ACTIF',
    section: 'Actif immobilisé',
    sourceAccountPrefixes: ['211'],
    deductionPrefixes: ['2811', '2911'],
    sign: 1,
    parentGroup: 'AD',
    doctrinePage: 32,
    notes: 'Brut − 2811 − 2911.',
  },
  {
    code: 'AF',
    label: 'Brevets, licences, logiciels et droits similaires',
    side: 'ACTIF',
    section: 'Actif immobilisé',
    sourceAccountPrefixes: ['212', '213', '214'],
    deductionPrefixes: ['2812', '2813', '2814', '2912', '2913', '2914'],
    sign: 1,
    parentGroup: 'AD',
    doctrinePage: 32,
  },
  {
    code: 'AG',
    label: 'Fonds commercial et droit au bail',
    side: 'ACTIF',
    section: 'Actif immobilisé',
    sourceAccountPrefixes: ['215', '216'],
    deductionPrefixes: ['2815', '2816', '2915', '2916'],
    sign: 1,
    parentGroup: 'AD',
    doctrinePage: 32,
  },
  {
    code: 'AH',
    label: 'Autres immobilisations incorporelles',
    side: 'ACTIF',
    section: 'Actif immobilisé',
    sourceAccountPrefixes: ['217', '218'],
    deductionPrefixes: ['2817', '2818', '2917', '2918'],
    sign: 1,
    parentGroup: 'AD',
    doctrinePage: 32,
  },
  {
    code: 'AI',
    label: 'IMMOBILISATIONS CORPORELLES',
    note: '3',
    side: 'ACTIF',
    section: 'Actif immobilisé',
    sourceAccountPrefixes: ['22', '23', '24'],
    deductionPrefixes: ['282', '283', '284', '292', '293', '294'],
    sign: 1,
    parentGroup: 'AZ',
    doctrinePage: 32,
    notes: 'Σ classes 22–24 brut − amort. 282/283/284 − dépréc. 292/293/294. Note 3.',
  },
  {
    code: 'AJ',
    label: 'Terrains (dont placement)',
    side: 'ACTIF',
    section: 'Actif immobilisé',
    sourceAccountPrefixes: ['22'],
    deductionPrefixes: ['282', '292'],
    sign: 1,
    parentGroup: 'AI',
    doctrinePage: 32,
  },
  {
    code: 'AK',
    label: 'Bâtiments (dont placement)',
    side: 'ACTIF',
    section: 'Actif immobilisé',
    sourceAccountPrefixes: ['231', '232', '233', '234', '237', '238'],
    deductionPrefixes: [
      '2831',
      '2832',
      '2833',
      '2834',
      '2837',
      '2838',
      '2931',
      '2932',
      '2933',
      '2934',
      '2937',
      '2938',
    ],
    sign: 1,
    parentGroup: 'AI',
    doctrinePage: 32,
  },
  {
    code: 'AL',
    label: 'Aménagements, agencements et installations',
    side: 'ACTIF',
    section: 'Actif immobilisé',
    sourceAccountPrefixes: ['235', '238'],
    deductionPrefixes: ['2835', '2935'],
    sign: 1,
    parentGroup: 'AI',
    doctrinePage: 32,
  },
  {
    code: 'AM',
    label: 'Matériel, mobilier et actifs biologiques',
    side: 'ACTIF',
    section: 'Actif immobilisé',
    sourceAccountPrefixes: ['241', '244', '246'],
    deductionPrefixes: ['2841', '2844', '2846', '2941', '2944', '2946'],
    sign: 1,
    parentGroup: 'AI',
    doctrinePage: 32,
  },
  {
    code: 'AN',
    label: 'Matériel de transport',
    side: 'ACTIF',
    section: 'Actif immobilisé',
    sourceAccountPrefixes: ['245'],
    deductionPrefixes: ['2845', '2945'],
    sign: 1,
    parentGroup: 'AI',
    doctrinePage: 32,
  },
  {
    code: 'AP',
    label: 'AVANCES ET ACOMPTES VERSÉS SUR IMMOBILISATIONS',
    note: '3',
    side: 'ACTIF',
    section: 'Actif immobilisé',
    sourceAccountPrefixes: ['251', '252'],
    deductionPrefixes: ['2951', '2952'],
    sign: 1,
    parentGroup: 'AZ',
    doctrinePage: 32,
    notes: "Solde débiteur des avances sur commandes d'immobilisations. Note 3.",
  },
  {
    code: 'AQ',
    label: 'IMMOBILISATIONS FINANCIÈRES',
    note: '4',
    side: 'ACTIF',
    section: 'Actif immobilisé',
    sourceAccountPrefixes: ['26', '27'],
    deductionPrefixes: ['296', '297'],
    sign: 1,
    parentGroup: 'AZ',
    doctrinePage: 32,
    notes: 'Σ brut − dépréc. 296/297. Note 4.',
  },
  {
    code: 'AR',
    label: 'Titres de participation',
    side: 'ACTIF',
    section: 'Actif immobilisé',
    sourceAccountPrefixes: ['26'],
    deductionPrefixes: ['296'],
    sign: 1,
    parentGroup: 'AQ',
    doctrinePage: 32,
  },
  {
    code: 'AS',
    label: 'Autres immobilisations financières',
    side: 'ACTIF',
    section: 'Actif immobilisé',
    sourceAccountPrefixes: ['271', '272', '274', '275', '276', '277'],
    deductionPrefixes: ['297'],
    sign: 1,
    parentGroup: 'AQ',
    doctrinePage: 32,
    notes:
      'Inclut prêts au personnel (272), dépôts et cautionnements (275). 277 intérêts courus hors périmètre.',
  },
  {
    code: 'AZ',
    label: 'TOTAL ACTIF IMMOBILISÉ',
    side: 'ACTIF',
    section: '_TOTAL_',
    sourceAccountPrefixes: [],
    deductionPrefixes: [],
    sign: 1,
    parentGroup: 'BZ',
    doctrinePage: 32,
    notes: 'Σ AD + AI + AP + AQ.',
  },
  // --- ACTIF CIRCULANT ---
  {
    code: 'BA',
    label: 'ACTIF CIRCULANT HAO',
    note: '5',
    side: 'ACTIF',
    section: 'Actif circulant',
    sourceAccountPrefixes: ['485', '488'],
    deductionPrefixes: ['498'],
    sign: 1,
    parentGroup: 'BK',
    doctrinePage: 32,
    notes: 'Solde débiteur. Note 5.',
  },
  {
    code: 'BB',
    label: 'STOCKS ET ENCOURS',
    note: '6',
    side: 'ACTIF',
    section: 'Actif circulant',
    sourceAccountPrefixes: ['31', '32', '33', '34', '35', '36', '37', '38'],
    deductionPrefixes: ['39'],
    sign: 1,
    parentGroup: 'BK',
    doctrinePage: 32,
    notes: 'Brut − dépréc. 39. Note 6.',
  },
  {
    code: 'BG',
    label: 'CRÉANCES ET EMPLOIS ASSIMILÉS',
    side: 'ACTIF',
    section: '_TOTAL_',
    sourceAccountPrefixes: [],
    deductionPrefixes: [],
    sign: 1,
    parentGroup: 'BK',
    doctrinePage: 32,
    notes: 'Σ BH + BI + BJ.',
  },
  {
    code: 'BH',
    label: 'Fournisseurs avances versées',
    note: '17',
    side: 'ACTIF',
    section: 'Actif circulant',
    sourceAccountPrefixes: ['409'],
    deductionPrefixes: ['4909'],
    sign: 1,
    parentGroup: 'BG',
    doctrinePage: 32,
    notes: 'Solde débit. Note 17.',
  },
  {
    code: 'BI',
    label: 'Clients',
    note: '7',
    side: 'ACTIF',
    section: 'Actif circulant',
    sourceAccountPrefixes: ['411', '412', '413', '414', '416', '418', '419'],
    deductionPrefixes: ['491', '492'],
    sign: 1,
    parentGroup: 'BG',
    doctrinePage: 32,
    notes: 'Solde débit (créances douteuses 416 incluses). Note 7.',
  },
  {
    code: 'BJ',
    label: 'Autres créances',
    note: '8',
    side: 'ACTIF',
    section: 'Actif circulant',
    sourceAccountPrefixes: [
      // Classe 42/43/44 à solde DÉBITEUR = créances (avances personnel,
      // TVA récupérable, crédit de TVA, produits à recevoir…). Mêmes préfixes
      // que le poste passif DK : classifyToPoste arbitre par le signe du solde
      // (netSign), conformément au Guide d'application (Tome 3).
      '42',
      '43',
      '44',
      '421',
      '422',
      '425',
      '445',
      '4287',
      '4387',
      '4486',
      '4487',
      '4582',
      '462',
      '463',
      '4664',
      '4665',
      '4667',
      '4674',
      '4675',
      '471',
      '4742',
      '4743',
      '4746',
      '4747',
      '4748',
      '476',
      '488',
    ],
    deductionPrefixes: ['492', '495'],
    sign: 1,
    parentGroup: 'BG',
    doctrinePage: 32,
    notes: 'Solde débit. Note 8.',
  },
  {
    code: 'BK',
    label: 'TOTAL ACTIF CIRCULANT',
    side: 'ACTIF',
    section: '_TOTAL_',
    sourceAccountPrefixes: [],
    deductionPrefixes: [],
    sign: 1,
    parentGroup: 'BZ',
    doctrinePage: 32,
    notes: 'Σ BA + BB + BG.',
  },
  // --- TRÉSORERIE ACTIF ---
  {
    code: 'BQ',
    label: 'Titres de placement',
    note: '10',
    side: 'ACTIF',
    section: 'Trésorerie-Actif',
    sourceAccountPrefixes: ['50'],
    deductionPrefixes: ['590'],
    sign: 1,
    parentGroup: 'BT',
    doctrinePage: 32,
    notes: 'Note 10. Doctrine implicite Tome 3 §1.2.b — non explicité dans modèle exemple.',
  },
  {
    code: 'BR',
    label: 'Valeurs à encaisser',
    note: '9',
    side: 'ACTIF',
    section: 'Trésorerie-Actif',
    sourceAccountPrefixes: ['51'],
    deductionPrefixes: ['591'],
    sign: 1,
    parentGroup: 'BT',
    doctrinePage: 32,
    notes: "Note 9. Comptes 514 valeurs à l'encaissement.",
  },
  {
    code: 'BS',
    label: 'Banques, chèques postaux, caisse et assimilés',
    note: '11',
    side: 'ACTIF',
    section: 'Trésorerie-Actif',
    sourceAccountPrefixes: ['52', '53', '54', '55', '56', '57', '58'],
    deductionPrefixes: ['594', '595', '596', '597'],
    sign: 1,
    parentGroup: 'BT',
    doctrinePage: 32,
    notes: 'Solde débit (51 hors 514 = BR ; 52/53 débit = BS, 52/53 crédit = DR). Note 11.',
  },
  {
    code: 'BT',
    label: 'TOTAL TRÉSORERIE ACTIF',
    side: 'ACTIF',
    section: '_TOTAL_',
    sourceAccountPrefixes: [],
    deductionPrefixes: [],
    sign: 1,
    parentGroup: 'BZ',
    doctrinePage: 32,
    notes: 'Σ BQ + BR + BS.',
  },
  // --- ÉCART DE CONVERSION & TOTAL GÉNÉRAL ---
  {
    code: 'BU',
    label: 'Écart de conversion — Actif',
    note: '12',
    side: 'ACTIF',
    section: 'Écart de conversion',
    sourceAccountPrefixes: ['478'],
    deductionPrefixes: [],
    sign: 1,
    parentGroup: 'BZ',
    doctrinePage: 32,
    notes: 'Solde débit. Note 12.',
  },
  {
    code: 'BZ',
    label: 'TOTAL GÉNÉRAL ACTIF',
    side: 'ACTIF',
    section: '_TOTAL_',
    sourceAccountPrefixes: [],
    deductionPrefixes: [],
    sign: 1,
    doctrinePage: 32,
    notes: 'Σ AZ + BK + BT + BU. Doit équilibrer DZ.',
  },
];

/* ========================================================================== */
/* PASSIF — postes CA à DZ                                                    */
/* ========================================================================== */

const PASSIF_POSTES: readonly BilanPosteRef[] = [
  // --- CAPITAUX PROPRES ---
  {
    code: 'CA',
    label: 'Capital',
    note: '13',
    side: 'PASSIF',
    section: 'Capitaux propres',
    sourceAccountPrefixes: ['101', '102', '103', '104'],
    deductionPrefixes: [],
    sign: 1,
    parentGroup: 'CP',
    doctrinePage: 32,
    notes: 'Solde créditeur. Note 13.',
  },
  {
    code: 'CB',
    label: 'Apporteurs capital non appelé (−)',
    note: '13',
    side: 'PASSIF',
    section: 'Capitaux propres',
    sourceAccountPrefixes: ['109'],
    deductionPrefixes: [],
    sign: -1,
    parentGroup: 'CP',
    doctrinePage: 32,
    notes: 'Solde débit présenté en soustraction du capital. Note 13.',
  },
  {
    code: 'CD',
    label: 'Primes liées au capital social',
    note: '3E',
    side: 'PASSIF',
    section: 'Capitaux propres',
    sourceAccountPrefixes: ['105'],
    deductionPrefixes: [],
    sign: 1,
    parentGroup: 'CP',
    doctrinePage: 32,
    notes: 'Solde créditeur. Note 3E.',
  },
  {
    code: 'CE',
    label: 'Écarts de réévaluation',
    note: '3E',
    side: 'PASSIF',
    section: 'Capitaux propres',
    sourceAccountPrefixes: ['106'],
    deductionPrefixes: [],
    sign: 1,
    parentGroup: 'CP',
    doctrinePage: 32,
    notes: 'Solde créditeur. Note 3E.',
  },
  {
    code: 'CF',
    label: 'Réserves indisponibles',
    note: '14',
    side: 'PASSIF',
    section: 'Capitaux propres',
    sourceAccountPrefixes: ['111', '112', '113'],
    deductionPrefixes: [],
    sign: 1,
    parentGroup: 'CP',
    doctrinePage: 32,
    notes: 'Solde créditeur. Note 14.',
  },
  {
    code: 'CG',
    label: 'Réserves libres',
    note: '14',
    side: 'PASSIF',
    section: 'Capitaux propres',
    sourceAccountPrefixes: ['118'],
    deductionPrefixes: [],
    sign: 1,
    parentGroup: 'CP',
    doctrinePage: 32,
    notes: 'Solde créditeur. Note 14.',
  },
  {
    code: 'CH',
    label: 'Report à nouveau (+ ou −)',
    note: '14',
    side: 'PASSIF',
    section: 'Capitaux propres',
    sourceAccountPrefixes: ['121', '129'],
    deductionPrefixes: [],
    sign: 1,
    parentGroup: 'CP',
    doctrinePage: 32,
    notes: 'Solde créditeur 121 − solde débit 129 (signe selon solde net). Note 14.',
  },
  {
    code: 'CJ',
    label: "Résultat net de l'exercice (bénéfice + / perte −)",
    side: 'PASSIF',
    section: 'Capitaux propres',
    sourceAccountPrefixes: ['131', '139'],
    deductionPrefixes: [],
    sign: 1,
    parentGroup: 'CP',
    doctrinePage: 32,
    notes: 'Signé selon solde net (131 créditeur = bénéfice, 139 débit = perte).',
  },
  {
    code: 'CL',
    label: "Subventions d'investissement",
    note: '15',
    side: 'PASSIF',
    section: 'Capitaux propres',
    sourceAccountPrefixes: ['141', '142', '148'],
    deductionPrefixes: [],
    sign: 1,
    parentGroup: 'CP',
    doctrinePage: 32,
    notes: 'Solde créditeur (hors quote-part virée 7813). Note 15A.',
  },
  {
    code: 'CM',
    label: 'Provisions réglementées',
    note: '15',
    side: 'PASSIF',
    section: 'Capitaux propres',
    sourceAccountPrefixes: ['151', '152', '153', '154', '155'],
    deductionPrefixes: [],
    sign: 1,
    parentGroup: 'CP',
    doctrinePage: 32,
    notes: 'Solde créditeur. Note 15A.',
  },
  {
    code: 'CP',
    label: 'TOTAL CAPITAUX PROPRES ET RESSOURCES ASSIMILÉES',
    side: 'PASSIF',
    section: '_TOTAL_',
    sourceAccountPrefixes: [],
    deductionPrefixes: [],
    sign: 1,
    parentGroup: 'DF',
    doctrinePage: 32,
    notes: 'Σ CA + CB(−) + CD + CE + CF + CG + CH + CJ + CL + CM.',
  },
  // --- DETTES FINANCIÈRES ---
  {
    code: 'DA',
    label: 'Emprunts et dettes financières diverses',
    note: '16',
    side: 'PASSIF',
    section: 'Dettes financières',
    sourceAccountPrefixes: [
      '161',
      '162',
      '163',
      '164',
      '165',
      '166',
      '167',
      '168',
      '181',
      '182',
      '183',
      '184',
      '185',
    ],
    deductionPrefixes: [],
    sign: 1,
    parentGroup: 'DD',
    doctrinePage: 32,
    notes: 'Solde créditeur (hors intérêts courus). Note 16A.',
  },
  {
    code: 'DB',
    label: 'Dettes de location acquisition',
    note: '16',
    side: 'PASSIF',
    section: 'Dettes financières',
    sourceAccountPrefixes: ['17'],
    deductionPrefixes: [],
    sign: 1,
    parentGroup: 'DD',
    doctrinePage: 32,
    notes: 'Solde créditeur. Note 16B.',
  },
  {
    code: 'DC',
    label: 'Provisions pour risques et charges',
    note: '16',
    side: 'PASSIF',
    section: 'Dettes financières',
    sourceAccountPrefixes: ['191', '192', '193', '194', '195', '196', '197', '198'],
    deductionPrefixes: [],
    sign: 1,
    parentGroup: 'DD',
    doctrinePage: 32,
    notes: 'Solde créditeur. Notes 16C, 28.',
  },
  {
    code: 'DD',
    label: 'TOTAL DETTES FINANCIÈRES ET RESSOURCES ASSIMILÉES',
    side: 'PASSIF',
    section: '_TOTAL_',
    sourceAccountPrefixes: [],
    deductionPrefixes: [],
    sign: 1,
    parentGroup: 'DF',
    doctrinePage: 32,
    notes: 'Σ DA + DB + DC.',
  },
  {
    code: 'DF',
    label: 'TOTAL RESSOURCES STABLES',
    side: 'PASSIF',
    section: '_TOTAL_',
    sourceAccountPrefixes: [],
    deductionPrefixes: [],
    sign: 1,
    parentGroup: 'DZ',
    doctrinePage: 32,
    notes: 'CP + DD.',
  },
  // --- PASSIF CIRCULANT ---
  {
    code: 'DH',
    label: 'Dettes circulantes HAO',
    note: '5',
    side: 'PASSIF',
    section: 'Passif circulant',
    sourceAccountPrefixes: ['481', '482', '484'],
    deductionPrefixes: [],
    sign: 1,
    parentGroup: 'DP',
    doctrinePage: 32,
    notes: 'Solde créditeur. Note 5.',
  },
  {
    code: 'DI',
    label: 'Clients, avances reçues',
    note: '7',
    side: 'PASSIF',
    section: 'Passif circulant',
    // '419' (clients créditeurs) figure aussi en BI (actif) : un solde
    // créditeur (avance reçue) est routé ici au passif par le signe. Le
    // préfixe générique '419' (en plus de 4191/4192) couvre le cas d'un
    // compte 419 tenu sans sous-compte, sinon classé à tort en créance.
    sourceAccountPrefixes: ['4191', '4192', '419'],
    deductionPrefixes: [],
    sign: 1,
    parentGroup: 'DP',
    doctrinePage: 32,
    notes: 'Solde créditeur. Note 7.',
  },
  {
    code: 'DJ',
    label: "Fournisseurs d'exploitation",
    note: '17',
    side: 'PASSIF',
    section: 'Passif circulant',
    sourceAccountPrefixes: ['401', '402', '403', '408'],
    deductionPrefixes: [],
    sign: 1,
    parentGroup: 'DP',
    doctrinePage: 32,
    notes: "Solde créditeur (4081 fournisseurs d'investissement exclus). Note 17.",
  },
  {
    code: 'DK',
    label: 'Dettes fiscales et sociales',
    note: '18',
    side: 'PASSIF',
    section: 'Passif circulant',
    // 421/422/425 (personnel) et 445 (État, TVA récupérable) sont des comptes
    // à DOUBLE SENS : créditeurs = dettes (ici, passif), débiteurs = créances
    // (avances au personnel, TVA déductible → poste actif BJ). On les déclare
    // aussi en SOURCE de BJ pour que classifyToPoste tranche par le signe du
    // solde (cf. comptes courants 462/463/471). Préfixes longueur 3 pour primer
    // sur '42'/'44' génériques et permettre l'arbitrage par netSign.
    sourceAccountPrefixes: ['42', '421', '422', '425', '445', '43', '44'],
    deductionPrefixes: [],
    sign: 1,
    parentGroup: 'DP',
    doctrinePage: 32,
    notes:
      'Solde créditeur de la classe 42 (personnel), 43 (organismes sociaux), 44 (État). Note 18.',
  },
  {
    code: 'DM',
    label: 'Autres dettes',
    note: '19',
    side: 'PASSIF',
    section: 'Passif circulant',
    sourceAccountPrefixes: ['462', '463', '471', '472', '474', '477'],
    deductionPrefixes: [],
    sign: 1,
    parentGroup: 'DP',
    doctrinePage: 32,
    notes: 'Solde créditeur. Note 19.',
  },
  {
    code: 'DN',
    label: 'Provisions pour risques à court terme',
    note: '19',
    side: 'PASSIF',
    section: 'Passif circulant',
    sourceAccountPrefixes: ['499', '599'],
    deductionPrefixes: [],
    sign: 1,
    parentGroup: 'DP',
    doctrinePage: 32,
    notes: 'Solde créditeur. Note 19.',
  },
  {
    code: 'DP',
    label: 'TOTAL PASSIF CIRCULANT',
    side: 'PASSIF',
    section: '_TOTAL_',
    sourceAccountPrefixes: [],
    deductionPrefixes: [],
    sign: 1,
    parentGroup: 'DZ',
    doctrinePage: 32,
    notes: 'Σ DH + DI + DJ + DK + DM + DN.',
  },
  // --- TRÉSORERIE PASSIF ---
  {
    code: 'DQ',
    label: "Banques, crédits d'escompte",
    note: '20',
    side: 'PASSIF',
    section: 'Trésorerie-Passif',
    sourceAccountPrefixes: ['564', '565'],
    deductionPrefixes: [],
    sign: 1,
    parentGroup: 'DT',
    doctrinePage: 32,
    notes: 'Solde créditeur. Note 20.',
  },
  {
    code: 'DR',
    label: 'Banques, établissements financiers et crédits de trésorerie',
    note: '20',
    side: 'PASSIF',
    section: 'Trésorerie-Passif',
    // Les comptes 52/53/54 figurent AUSSI en BS (actif) : un solde
    // créditeur (découvert / concours bancaire) est routé ici au passif
    // par le signe, un solde débiteur reste en BS. La paire de préfixes à
    // longueur égale (BS et DR) déclenche l'arbitrage par signe dans
    // `classifyToPoste` (cf. comptes de tiers 462/463).
    sourceAccountPrefixes: ['52', '53', '54', '561', '562', '563', '566'],
    deductionPrefixes: [],
    sign: 1,
    parentGroup: 'DT',
    doctrinePage: 32,
    notes: 'Solde créditeur — découverts (52/53/54 crédit incl.). Note 20.',
  },
  {
    code: 'DT',
    label: 'TOTAL TRÉSORERIE PASSIF',
    side: 'PASSIF',
    section: '_TOTAL_',
    sourceAccountPrefixes: [],
    deductionPrefixes: [],
    sign: 1,
    parentGroup: 'DZ',
    doctrinePage: 32,
    notes: 'Σ DQ + DR.',
  },
  // --- ÉCART DE CONVERSION & TOTAL GÉNÉRAL ---
  {
    code: 'DV',
    label: 'Écart de conversion — Passif',
    note: '12',
    side: 'PASSIF',
    section: 'Écart de conversion',
    sourceAccountPrefixes: ['479'],
    deductionPrefixes: [],
    sign: 1,
    parentGroup: 'DZ',
    doctrinePage: 32,
    notes: 'Solde créditeur. Note 12.',
  },
  {
    code: 'DZ',
    label: 'TOTAL GÉNÉRAL PASSIF',
    side: 'PASSIF',
    section: '_TOTAL_',
    sourceAccountPrefixes: [],
    deductionPrefixes: [],
    sign: 1,
    doctrinePage: 32,
    notes: 'Σ DF + DP + DT + DV. Doit équilibrer BZ.',
  },
];

/* ========================================================================== */
/* Export                                                                     */
/* ========================================================================== */

/**
 * Référentiel complet des postes lettrés du Bilan SYSCOHADA AUDCIF.
 * Ordre : Actif (AD à BZ) puis Passif (CA à DZ).
 */
export const BILAN_POSTES: readonly BilanPosteRef[] = [...ACTIF_POSTES, ...PASSIF_POSTES];

/** Accès direct par code (utilitaire, pas de logique métier). */
export function getBilanPoste(code: string): BilanPosteRef | undefined {
  return BILAN_POSTES.find((p) => p.code === code);
}
