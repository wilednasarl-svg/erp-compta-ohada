/**
 * Référentiel exhaustif des postes lettrés du TABLEAU DES FLUX DE
 * TRÉSORERIE (TFT) SYSCOHADA AUDCIF — méthode INDIRECTE.
 *
 * Source officielle : Guide d'application du SYSCOHADA Révisé,
 * Volume 3 « Présentation des états financiers annuels », page 34
 * (« Tableau des Flux de Trésorerie »).
 *
 * Nomenclature OFFICIELLE des codes Z (page 34) :
 *   - ZA = Trésorerie nette au 1er janvier (ouverture)
 *   - ZB = Flux de trésorerie provenant des activités opérationnelles
 *          (somme FA à FE)
 *   - ZC = Flux de trésorerie provenant des opérations d'investissement
 *          (somme FF à FJ)
 *   - ZD = Flux de trésorerie provenant des capitaux propres
 *          (somme FK à FN)
 *   - ZE = Flux de trésorerie provenant des capitaux étrangers
 *          (somme FO à FQ)
 *   - ZF = Flux de trésorerie provenant des activités de financement
 *          (= ZD + ZE)
 *   - ZG = Variation de la trésorerie nette de la période
 *          (= ZB + ZC + ZF)
 *   - ZH = Trésorerie nette au 31 décembre (clôture)
 *          (= ZA + ZG)
 *
 * Postes de détail (FA..FQ) :
 *   - FA = Capacité d'Autofinancement Globale (CAFG)
 *   - FB = - Variation de l'actif circulant HAO
 *   - FC = - Variation des stocks
 *   - FD = - Variation des créances et emplois assimilés
 *   - FE = + Variation du passif circulant
 *   - FF = - Décaissements acquisitions d'immobilisations incorporelles
 *   - FG = - Décaissements acquisitions d'immobilisations corporelles
 *   - FH = - Décaissements acquisitions d'immobilisations financières
 *   - FI = + Encaissements cessions immob. incorporelles et corporelles
 *   - FJ = + Encaissements cessions immob. financières
 *   - FK = + Augmentations de capital par apports nouveaux
 *   - FL = + Subventions d'investissement reçues
 *   - FM = - Prélèvements sur le capital
 *   - FN = - Dividendes versés
 *   - FO = + Emprunts nouveaux
 *   - FP = + Autres dettes financières
 *   - FQ = - Remboursements des emprunts et autres dettes
 *
 * Ce fichier est un RÉFÉRENTIEL PUR (données statiques uniquement) ;
 * il est consommé par `cash-flow.service.ts` pour étiqueter les
 * postes calculés, par les exports PDF/XLSX pour le rendu, et par
 * le handler N31 pour la traçabilité.
 */

/** Nature d'un poste TFT. */
export type TftPosteKind =
  | 'OPENING' // ZA — trésorerie d'ouverture
  | 'CLOSING' // ZH — trésorerie de clôture
  | 'SECTION' // sous-total d'une section (ZB, ZC, ZD, ZE)
  | 'POSTE' // poste de détail (FA..FQ)
  | 'SUBTOTAL' // sous-totaux intermédiaires (ZF)
  | 'TOTAL'; // variation totale (ZG)

/** Section éditoriale du TFT (selon doctrine p. 34). */
export type TftSection =
  | 'OUVERTURE'
  | 'OPERATIONNEL'
  | 'INVESTISSEMENT'
  | 'FINANCEMENT_CP'
  | 'FINANCEMENT_CE'
  | 'FINANCEMENT_TOTAL'
  | 'VARIATION'
  | 'CLOTURE';

/** Définition d'un poste lettré du TFT. */
export interface TftPosteRef {
  /** Code lettré officiel (2 lettres). */
  readonly code: string;
  /** Libellé officiel exact (doctrine OHADA Tome 3, page 34). */
  readonly label: string;
  /** Nature du poste (sous-total, poste de détail, ouverture, clôture). */
  readonly kind: TftPosteKind;
  /** Section éditoriale du poste. */
  readonly section: TftSection;
  /** Signe doctrinal du poste (+/−/−/+ pour le libellé CR-style). */
  readonly sign?: '+' | '-' | '-/+';
  /** Formule de calcul (uniquement pour les sous-totaux Z). */
  readonly computationFormula?: string;
  /** Page de référence dans la doctrine. */
  readonly doctrinePage: number;
}

