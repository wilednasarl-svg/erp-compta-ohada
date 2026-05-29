/**
 * W4.6 — Effets de commerce SYSCOHADA (Tome 1 G07, R22-R25, App. 12).
 *
 * Vocabulaire metier :
 *   - `receivable` : effet a recevoir cote client (traite tiree sur un
 *                    client, billet a ordre souscrit par lui).
 *   - `payable`    : effet a payer cote fournisseur (traite acceptee
 *                    par l'entreprise, billet a ordre souscrit).
 *
 * Cycle de vie d'un effet a recevoir :
 *   issued      → emission/acceptation, D 412 / C 411
 *   discounted  → escompte bancaire avant echeance, D 5121 + D 6745 +
 *                 D 6312 / C 415
 *   paid        → encaisse a echeance, D 5121|415 / C 412
 *   unpaid      → impaye, D 4131 / C 412|415
 *   cancelled   → annule manuellement avant tout autre evenement
 *
 * Cycle de vie d'un effet a payer :
 *   issued      → acceptation, D 401 / C 402
 *   paid        → paye a l'echeance, D 402 / C 5121
 *
 * Comptes SYSCOHADA actionnes (constantes ci-dessous, pas en DB pour
 * permettre un ajustement du plan comptable sans migration) :
 *
 *   role                          | compte
 *   ------------------------------+--------
 *   effets a recevoir             | 412
 *   effets escomptes non echus    | 415
 *   effets a payer                | 402
 *   banque                        | 5121
 *   escompte / agio bancaire      | 6745
 *   frais bancaires               | 6312
 *   clients douteux (impaye)      | 4131
 */

export type BillKind = 'receivable' | 'payable';

export type BillStatus = 'issued' | 'discounted' | 'paid' | 'unpaid' | 'cancelled';

export type BillEventType = 'issuance' | 'discount' | 'payment' | 'unpaid_return';

export const BILL_KINDS: ReadonlyArray<BillKind> = ['receivable', 'payable'];

export const BILL_STATUSES: ReadonlyArray<BillStatus> = [
  'issued',
  'discounted',
  'paid',
  'unpaid',
  'cancelled',
];

export const BILL_EVENT_TYPES: ReadonlyArray<BillEventType> = [
  'issuance',
  'discount',
  'payment',
  'unpaid_return',
];

/**
 * Plan comptable SYSCOHADA des effets — figé côté service, jamais en DB.
 */
export const BILL_ACCOUNTS = {
  /** Effets a recevoir (creances commerciales mobilisees). */
  RECEIVABLE_HOLDING: '412',
  /** Effets escomptes non echus — l'effet a quitte le portefeuille. */
  RECEIVABLE_DISCOUNTED: '415',
  /** Effets a payer. */
  PAYABLE_HOLDING: '402',
  /** Banque (compte courant). */
  BANK: '5121',
  /** Escompte bancaire (charge financiere — agio). */
  DISCOUNT_FEE: '6745',
  /** Frais bancaires (services bancaires). */
  BANK_FEE: '6312',
  /** Clients douteux — bascule en cas d'impaye. */
  DOUBTFUL_CUSTOMER: '4131',
} as const;
