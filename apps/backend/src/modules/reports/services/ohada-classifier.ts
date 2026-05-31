/**
 * OHADA SYSCOHADA AUDCIF chart-of-accounts classifier — Module 9 wave 2.
 *
 * The OHADA chart organises accounts into 9 top-level classes:
 *
 *   1 — Comptes de ressources durables (capital, réserves, emprunts)
 *   2 — Comptes d'actif immobilisé (incorporel, corporel, financier)
 *   3 — Comptes de stocks
 *   4 — Comptes de tiers (clients, fournisseurs, État, personnel)
 *   5 — Comptes de trésorerie (banques, caisse, instruments)
 *   6 — Comptes de charges
 *   7 — Comptes de produits
 *   8 — Comptes des autres charges et produits (HAO)
 *   9 — Comptes analytiques
 *
 * For wave 2 reports we only need 1-7. Classes 6 & 7 feed the Compte de
 * Résultat (P&L); classes 1-5 feed the Bilan (balance sheet).
 *
 * The mapping below uses the 2-digit `code` prefix (e.g. '60', '70') as
 * the section key. This is the canonical SYSCOHADA AUDCIF grouping
 * granularity used in regulatory templates published by OHADA.
 */

export interface OhadaSectionLabel {
  readonly code: string;
  readonly label: string;
}

/** P&L expense sections (classe 6). */
export const PL_CHARGE_SECTIONS: ReadonlyArray<OhadaSectionLabel> = [
  { code: '60', label: 'Achats et variations de stocks' },
  { code: '61', label: 'Transports' },
  { code: '62', label: 'Services extérieurs A' },
  { code: '63', label: 'Services extérieurs B' },
  { code: '64', label: 'Impôts et taxes' },
  { code: '65', label: 'Autres charges' },
  { code: '66', label: 'Charges de personnel' },
  { code: '67', label: 'Frais financiers et charges assimilées' },
  { code: '68', label: 'Dotations aux amortissements et provisions' },
  { code: '69', label: 'Impôts sur le résultat' },
] as const;

/** P&L revenue sections (classe 7). */
export const PL_PRODUIT_SECTIONS: ReadonlyArray<OhadaSectionLabel> = [
  { code: '70', label: 'Ventes' },
  { code: '71', label: "Subventions d'exploitation" },
  { code: '72', label: 'Production immobilisée' },
  { code: '73', label: 'Variations des stocks de biens et services produits' },
  { code: '75', label: 'Autres produits' },
  { code: '77', label: 'Revenus financiers et assimilés' },
  { code: '78', label: 'Transferts de charges' },
  { code: '79', label: 'Reprises de provisions' },
] as const;

/** Balance-sheet asset sections. */
export type BalanceSheetActifKey = 'IMMOBILISE' | 'CIRCULANT' | 'TRESORERIE_ACTIF';

/** Balance-sheet liability + equity sections. */
export type BalanceSheetPassifKey =
  | 'CAPITAUX_PROPRES'
  | 'DETTES_FINANCIERES'
  | 'PASSIF_CIRCULANT'
  | 'TRESORERIE_PASSIF';

/**
 * Result of `classifyForBilan` :
 *   - `side` / `key` : section cible au Bilan.
 *   - `contraSign`  : `+1` (le solde s'ajoute au total de section,
 *                    cas standard) ou `-1` (le solde vient EN
 *                    DÉDUCTION du total de section, cas des comptes
 *                    opposants — Tome 1 OHADA G02).
 *
 * Le caller doit toujours pousser le **montant absolu** dans le
 * groupe et multiplier par `contraSign` lors du calcul du total de
 * section. Cela préserve l'affichage par compte (le client veut voir
 * "Dépréciation client 4912 : 50 000") tout en garantissant que le
 * total de section est arithmétiquement correct.
 */
export interface BilanClassification {
  readonly side: 'ACTIF' | 'PASSIF';
  readonly key: BalanceSheetActifKey | BalanceSheetPassifKey;
  readonly contraSign: 1 | -1;
}

/**
 * Classify an account into a balance-sheet section based on its
 * 2-digit code prefix and the natural side of its ending balance.
 *
 * Convention:
 *   - Classes 2 → Actif immobilisé.
 *   - Classes 3, 4, 5 are dual-sided: a debit balance on a 4xx is a
 *     receivable (Actif circulant); a credit balance on the same 4xx
 *     is a payable (Passif circulant). The classifier uses `netSign`
 *     ('D' or 'C') to pick the right column.
 *   - Class 1 → Passif (capitaux propres / dettes financières).
 *
 * `isOpposing` (Tome 1 OHADA G02) : pour les comptes au sens normal
 * opposé à leur classe (29x/39x/49x/59x, 109, 121, 129, 409), on
 * **inverse `netSign`** avant le choix de section et on renvoie
 * `contraSign = -1`. Exemple : une dépréciation 4912 avec solde
 * créditeur (`netSign = 'C'`) est traitée comme un compte de classe 4
 * débiteur (donc Actif circulant) mais retournée avec
 * `contraSign = -1` pour venir en déduction du poste actif.
 *
 * Returns `null` for accounts that don't belong to a balance-sheet
 * line (typically classes 6, 7, 8, 9 — those go to the P&L).
 */
