import type { NoteHandler, NoteRow } from '../types';

type Movement = Awaited<
  ReturnType<Parameters<NoteHandler>[1]['reports']['accountMovementsBetween']>
>[number];

function amount(s: string): number {
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function dec(n: number): string {
  return n.toFixed(2);
}

function netCredit(row: Movement): number {
  return amount(row.totalCredit) - amount(row.totalDebit);
}

function charge(row: Movement): number {
  return amount(row.totalDebit) - amount(row.totalCredit);
}

function hasPrefix(code: string, prefixes: ReadonlyArray<string>): boolean {
  return prefixes.some((prefix) => code.startsWith(prefix));
}

function noteRow(key: string, label: string, montantN: number, source: string): NoteRow {
  return {
    key,
    label,
    values: {
      montantN: dec(montantN),
      source,
    },
  };
}

export const handleN31RepartitionResultat: NoteHandler = async (ctx, deps) => {
  const movements = await deps.reports.accountMovementsBetween(
    ctx.organizationId,
    ctx.periodStart,
    ctx.periodEnd,
  );

  const resultNet = movements
    .filter((row) => hasPrefix(row.accountCode, ['6', '7', '8']))
    .reduce((sum, row) => sum + netCredit(row), 0);
  const participation = movements
    .filter((row) => hasPrefix(row.accountCode, ['87']))
    .reduce((sum, row) => sum + charge(row), 0);
  const impots = movements
    .filter((row) => hasPrefix(row.accountCode, ['89']))
    .reduce((sum, row) => sum + charge(row), 0);
  const resultBeforeParticipationAndTax = resultNet + participation + impots;

  return {
    applicable: true,
    rows: [
      noteRow(
        'RESULTAT_AVANT_PARTICIPATION_IMPOT',
        'Resultat avant participation et impot',
        resultBeforeParticipationAndTax,
        'classes 6/7/8, hors neutralisation 87 et 89',
      ),
      noteRow('PARTICIPATION_TRAVAILLEURS', 'Participation des travailleurs', participation, '87'),
      noteRow('IMPOTS_RESULTAT', 'Impots sur le resultat', impots, '89'),
      noteRow('RESULTAT_NET', "Resultat net de l'exercice", resultNet, 'classes 6/7/8'),
      noteRow(
        'AFFECTATION_RESULTAT',
        'Affectation du resultat',
        resultNet,
        'decision assemblee ou report a nouveau a documenter en commentaire libre',
      ),
    ],
  };
};
