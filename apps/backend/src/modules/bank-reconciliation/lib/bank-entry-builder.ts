/**
 * Construction PURE de l'écriture comptable d'une ligne de relevé bancaire
 * non rapprochée (agios, frais, virement reçu non saisi…).
 *
 * Isolé ici pour être testable sans base ni NestJS. Aucune persistance —
 * produit seulement les deux lignes équilibrées, orientées selon le signe du
 * montant du relevé :
 *
 *  - montant < 0 (sortie d'argent : agios, frais, prélèvement) →
 *      D contrepartie (charge 6x) / C banque (521)
 *  - montant > 0 (entrée : intérêts reçus, virement) →
 *      D banque (521) / C contrepartie (produit 7x)
 *
 * Le montant porté est la valeur absolue, arrondie à 2 décimales.
 */

export type BankEntryDirection = 'outflow' | 'inflow';

export interface BankEntryLineDraft {
  readonly accountCode: string;
  readonly debit: number;
  readonly credit: number;
}

export interface BankEntryDraft {
  readonly direction: BankEntryDirection;
  readonly absAmount: number;
  readonly lines: readonly [BankEntryLineDraft, BankEntryLineDraft];
}

export interface BuildBankEntryParams {
  /** Montant signé de la ligne de relevé (string NUMERIC). */
  readonly statementAmount: string;
  /** Code SYSCOHADA du compte banque (52x) rattaché au compte bancaire. */
  readonly bankAccountCode: string;
  /** Code SYSCOHADA du compte de contrepartie choisi (charge/produit). */
  readonly counterpartAccountCode: string;
}

/** Arrondi monétaire à 2 décimales (demi-supérieur sur la valeur absolue). */
function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Produit les deux lignes équilibrées de l'écriture à comptabiliser.
 * Lève si le montant est nul ou non numérique (rien à comptabiliser), ou si
 * les deux comptes sont identiques (écriture sans objet).
 */
export function buildBankEntryLines(params: BuildBankEntryParams): BankEntryDraft {
  const raw = Number(params.statementAmount);
  if (!Number.isFinite(raw) || raw === 0) {
    throw new Error('Montant de relevé nul ou invalide : rien à comptabiliser.');
  }
  if (params.bankAccountCode === params.counterpartAccountCode) {
    throw new Error('Le compte de contrepartie doit différer du compte banque.');
  }

  const absAmount = round2(Math.abs(raw));
  const bank = params.bankAccountCode;
  const counterpart = params.counterpartAccountCode;

  if (raw < 0) {
    // Sortie : on débite la charge, on crédite la banque.
    return {
      direction: 'outflow',
      absAmount,
      lines: [
        { accountCode: counterpart, debit: absAmount, credit: 0 },
        { accountCode: bank, debit: 0, credit: absAmount },
      ],
    };
  }

  // Entrée : on débite la banque, on crédite le produit.
  return {
    direction: 'inflow',
    absAmount,
    lines: [
      { accountCode: bank, debit: absAmount, credit: 0 },
      { accountCode: counterpart, debit: 0, credit: absAmount },
    ],
  };
}
