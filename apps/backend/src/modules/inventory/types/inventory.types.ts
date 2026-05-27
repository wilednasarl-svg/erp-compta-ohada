/**
 * Module 17 — Inventaire & Stock SYSCOHADA.
 *
 * Méthode de valorisation : Coût Moyen Pondéré (CMP), méthode par
 * défaut en SYSCOHADA AUDCIF (PCG OHADA art. 39, AUDCIF art. 18). À la
 * différence de FIFO/LIFO, le CMP recalcule le coût unitaire après
 * chaque entrée :
 *
 *     nouveau_cmp = (qty_courante × cmp_courant + qty_entrée × prix_entrée)
 *                   / (qty_courante + qty_entrée)
 *
 * Les sorties (ventes, consommations) sortent au CMP courant ; elles
 * n'altèrent PAS le CMP — c'est uniquement les entrées qui repondèrent
 * le coût moyen.
 *
 * Comptes SYSCOHADA agités :
 *   - 31x  : Marchandises (stock revente)
 *   - 32x  : Matières premières
 *   - 33x  : Autres approvisionnements
 *   - 34x  : Produits en cours
 *   - 35x  : Services en cours
 *   - 36x  : Produits finis
 *   - 37x  : Stocks en cours de route
 *   - 60x  : Achats (charges au moment de l'entrée si non stockés)
 *   - 70x  : Ventes (produits)
 */

/** Famille de stock SYSCOHADA — détermine le compte racine. */
export type StockFamily =
  | 'marchandises'   // 31x — revente en l'état
  | 'matieres'       // 32x — matières premières
  | 'fournitures'    // 33x — autres approvisionnements
  | 'en_cours'       // 34x/35x — produits/services en cours
  | 'produits_finis' // 36x — fabriqués prêts à vendre
  | 'en_route';      // 37x — en transit non encore réceptionné

export const STOCK_FAMILIES: ReadonlyArray<StockFamily> = [
  'marchandises',
  'matieres',
  'fournitures',
  'en_cours',
  'produits_finis',
  'en_route',
];

/** Direction d'un mouvement de stock. */
export type MovementType =
  /** Entrée chiffrée (achat fournisseur, réception). Repondère le CMP. */
  | 'purchase'
  /** Sortie au CMP courant (vente, consommation interne). */
  | 'sale'
  /** Ajustement manuel (correction comptable). Peut entrer ou sortir. */
  | 'adjustment'
  /** Inventaire physique annuel — fixe la qty au compté physique. */
  | 'inventory_count'
  /** Production : sortie matières + entrée produit fini (wave 2). */
  | 'production';

export const MOVEMENT_TYPES: ReadonlyArray<MovementType> = [
  'purchase',
  'sale',
  'adjustment',
  'inventory_count',
  'production',
];

/** Statut d'un article de stock. */
export type StockItemStatus = 'active' | 'archived';

export const STOCK_ITEM_STATUSES: ReadonlyArray<StockItemStatus> = ['active', 'archived'];

/** Validation regex pour le code interne SKU. */
export const STOCK_ITEM_CODE_PATTERN = /^[A-Z0-9-]{1,32}$/;

/**
 * Méthode de valorisation (W4.2).
 *  - `cmp`  : Coût Moyen Pondéré (défaut SYSCOHADA, méthode historique).
 *  - `fifo` : First In, First Out — queue de lots, sortie au prix du lot
 *            le plus ancien encore disponible. Autorisé par SYSCOHADA
 *            comme alternative pour les biens identifiables au lot.
 */
export type ValuationMethod = 'cmp' | 'fifo';

export const VALUATION_METHODS: ReadonlyArray<ValuationMethod> = ['cmp', 'fifo'];
