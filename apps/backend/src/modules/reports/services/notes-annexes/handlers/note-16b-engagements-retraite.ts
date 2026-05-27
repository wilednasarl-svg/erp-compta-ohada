/**
 * Note 16B — Engagements de retraite et avantages assimilés
 * (méthode actuarielle) — Tome 3 p. 52.
 *
 * Doctrine SYSCOHADA : présentation des engagements pour pensions,
 * indemnités de fin de carrière (IFC), médailles du travail et autres
 * avantages postérieurs à l'emploi. Idéalement évalués par un actuaire
 * (IAS 19 / IFC pré-OHADA) puis comptabilisés en provision (compte
 * 196 « Provisions pour pensions et obligations similaires »).
 *
 * Source de données :
 *   - Provision comptabilisée : solde créditeur du compte 196 à la
 *     clôture.
 *   - Engagement hors-bilan : non matérialisé dans le PGC ⇒ laissé au
 *     commentaire libre (TODO : entité dédiée si moteur actuariel
 *     livré dans une wave ultérieure).
 *
 * Le handler ne livre que la provision comptabilisée. Si la provision
 * est nulle, la note reste applicable (case texte libre) mais sans
 * ligne — le comptable précise la nature des engagements et leur
 * méthode d'évaluation. Cf. follow-up B5 : entité `actuarial_commitments`.
 */
import type { NoteHandler, NoteRow } from '../types';

function num(s: string | null | undefined): number {
  if (!s) return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function fmt(n: number): string {
  return n.toFixed(2);
}

export const handleN16bEngagementsRetraite: NoteHandler = async (ctx, deps) => {
  const balances = await deps.reports.accountBalancesAsAt(
    ctx.organizationId as string,
    ctx.periodEnd,
  );

  const rows: NoteRow[] = [];
  let totalProvision = 0;

  for (const b of balances) {
    if (!b.accountCode.startsWith('196')) continue;
    const net = num(b.totalCredit) - num(b.totalDebit); // provision ⇒ créditeur
    if (Math.abs(net) < 0.005) continue;
    totalProvision += net;
    rows.push({
      key: b.accountCode,
      label: `${b.accountCode} — ${b.accountLabel}`,
      values: {
        engagementBrut: fmt(net),
        provisionComptabilisee: fmt(net),
        ecartNonProvisionne: '0.00',
      },
    });
  }

  if (rows.length > 0) {
    rows.push({
      key: 'TOTAL',
      label: 'TOTAL provisions retraites et avantages assimilés',
      values: {
        engagementBrut: fmt(totalProvision),
        provisionComptabilisee: fmt(totalProvision),
        ecartNonProvisionne: '0.00',
      },
    });
  }

  // Applicable=true par défaut (commentaire libre) — la note reste dans
  // la liasse même si aucune provision n'a été comptabilisée pour
  // permettre la déclaration "néant" doctrinale.
  return { rows, applicable: true };
};