/**
 * Liste exhaustive des 18 postes TFT officiels (8 codes Z + 10 codes F)
 * + variation totale ZG + 5 sous-codes FA-FE, 5 FF-FJ, 4 FK-FN, 3 FO-FQ
 * = 25 entrées au total.
 */
export const TFT_POSTES: readonly TftPosteRef[] = [
  // ── OUVERTURE ─────────────────────────────────────────────────────
  {
    code: 'ZA',
    label: 'Trésorerie nette au 1er janvier',
    kind: 'OPENING',
    section: 'OUVERTURE',
    doctrinePage: 34,
  },

  // ── OPÉRATIONNEL : FA..FE → ZB ────────────────────────────────────
  {
    code: 'FA',
    label: "Capacité d'Autofinancement Globale (CAFG)",
    kind: 'POSTE',
    section: 'OPERATIONNEL',
    sign: '+',
    doctrinePage: 34,
  },
  {
    code: 'FB',
    label: "Variation de l'actif circulant HAO",
    kind: 'POSTE',
    section: 'OPERATIONNEL',
    sign: '-/+',
    doctrinePage: 34,
  },
  {
    code: 'FC',
    label: 'Variation des stocks',
    kind: 'POSTE',
    section: 'OPERATIONNEL',
    sign: '-/+',
    doctrinePage: 34,
  },
  {
    code: 'FD',
    label: 'Variation des créances et emplois assimilés',
    kind: 'POSTE',
    section: 'OPERATIONNEL',
    sign: '-/+',
    doctrinePage: 34,
  },
  {
    code: 'FE',
    label: 'Variation du passif circulant',
    kind: 'POSTE',
    section: 'OPERATIONNEL',
    sign: '-/+',
    doctrinePage: 34,
  },
  {
    code: 'ZB',
    label: 'Flux de trésorerie provenant des activités opérationnelles',
    kind: 'SECTION',
    section: 'OPERATIONNEL',
    computationFormula: 'ZB = FA + FB + FC + FD + FE',
    doctrinePage: 34,
  },

  // ── INVESTISSEMENT : FF..FJ → ZC ──────────────────────────────────
  {
    code: 'FF',
    label: "Décaissements liés aux acquisitions d'immobilisations incorporelles",
    kind: 'POSTE',
    section: 'INVESTISSEMENT',
    sign: '-',
    doctrinePage: 34,
  },
  {
    code: 'FG',
    label: "Décaissements liés aux acquisitions d'immobilisations corporelles",
    kind: 'POSTE',
    section: 'INVESTISSEMENT',
    sign: '-',
    doctrinePage: 34,
  },
  {
    code: 'FH',
    label: "Décaissements liés aux acquisitions d'immobilisations financières",
    kind: 'POSTE',
    section: 'INVESTISSEMENT',
    sign: '-',
    doctrinePage: 34,
  },
  {
    code: 'FI',
    label: "Encaissements liés aux cessions d'immobilisations incorporelles et corporelles",
    kind: 'POSTE',
    section: 'INVESTISSEMENT',
    sign: '+',
    doctrinePage: 34,
  },
  {
    code: 'FJ',
    label: "Encaissements liés aux cessions d'immobilisations financières",
    kind: 'POSTE',
    section: 'INVESTISSEMENT',
    sign: '+',
    doctrinePage: 34,
  },
  {
    code: 'ZC',
    label: "Flux de trésorerie provenant des opérations d'investissement",
    kind: 'SECTION',
    section: 'INVESTISSEMENT',
    computationFormula: 'ZC = FF + FG + FH + FI + FJ',
    doctrinePage: 34,
  },

  // ── FINANCEMENT CAPITAUX PROPRES : FK..FN → ZD ────────────────────
  {
    code: 'FK',
    label: 'Augmentations de capital par apports nouveaux',
    kind: 'POSTE',
    section: 'FINANCEMENT_CP',
    sign: '+',
    doctrinePage: 34,
  },
  {
    code: 'FL',
    label: "Subventions d'investissement reçues",
    kind: 'POSTE',
    section: 'FINANCEMENT_CP',
    sign: '+',
    doctrinePage: 34,
  },
  {
    code: 'FM',
    label: 'Prélèvements sur le capital (y compris retraits exploitant)',
    kind: 'POSTE',
    section: 'FINANCEMENT_CP',
    sign: '-',
    doctrinePage: 34,
  },
  {
    code: 'FN',
    label: 'Dividendes versés',
    kind: 'POSTE',
    section: 'FINANCEMENT_CP',
    sign: '-',
    doctrinePage: 34,
  },
  {
    code: 'ZD',
    label: 'Flux de trésorerie provenant des capitaux propres',
    kind: 'SECTION',
    section: 'FINANCEMENT_CP',
    computationFormula: 'ZD = FK + FL + FM + FN',
    doctrinePage: 34,
  },

  // ── FINANCEMENT CAPITAUX ÉTRANGERS : FO..FQ → ZE ──────────────────
  {
    code: 'FO',
    label: 'Emprunts nouveaux',
    kind: 'POSTE',
    section: 'FINANCEMENT_CE',
    sign: '+',
    doctrinePage: 34,
  },
  {
    code: 'FP',
    label: 'Autres dettes financières',
    kind: 'POSTE',
    section: 'FINANCEMENT_CE',
    sign: '+',
    doctrinePage: 34,
  },
  {
    code: 'FQ',
    label: 'Remboursements des emprunts et autres dettes financières',
    kind: 'POSTE',
    section: 'FINANCEMENT_CE',
    sign: '-',
    doctrinePage: 34,
  },
  {
    code: 'ZE',
    label: 'Flux de trésorerie provenant des capitaux étrangers',
    kind: 'SECTION',
    section: 'FINANCEMENT_CE',
    computationFormula: 'ZE = FO + FP + FQ',
    doctrinePage: 34,
  },

  // ── TOTAL FINANCEMENT : ZF = ZD + ZE ──────────────────────────────
  {
    code: 'ZF',
    label: 'Flux de trésorerie provenant des activités de financement',
    kind: 'SUBTOTAL',
    section: 'FINANCEMENT_TOTAL',
    computationFormula: 'ZF = ZD + ZE',
    doctrinePage: 34,
  },

  // ── VARIATION TOTALE : ZG = ZB + ZC + ZF ──────────────────────────
  {
    code: 'ZG',
    label: 'VARIATION DE LA TRÉSORERIE NETTE DE LA PÉRIODE',
    kind: 'TOTAL',
    section: 'VARIATION',
    computationFormula: 'ZG = ZB + ZC + ZF',
    doctrinePage: 34,
  },

  // ── CLÔTURE : ZH = ZA + ZG ────────────────────────────────────────
  {
    code: 'ZH',
    label: 'Trésorerie nette au 31 décembre',
    kind: 'CLOSING',
    section: 'CLOTURE',
    computationFormula: 'ZH = ZA + ZG',
    doctrinePage: 34,
  },
];

/** Index par code pour lookup O(1). */
const TFT_POSTE_INDEX: ReadonlyMap<string, TftPosteRef> = new Map(
  TFT_POSTES.map((p) => [p.code, p] as const),
);

/** Renvoie le poste TFT par code (ou `undefined` si inconnu). */
export function getTftPoste(code: string): TftPosteRef | undefined {
  return TFT_POSTE_INDEX.get(code);
}

/** Renvoie le libellé doctrinal d'un poste (ou le code si inconnu). */
export function getTftLabel(code: string): string {
  return TFT_POSTE_INDEX.get(code)?.label ?? code;
}

/** Renvoie la liste des codes de détail d'une section donnée. */
export function getTftPostesOfSection(section: TftSection): readonly TftPosteRef[] {
  return TFT_POSTES.filter((p) => p.section === section && p.kind === 'POSTE');
}
