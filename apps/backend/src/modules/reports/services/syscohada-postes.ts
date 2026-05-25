/**
 * Table officielle des postes SYSCOHADA AUDCIF (Système Comptable
 * Révisé OHADA) pour le Compte de Résultat.
 *
 * Source : Guide d'application du SYSCOHADA Révisé, Volume 3
 * « Présentation des états financiers annuels », tableau du Compte de
 * Résultat (postes RA à RS pour les charges, TA à TO pour les produits,
 * XA à XI pour les soldes intermédiaires).
 *
 * Ce mapping projette un code de compte OHADA (préfixe 3 à 5 chiffres)
 * sur son poste officiel. Il sert à produire :
 *   1. les Soldes Intermédiaires de Gestion (SIG)
 *   2. le Compte de Résultat au format officiel (à venir)
 *
 * Convention de signe :
 *   - les comptes de classe 6 contribuent négativement aux soldes
 *     intermédiaires : on lit le solde net = periodDebit − periodCredit
 *     puis on l'utilise tel quel (positif) dans les formules en cascade
 *     en soustrayant. Cf. cascade XA = TA + RA + RB où RA et RB sont
 *     déjà négatifs par convention dans l'affichage.
 *   - les comptes de classe 7 contribuent positivement : net =
 *     periodCredit − periodDebit.
 *
 * Mapping volontairement basé sur des préfixes courts car les plans de
 * comptes Sage importés contiennent souvent des sous-codes propres à
 * l'entité (6011, 60111, 60111000, etc.). Le code le plus long gagne
 * en cas d'ambiguïté grâce à `matchPoste` qui itère du plus spécifique
 * au plus générique.
 */

/** Côté du compte au Compte de Résultat. */
export type PosteSide = 'CHARGE' | 'PRODUIT';

/** Définition d'un poste officiel SYSCOHADA. */
export interface SyscohadaPoste {
  readonly code: string; // 'RA', 'TA', 'XB', etc.
  readonly label: string;
  readonly side: PosteSide;
  /**
   * Préfixes de codes de comptes OHADA qui contribuent à ce poste.
   * Un compte est rattaché au poste dont le préfixe est le plus long
   * parmi ceux qui matchent. Cela évite par exemple que `6031` (RB
   * variation stocks marchandises) soit aspiré par le poste plus
   * générique `60` qui n'existe pas en tant que poste officiel.
   */
  readonly accountPrefixes: readonly string[];
}

/**
 * Charges (classe 6 + classes 8 partielles pour les HAO).
 *
 * NB : Les postes RN (pertes de change) et RP (autres charges HAO)
 * sont laissés volontairement avec des préfixes spécifiques car ils
 * recouvrent partiellement les classes 67 et 83/85. Les comptes mal
 * classés tomberont dans le poste générique de la classe (RM pour 67,
 * RP pour 83-85) — comportement acceptable pour un SIG indicatif.
 */
export const CHARGE_POSTES: ReadonlyArray<SyscohadaPoste> = [
  {
    code: 'RA',
    label: 'Achats de marchandises',
    side: 'CHARGE',
    accountPrefixes: ['601'],
  },
  {
    code: 'RB',
    label: 'Variation de stocks de marchandises',
    side: 'CHARGE',
    accountPrefixes: ['6031'],
  },
  {
    code: 'RC',
    label: 'Achats de matières premières et fournitures liées',
    side: 'CHARGE',
    accountPrefixes: ['602'],
  },
  {
    code: 'RD',
    label: 'Variation de stocks de matières premières et fournitures liées',
    side: 'CHARGE',
    accountPrefixes: ['6032'],
  },
  {
    code: 'RE',
    label: 'Autres achats',
    side: 'CHARGE',
    accountPrefixes: ['604', '605', '608'],
  },
  {
    code: 'RF',
    label: "Variation de stocks d'autres approvisionnements",
    side: 'CHARGE',
    accountPrefixes: ['6033', '6034'],
  },
  {
    code: 'RG',
    label: 'Transports',
    side: 'CHARGE',
    accountPrefixes: ['61'],
  },
  {
    code: 'RH',
    label: 'Services extérieurs',
    side: 'CHARGE',
    accountPrefixes: ['62', '63'],
  },
  {
    code: 'RI',
    label: 'Impôts et taxes',
    side: 'CHARGE',
    accountPrefixes: ['64'],
  },
  {
    code: 'RJ',
    label: 'Autres charges',
    side: 'CHARGE',
    accountPrefixes: ['65'],
  },
  {
    code: 'RK',
    label: 'Charges de personnel',
    side: 'CHARGE',
    accountPrefixes: ['66'],
  },
  {
    code: 'RL',
    label: 'Dotations aux amortissements, provisions et dépréciations',
    side: 'CHARGE',
    accountPrefixes: ['681', '687', '691', '697'],
  },
  {
    code: 'RM',
    label: 'Frais financiers et charges assimilés',
    side: 'CHARGE',
    accountPrefixes: ['67'],
  },
  {
    code: 'RO',
    label: "Valeurs comptables des cessions d'immobilisations",
    side: 'CHARGE',
    accountPrefixes: ['81'],
  },
  {
    code: 'RP',
    label: 'Autres charges hors activités ordinaires',
    side: 'CHARGE',
    accountPrefixes: ['83', '85'],
  },
  {
    code: 'RQ',
    label: 'Participation des travailleurs',
    side: 'CHARGE',
    accountPrefixes: ['87'],
  },
  {
    code: 'RS',
    label: 'Impôts sur le résultat',
    side: 'CHARGE',
    accountPrefixes: ['89'],
  },
] as const;

