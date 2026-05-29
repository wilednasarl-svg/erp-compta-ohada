'use client';

import { useQuery } from '@tanstack/react-query';
import { Loader2, Percent } from 'lucide-react';
import { useState } from 'react';

import { AppShell } from '@/components/app-shell';
import { Label } from '@/components/ui/label';
import { ApiError, api } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { useCurrentOrg } from '@/stores/auth-store';

/* ─── Types (miroir backend TaxBreakdownReport) ──────────────── */

interface TaxCodeRow {
  readonly taxCode: string;
  readonly totalDebit: string;
  readonly totalCredit: string;
  readonly net: string;
  readonly lineCount: number;
}

interface TaxBreakdownReport {
  readonly from: string;
  readonly to: string;
  readonly codes: ReadonlyArray<TaxCodeRow>;
  readonly totals: {
    readonly totalDebit: string;
    readonly totalCredit: string;
    readonly net: string;
    readonly lineCount: number;
  };
}

function fmt(amount: string): string {
  return new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(amount));
}

/* ─── Page ───────────────────────────────────────────────────── */

export default function TaxBreakdownPage() {
  const currentOrg = useCurrentOrg();
  const orgId = currentOrg?.id ?? '';

  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const query = useQuery<TaxBreakdownReport, ApiError>({
    queryKey: ['tax-breakdown', orgId, from, to],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (from !== '') params.set('from', from);
      if (to !== '') params.set('to', to);
      const qs = params.toString();
      const data = await api.get<{ breakdown: TaxBreakdownReport }>(
        `/organizations/${orgId}/tax-breakdown${qs !== '' ? `?${qs}` : ''}`,
      );
      return data.breakdown;
    },
    enabled: orgId !== '',
  });

  const report = query.data;

  return (
    <AppShell>
      <div className="w-full animate-page-in space-y-12">
        {/* ─── Header ─────────────────────────────────────── */}
        <header>
          <p className="eyebrow mb-2">États</p>
          <h1 className="font-display text-4xl font-medium tracking-tight text-ink">
            Ventilation TVA
          </h1>
          <p className="mt-3 max-w-[64ch] text-sm leading-relaxed text-ink-soft">
            Cumuls débit / crédit / net par code taxe sur une période — recoupement des
            bases et montants déclarés.
          </p>
        </header>

        {/* ─── Controls ───────────────────────────────────── */}
        <section className="flex flex-wrap items-end gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="from">Du</Label>
            <input
              id="from"
              type="date"
              className="rounded-sm border border-line-strong bg-paper px-3 py-1.5 text-sm text-ink focus:border-accent focus:outline-none"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="to">Au</Label>
            <input
              id="to"
              type="date"
              className="rounded-sm border border-line-strong bg-paper px-3 py-1.5 text-sm text-ink focus:border-accent focus:outline-none"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </div>
          {report !== undefined && (
            <p className="pb-1.5 text-xs text-ink-mute">
              Période{' '}
              <span className="font-mono text-ink-soft">
                {report.from} → {report.to}
              </span>
            </p>
          )}
        </section>

        {/* ─── Table ──────────────────────────────────────── */}
        <section className="space-y-5">
          {query.isLoading ? (
            <div className="flex items-center gap-2 py-8 text-sm text-ink-mute">
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.5} />
              Chargement…
            </div>
          ) : (report?.codes.length ?? 0) === 0 ? (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <Percent className="h-6 w-6 text-ink-mute" strokeWidth={1.5} />
              <p className="text-sm text-ink-mute">
                Aucune ligne portant un code taxe sur cette période.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-sm border border-line">
              <table className="w-full text-sm">
                <thead className="bg-sunk text-2xs uppercase tracking-wider text-ink-mute">
                  <tr>
                    <th className="px-3 py-2.5 text-left font-medium">Code taxe</th>
                    <th className="px-3 py-2.5 text-right font-medium">Débit</th>
                    <th className="px-3 py-2.5 text-right font-medium">Crédit</th>
                    <th className="px-3 py-2.5 text-right font-medium">Net</th>
                    <th className="px-3 py-2.5 text-right font-medium">Lignes</th>
                  </tr>
                </thead>
                <tbody>
                  {report?.codes.map((c, i) => (
                    <tr
                      key={c.taxCode}
                      className={cn(
                        'border-t border-line',
                        i % 2 === 1 ? 'bg-sunk/25' : 'bg-paper',
                      )}
                    >
                      <td className="px-3 py-2 font-mono text-xs text-ink">{c.taxCode}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs tabular-nums text-ink-soft">
                        {fmt(c.totalDebit)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs tabular-nums text-ink-soft">
                        {fmt(c.totalCredit)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs font-medium tabular-nums text-ink">
                        {fmt(c.net)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs tabular-nums text-ink-mute">
                        {c.lineCount}
                      </td>
                    </tr>
                  ))}
                </tbody>
                {report !== undefined && (
                  <tfoot>
                    <tr className="border-t-2 border-line-strong bg-sunk/40">
                      <td className="px-3 py-2.5 font-medium text-ink">Total</td>
                      <td className="px-3 py-2.5 text-right font-mono text-xs font-medium tabular-nums text-ink">
                        {fmt(report.totals.totalDebit)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-xs font-medium tabular-nums text-ink">
                        {fmt(report.totals.totalCredit)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-xs font-medium tabular-nums text-ink">
                        {fmt(report.totals.net)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-xs font-medium tabular-nums text-ink">
                        {report.totals.lineCount}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}
        </section>
      </div>
    </AppShell>
  );
}