export function classifyForBilan(
  accountCode: string,
  accountClass: number,
  netSign: 'D' | 'C' | 'Z',
  isOpposing = false,
): BilanClassification | null {
  if (accountClass < 1 || accountClass > 5) {
    return null;
  }

  // Pour un compte opposant, on raisonne section comme si le solde
  // était sur le sens "naturel" de la classe parente : on inverse
  // donc netSign avant la classification ; le `contraSign = -1`
  // ressort plus bas pour soustraire au total de section.
  const effectiveSign: 'D' | 'C' | 'Z' = isOpposing
    ? netSign === 'D'
      ? 'C'
      : netSign === 'C'
        ? 'D'
        : 'Z'
    : netSign;
  const contraSign: 1 | -1 = isOpposing ? -1 : 1;

  const prefix2 = accountCode.slice(0, 2);

  if (accountClass === 2) {
    return { side: 'ACTIF', key: 'IMMOBILISE', contraSign };
  }

  if (accountClass === 1) {
    // 10-15: capitaux propres ; 16-19: dettes financières.
    const n = Number.parseInt(prefix2, 10);
    if (Number.isFinite(n) && n >= 16) {
      return { side: 'PASSIF', key: 'DETTES_FINANCIERES', contraSign };
    }
    return { side: 'PASSIF', key: 'CAPITAUX_PROPRES', contraSign };
  }

  if (accountClass === 3) {
    // Stocks → Actif circulant.
    return { side: 'ACTIF', key: 'CIRCULANT', contraSign };
  }

  if (accountClass === 4) {
    // Tiers : la position dépend du signe (effectif après opposant).
    if (effectiveSign === 'D') {
      return { side: 'ACTIF', key: 'CIRCULANT', contraSign };
    }
    return { side: 'PASSIF', key: 'PASSIF_CIRCULANT', contraSign };
  }

  // Class 5 — trésorerie.
  if (effectiveSign === 'D') {
    return { side: 'ACTIF', key: 'TRESORERIE_ACTIF', contraSign };
  }
  return { side: 'PASSIF', key: 'TRESORERIE_PASSIF', contraSign };
}

export const ACTIF_SECTION_LABELS: Record<BalanceSheetActifKey, string> = {
  IMMOBILISE: 'Actif immobilisé',
  CIRCULANT: 'Actif circulant',
  TRESORERIE_ACTIF: 'Trésorerie — Actif',
};

export const PASSIF_SECTION_LABELS: Record<BalanceSheetPassifKey, string> = {
  CAPITAUX_PROPRES: 'Capitaux propres',
  DETTES_FINANCIERES: 'Dettes financières',
  PASSIF_CIRCULANT: 'Passif circulant',
  TRESORERIE_PASSIF: 'Trésorerie — Passif',
};

// ─── W2.1 — 35 postes lettrés SYSCOHADA Révisé (AD…BZ, CA…DZ) ──────────
//
// Mapping fin (compte → poste lettré). Itère sur le référentiel
// BILAN_POSTES et choisit le préfixe de compte LE PLUS LONG qui matche
// dans `sourceAccountPrefixes` (contribution brute) ou `deductionPrefixes`
// (contribution en déduction — typique des amortissements 28x/29x et des
// comptes opposants 49x/59x).
//
// Convention pour la disposition Actif/Passif :
//   - Un poste « ACTIF » avec match dans `deductionPrefixes` → la
//     contribution est SOUSTRAITE du brut du poste (cas standard amort.).
//   - Pour un compte marqué `isOpposing = true` (cf. Tome 1 G02), on
//     considère qu'il est déjà reclassé doctrinairement comme « contre-
//     partie » du poste source ; on force donc `asDeduction = true`
//     même s'il a matché un `sourceAccountPrefixes` (rare).
//
// Postes sans `sourceAccountPrefixes` (sous-totaux _TOTAL_ : AZ, BG, BK,
// BT, BZ, CP, DD, DF, DP, DT, DZ) ne sont jamais retournés ici : ils
// sont calculés par sommation lors de l'agrégation.

import { BILAN_POSTES, type BilanPosteRef, type BilanSide } from './postes/bilan-postes';