/**
 * Produits (classe 7 + classes 8 partielles pour les HAO).
 */
export const PRODUIT_POSTES: ReadonlyArray<SyscohadaPoste> = [
  {
    code: 'TA',
    label: 'Ventes de marchandises',
    side: 'PRODUIT',
    accountPrefixes: ['701'],
  },
  {
    code: 'TB',
    label: 'Ventes de produits fabriqués',
    side: 'PRODUIT',
    accountPrefixes: ['702'],
  },
  {
    code: 'TC',
    label: 'Travaux, services vendus',
    side: 'PRODUIT',
    accountPrefixes: ['704', '705', '706'],
  },
  {
    code: 'TD',
    label: 'Produits accessoires',
    side: 'PRODUIT',
    accountPrefixes: ['707'],
  },
  {
    code: 'TE',
    label: "Subventions d'exploitation",
    side: 'PRODUIT',
    accountPrefixes: ['71'],
  },
  {
    code: 'TF',
    label: 'Production immobilisée',
    side: 'PRODUIT',
    accountPrefixes: ['72'],
  },
  {
    code: 'TG',
    label: 'Production stockée (ou destockage)',
    side: 'PRODUIT',
    accountPrefixes: ['73'],
  },
  {
    code: 'TH',
    label: 'Autres produits',
    side: 'PRODUIT',
    accountPrefixes: ['75'],
  },
  {
    code: 'TI',
    label: "Transferts de charges d'exploitation",
    side: 'PRODUIT',
    accountPrefixes: ['781'],
  },
  {
    code: 'TJ',
    label: "Reprises de provisions et de dépréciations d'exploitation",
    side: 'PRODUIT',
    accountPrefixes: ['791', '798'],
  },
  {
    code: 'TK',
    label: 'Revenus financiers et assimilés',
    side: 'PRODUIT',
    accountPrefixes: ['77'],
  },
  {
    code: 'TL',
    label: 'Reprises de provisions et dépréciations financières',
    side: 'PRODUIT',
    accountPrefixes: ['797'],
  },
  {
    code: 'TM',
    label: 'Transferts de charges financières',
    side: 'PRODUIT',
    accountPrefixes: ['787'],
  },
  {
    code: 'TN',
    label: "Produits des cessions d'immobilisations",
    side: 'PRODUIT',
    accountPrefixes: ['82'],
  },
  {
    code: 'TO',
    label: 'Autres produits hors activités ordinaires',
    side: 'PRODUIT',
    accountPrefixes: ['84', '88'],
  },
] as const;

/** Tous les postes (charges + produits) indexés par code. */
export const POSTES_BY_CODE: ReadonlyMap<string, SyscohadaPoste> = new Map(
  [...CHARGE_POSTES, ...PRODUIT_POSTES].map((p) => [p.code, p]),
);

/**
 * Retourne le poste SYSCOHADA auquel se rattache un code de compte, ou
 * `null` si aucun préfixe ne correspond (compte hors P&L : classes 1-5,
 * ou poste non encore mappé). Le préfixe le plus long gagne pour gérer
 * proprement la séparation 601 → RA vs 6031 → RB.
 */
export function matchPoste(accountCode: string): SyscohadaPoste | null {
  let best: { poste: SyscohadaPoste; prefixLen: number } | null = null;
  for (const poste of [...CHARGE_POSTES, ...PRODUIT_POSTES]) {
    for (const prefix of poste.accountPrefixes) {
      if (accountCode.startsWith(prefix)) {
        if (best === null || prefix.length > best.prefixLen) {
          best = { poste, prefixLen: prefix.length };
        }
      }
    }
  }
  return best?.poste ?? null;
}

// ─── Soldes Intermédiaires de Gestion (SIG) ──────────────────────────

/**
 * Référence d'un solde intermédiaire : code XA → XI, libellé officiel
 * et formule littérale (purement informationnelle, pour l'affichage).
 */
export interface SoldeIntermediaireRef {
  readonly code: string;
  readonly label: string;
  readonly formula: string;
}

/**
 * Liste ordonnée des 9 soldes intermédiaires en cascade — l'ordre
 * d'évaluation est celui de l'affichage officiel : XA → XB → XC → XD
 * → XE → XF → XG → XH → XI.
 */
export const SOLDES_INTERMEDIAIRES: ReadonlyArray<SoldeIntermediaireRef> = [
  {
    code: 'XA',
    label: 'Marge commerciale',
    formula: 'TA + RA + RB',
  },
  {
    code: 'XB',
    label: "Chiffre d'affaires",
    formula: 'TA + TB + TC + TD',
  },
  {
    code: 'XC',
    label: 'Valeur ajoutée',
    formula: 'XB + RA + RB + (TE + TF + TG + TH + TI) − (RC + RD + RE + RF + RG + RH + RI + RJ)',
  },
  {
    code: 'XD',
    label: "Excédent brut d'exploitation",
    formula: 'XC + RK',
  },
  {
    code: 'XE',
    label: "Résultat d'exploitation",
    formula: 'XD + TJ + RL',
  },
  {
    code: 'XF',
    label: 'Résultat financier',
    formula: '(TK + TL + TM) − RM',
  },
  {
    code: 'XG',
    label: 'Résultat des activités ordinaires',
    formula: 'XE + XF',
  },
  {
    code: 'XH',
    label: 'Résultat hors activités ordinaires',
    formula: '(TN + TO) − (RO + RP)',
  },
  {
    code: 'XI',
    label: 'Résultat net',
    formula: 'XG + XH − RQ − RS',
  },
] as const;
