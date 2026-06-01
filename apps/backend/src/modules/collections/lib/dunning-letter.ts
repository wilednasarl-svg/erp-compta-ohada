/**
 * Génération pure (sans I/O) du contenu d'une lettre de relance client.
 *
 * Le ton et la formule de clôture dépendent du palier (`DunningLevel`). Le
 * corps liste les factures échues et rappelle le total dû. La mise en forme
 * finale (PDF, email) est du ressort de la couche présentation ; ici on
 * produit un sujet + un corps texte déterministes et testables.
 */

import { dunningLevelLabel, type DunningLevel } from './dunning-rules';

export interface DunningInvoiceLine {
  readonly invoiceNumber: string;
  readonly dueDate: string;
  readonly amount: string;
  readonly overdueDays: number;
}

export interface DunningLetterInput {
  readonly creditorName: string;
  readonly partnerLabel: string;
  readonly referenceDate: string;
  readonly level: DunningLevel;
  readonly invoices: ReadonlyArray<DunningInvoiceLine>;
  readonly totalOverdue: string;
  /** Devise affichée (défaut XOF / FCFA). */
  readonly currency?: string;
}

export interface DunningLetter {
  readonly subject: string;
  readonly body: string;
}

const INTRO: Readonly<Record<DunningLevel, string>> = {
  none: 'Sauf erreur de notre part, votre compte ne présente aucune échéance dépassée à ce jour.',
  reminder:
    'Sauf erreur de notre part, les factures ci-dessous viennent d\'arriver à échéance et restent impayées. Il s\'agit probablement d\'un simple oubli.',
  first:
    'Nous constatons que les factures ci-dessous demeurent impayées malgré leur échéance dépassée. Nous vous remercions de bien vouloir procéder à leur règlement.',
  second:
    'Malgré notre précédente relance, les factures ci-dessous restent à ce jour impayées. Nous vous demandons de régulariser votre situation sans délai.',
  formal_notice:
    'En l\'absence de règlement des factures ci-dessous, et conformément aux dispositions applicables, la présente vaut MISE EN DEMEURE de payer sous huitaine, à défaut de quoi nous engagerons une procédure de recouvrement.',
};

const CLOSING: Readonly<Record<DunningLevel, string>> = {
  none: 'Nous restons à votre disposition pour toute information.',
  reminder: 'Nous vous prions d\'agréer nos salutations distinguées.',
  first: 'Dans l\'attente de votre règlement, nous vous prions d\'agréer nos salutations distinguées.',
  second:
    'Comptant sur une régularisation rapide, nous vous prions d\'agréer nos salutations distinguées.',
  formal_notice: 'Veuillez agréer nos salutations.',
};

/** Construit le sujet et le corps de la lettre de relance. */
export function buildDunningLetter(input: DunningLetterInput): DunningLetter {
  const currency = input.currency ?? 'XOF';
  const levelLabel = dunningLevelLabel(input.level);

  const subject =
    input.level === 'formal_notice'
      ? `Mise en demeure — règlement de factures échues (${input.partnerLabel})`
      : `${levelLabel} — règlement de factures échues (${input.partnerLabel})`;

  const tableLines = input.invoices.map(
    (inv) =>
      `  - Facture ${inv.invoiceNumber} échue le ${inv.dueDate} : ${inv.amount} ${currency}` +
      (inv.overdueDays > 0 ? ` (retard : ${inv.overdueDays} j)` : ''),
  );

  const body = [
    `${input.creditorName}`,
    ``,
    `Le ${input.referenceDate},`,
    ``,
    `À l'attention de ${input.partnerLabel},`,
    ``,
    `Objet : ${subject}`,
    ``,
    INTRO[input.level],
    ``,
    ...tableLines,
    ``,
    `Total dû : ${input.totalOverdue} ${currency}`,
    ``,
    CLOSING[input.level],
    ``,
    input.creditorName,
  ].join('\n');

  return { subject, body };
}
