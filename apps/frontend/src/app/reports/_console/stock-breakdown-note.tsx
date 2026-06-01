'use client';

/**
 * Panneau « Note 6 — Détail des stocks et en-cours » — extrait de
 * `balance-upload-console.tsx` pour rester sous la limite de 800 lignes.
 *
 * Au bilan SYSCOHADA, les stocks tiennent en une seule ligne « BB — Stocks et
 * en-cours ». Ce panneau en montre la ventilation par famille (comptes 31-38),
 * telle que reconstituée côté backend dans `stockBreakdown`.
 */

export interface StockBreakdownLine {
  readonly label: string;
  readonly prefixes: string;
  readonly amount: string;
}

export interface StockBreakdown {
  readonly lines: ReadonlyArray<StockBreakdownLine>;
  readonly totalBrut: string;
  readonly depreciation: string;
  readonly totalNet: string;
}

const fmt = (amount: string): string => {
  const n = Number(amount);
  if (!Number.isFinite(n)) {
    return amount;
  }
  return n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

export function StockBreakdownNote({ breakdown }: { readonly breakdown: StockBreakdown }) {
  if (breakdown.lines.length === 0) {
    return null;
  }

  return (
    <div className="rounded-sm border border-line bg-paper p-4">
      <p className="eyebrow mb-1 text-ink-mute">Note 6 — Détail des stocks et en-cours</p>
      <p className="mb-3 max-w-[80ch] text-xs text-ink-mute">
        Au bilan SYSCOHADA, les stocks tiennent en une seule ligne « BB — Stocks et en-cours ». Voici
        leur ventilation par famille (annexe Note 6), reconstituée depuis les comptes 31-38 de votre
        balance.
      </p>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs text-ink-mute">
            <th className="py-1.5 font-medium">Famille</th>
            <th className="py-1.5 text-right font-medium">Montant brut</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {breakdown.lines.map((l) => (
            <tr key={l.prefixes}>
              <td className="py-1.5 text-ink">
                {l.label} <span className="font-mono text-xs text-ink-mute">({l.prefixes})</span>
              </td>
              <td className="py-1.5 text-right font-mono tabular-nums text-ink">{fmt(l.amount)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-line">
            <td className="py-1.5 font-medium text-ink">Total brut</td>
            <td className="py-1.5 text-right font-mono tabular-nums text-ink">
              {fmt(breakdown.totalBrut)}
            </td>
          </tr>
          {Number(breakdown.depreciation) > 0 && (
            <tr>
              <td className="py-1 text-ink-soft">− Dépréciations (39)</td>
              <td className="py-1 text-right font-mono tabular-nums text-ink-soft">
                {fmt(breakdown.depreciation)}
              </td>
            </tr>
          )}
          <tr className="border-t border-line-strong">
            <td className="py-1.5 font-medium text-ink">Net — poste BB du bilan</td>
            <td className="py-1.5 text-right font-mono tabular-nums font-medium text-ink">
              {fmt(breakdown.totalNet)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
