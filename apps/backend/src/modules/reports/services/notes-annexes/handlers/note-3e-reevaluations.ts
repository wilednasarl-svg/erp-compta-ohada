/**
 * Note 3E — Informations sur les réévaluations effectuées par l'entité
 * (Tome 3 p. 41).
 *
 * Doctrine : tableau récapitulant les réévaluations libres ou légales
 * portées sur les immobilisations. Les contreparties figurent au passif
 * dans :
 *   - 106 « Écarts de réévaluation » (capitaux propres)
 *   - 152 « Provisions réglementées — provisions pour amortissements
 *     dérogatoires liées à la réévaluation »
 *
 * Le handler agrège les soldes des comptes 106 et 152 par sous-compte à
 * la date de clôture et produit un tableau « catégorie / valeur d'origine
 * / valeur réévaluée / écart » au mieux possible à partir des soldes
 * disponibles. Faute de granularité analytique (les écarts de
 * réévaluation par bien ne sont pas matérialisés), on rend la vue
 * « masse » : un total par sous-compte. Le comptable complète le
 * commentaire libre avec la nature exacte des réévaluations.
 *
 * `applicable` est vrai dès qu'au moins un sous-compte 106 ou 152 a un
 * solde non nul (la réévaluation est rare ⇒ par défaut N/A dans le
 * registry).
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

export const handleN3eReevaluations: NoteHandler = async (ctx, deps) => {
  const balances = await deps.reports.accountBalancesAsAt(
    ctx.organizationId as string,
    ctx.periodEnd,
  );

  const rows: NoteRow[] = [];
  let totalEcart = 0;
  let totalProvDerogatoire = 0;

  for (const b of balances) {
    const isEcart = b.accountCode.startsWith('106');
    const isProvDerog = b.accountCode.startsWith('152');
    if (!isEcart && !isProvDerog) continue;

    const net = num(b.totalCredit) - num(b.totalDebit); // passif ⇒ solde créditeur
    if (Math.abs(net) < 0.005) continue;

    if (isEcart) totalEcart += net;
    if (isProvDerog) totalProvDerogatoire += net;

    rows.push({
      key: b.accountCode,
      label: `${b.accountCode} — ${b.accountLabel}`,
      values: {
        ecartReevaluation: isEcart ? fmt(net) : '0.00',
        provisionReglementee: isProvDerog ? fmt(net) : '0.00',
        total: fmt(net),
      },
    });
  }

  if (rows.length > 0) {
    rows.push({
      key: 'TOTAL',
      label: 'TOTAL réévaluations',
      values: {
        ecartReevaluation: fmt(totalEcart),
        provisionReglementee: fmt(totalProvDerogatoire),
        total: fmt(totalEcart + totalProvDerogatoire),
      },
    });
  }

  return { rows, applicable: rows.length > 0 };
};