export interface BilanPosteClassification {
  /** Code lettré officiel (ex. 'AE', 'BJ', 'DD'). */
  readonly posteCode: string;
  /** Côté du bilan. */
  readonly side: BilanSide;
  /**
   * `true` lorsque le montant doit venir EN DÉDUCTION du brut du poste
   * (amortissements 28x/29x, dépréciations 39x/49x/59x, compte opposant
   * Tome 1 G02). `false` pour une contribution standard.
   */
  readonly asDeduction: boolean;
}

/** Marqueur retourné pour les comptes sans poste lettré matché. */
export const UNCLASSIFIED_POSTE = '_UNCLASSIFIED_';

/**
 * Identifie le poste lettré du Bilan AUDCIF qui doit absorber le solde
 * d'un compte donné. Retourne `null` si le compte n'appartient pas au
 * Bilan (classes 6/7/8/9 → vont au compte de résultat).
 *
 * L'algorithme :
 *   1. Pour chaque poste de `BILAN_POSTES` (postes feuilles uniquement,
 *      pas les sous-totaux `_TOTAL_`), trouve le préfixe le plus long
 *      dans `sourceAccountPrefixes` qui matche `accountCode` et garde
 *      en mémoire le meilleur match brut.
 *   2. Idem pour `deductionPrefixes` (le meilleur match déduction).
 *   3. On choisit le match avec le préfixe LE PLUS LONG (toutes
 *      catégories confondues). En cas d'égalité de longueur, on
 *      privilégie le match en déduction (logique : 2811 est plus
 *      spécifique pour un amort. que 21 pour l'incorporel parent).
 *   4. Si aucun match → retourne `null` (le caller décide de
 *      bucketer en `UNCLASSIFIED_POSTE` ou ignorer).
 *   5. Si `isOpposing = true`, force `asDeduction = true`.
 */
export function classifyToPoste(
  accountCode: string,
  isOpposing = false,
  netSign?: 'D' | 'C',
): BilanPosteClassification | null {
  if (!accountCode || accountCode.length === 0) return null;

  // Collecte de TOUS les préfixes qui matchent, avec leur longueur et leur
  // nature (source/déduction). Certains comptes de tiers (462, 463, 471…)
  // figurent à la fois dans un poste ACTIF (créance) et un poste PASSIF
  // (dette) : à longueur de préfixe égale, on tranche selon le SIGNE du
  // solde (débiteur → actif, créditeur → passif) plutôt que l'ordre du
  // référentiel — sinon un compte d'associé créditeur (dette) serait classé
  // en créance et déséquilibrerait le bilan.
  type Match = { poste: BilanPosteRef; len: number; isDeduction: boolean };
  const matches: Match[] = [];
  for (const poste of BILAN_POSTES) {
    if (poste.section === '_TOTAL_') continue;
    for (const prefix of poste.sourceAccountPrefixes) {
      if (accountCode.startsWith(prefix)) {
        matches.push({ poste, len: prefix.length, isDeduction: false });
      }
    }
    for (const prefix of poste.deductionPrefixes) {
      if (accountCode.startsWith(prefix)) {
        matches.push({ poste, len: prefix.length, isDeduction: true });
      }
    }
  }

  if (matches.length === 0) return null;

  const maxLen = Math.max(...matches.map((m) => m.len));
  const top = matches.filter((m) => m.len === maxLen);

  // Priorité 1 — la DÉDUCTION l'emporte toujours à longueur égale (note 3) :
  // amortissements/dépréciations restent en déduction de l'actif, même
  // créditeurs (ne JAMAIS les router au passif par leur signe).
  // Priorité 2 — comptes de tiers à double appartenance (un poste actif ET
  // un poste passif en SOURCE) : on tranche par le signe du solde
  // (débiteur → créance/actif, créditeur → dette/passif).
  // Priorité 3 — premier match (ordre du référentiel).
  // NB : parmi les déductions à longueur égale, on retient la DERNIÈRE —
  // équivalent au `>=` de l'implémentation historique : un sous-poste plus
  // spécifique (ex. AE frais de dév.) déclaré après le poste générique
  // (AD incorporel) doit l'emporter pour la même clé d'amortissement 2811.
  const deductionMatch = [...top].reverse().find((m) => m.isDeduction);
  let chosen: Match;
  if (deductionMatch !== undefined) {
    chosen = deductionMatch;
  } else if (netSign !== undefined && top.length > 1) {
    const wantSide = netSign === 'D' ? 'ACTIF' : 'PASSIF';
    chosen = top.find((m) => m.poste.side === wantSide) ?? top[0];
  } else {
    chosen = top[0];
  }

  return {
    posteCode: chosen.poste.code,
    side: chosen.poste.side,
    asDeduction: chosen.isDeduction || isOpposing,
  };
}
