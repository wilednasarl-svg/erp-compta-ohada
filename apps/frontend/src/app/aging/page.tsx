'use client';

import { useQuery } from '@tanstack/react-query';
import { CalendarClock, Loader2 } from 'lucide-react';
import { useState } from 'react';

import { AppShell } from '@/components/app-shell';
import { Label } from '@/components/ui/label';
import { ApiError, api } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { useCurrentOrg } from '@/stores/auth-store';

/* ─── Types (miroir backend AgingReport) ─────────────────────── */

type AgingSide = 'client' | 'fournisseur';
type AgingSideFilter = AgingSide | 'all';

interface AgingBuckets {
  readonly notDue: string;
  readonly d1_30: string;
  readonly d31_60: string;
  readonly d61_90: string;
  readonly d90plus: string;
  readonly noDueDate: string;
  readonly total: string;
}

interface AgingPartnerRow {
  readonly partnerAccountId: string;
  readonly partnerAccountCode: string;
  readonly partnerLabel: string;
  readonly side: AgingSide;
  readonly buckets: AgingBuckets;
}

interface AgingReport {
  readonly referenceDate: string;
  readonly side: AgingSideFilter;
  readonly partners: ReadonlyArray<AgingPartnerRow>;
  readonly totals: AgingBuckets;
}

const SIDE_LABEL: Record<AgingSide, string> = {
  client: 'Client',
  fournisseur: 'Fournisseur',
};

const BUCKET_COLUMNS: ReadonlyArray<{ key: keyof AgingBuckets; label: string }> = [
  { key: 'notDue', label: 'À échoir' },
  { key: 'd1_30', label: '1-30 j' },
  { key: 'd31_60', label: '31-60 j' },
  { key: 'd61_90', label: '61-90 j' },
  { key: 'd90plus', label: '+90 j' },
  { key: 'noDueDate', label: 'Sans éch.' },
  { key: 'total', label: 'Total' },
];

function fmt(amount: string): string {
  return new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(amount));
}

/* ─── Page ───────────────────────────────────────────────────── */

export default function AgingPage() {
  const currentOrg = useCurrentOrg();
  const orgId = currentOrg?.id ?? '';

  const [side, setSide] = useState<AgingSideFilter>('all');
  const [referenceDate, setReferenceDate] = useState('');

  const query = useQuery<AgingReport, ApiError>({
    queryKey: ['aging', orgId, side, referenceDate],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (side !== 'all') params.set('side', side);
      if (referenceDate !== '') params.set('referenceDate', referenceDate);
      const qs = params.toString();
      const data = await api.get<{ aging: AgingReport }>(
        `/organizations/${orgId}/aging${qs !== '' ? `?${qs}` : ''}`,
      );
      return data.aging;
    },
    enabled: orgId !== '',
  });

  const report = query.data;

  return (
    <AppShell>
      <div className="w-full animate-page-in space-y-12">
        {/* ─── Header ─────────────────────────────────────── */}
        <header>
          <p className="eyebrow mb-2">Tiers</p>
          <h1 className="font-display text-3xl font-medium tracking-tight text-ink">
            Échéancier
          </h1>
          <p className="mt-3 max-w-[64ch] text-sm leading-relaxed text-ink-soft">
            Balance âgée des comptes clients et fournisseurs : solde ouvert (non lettré)
            ventilé par tranche d&apos;échéance à une date de référence.
          </p>
        </header>

        {/* ─── Controls ───────────────────────────────────── */}
        <section className="flex flex-wrap items-end gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="side">Tiers</Label>
            <select
              id="side"
              className="rounded-sm border border-line-strong bg-paper px-3 py-1.5 text-sm text-ink focus:border-accent focus:outline-none"
              value={side}
              onChange={(e) => setSide(e.target.value as AgingSideFilter)}
            >
              <option value="all">Clients &amp; fournisseurs</option>
              <option value="client">Clients (41x)</option>
              <option value="fournisseur">Fournisseurs (40x)</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ref-date">Date de référence</Label>
            <input
              id="ref-date"
              type="date"
              className="rounded-sm border border-line-strong bg-paper px-3 py-1.5 text-sm text-ink focus:border-accent focus:outline-none"
              value={referenceDate}
              onChange={(e) => setReferenceDate(e.target.value)}
            />
          </div>
          {report !== undefined && (
            <p className="pb-1.5 text-xs text-ink-mute">
              Arrêté au{' '}
              <span className="font-mono text-ink-soft">{report.referenceDate}</span>
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
          ) : (report?.partners.length ?? 0) === 0 ? (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <CalendarClock className="h-6 w-6 text-ink-mute" strokeWidth={1.5} />
              <p className="text-sm text-ink-mute">
                Aucune créance ni dette ouverte à cette date.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-sm border border-line">
              <table className="w-full text-sm">
                <thead className="bg-sunk text-2xs uppercase tracking-wider text-ink-mute">
                  <tr>
                    <th className="px-3 py-2.5 text-left font-medium">Compte</th>
                    <th className="px-3 py-2.5 text-left font-medium">Tiers</th>
                    {BUCKET_COLUMNS.map((c) => (
                      <th key={c.key} className="px-3 py-2.5 text-right font-medium">
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {report?.partners.map((p) => (
                    <tr
                      key={p.partnerAccountId}
                      className="border-t border-line transition-colors duration-fast hover:bg-sunk/50"
                    >
                      <td className="px-3 py-2 font-mono text-xs text-ink">
                        {p.partnerAccountCode}
                      </td>
                      <td className="px-3 py-2 text-ink-soft">
                        {p.partnerLabel}
                        <span className="ml-2 text-2xs text-ink-mute">{SIDE_LABEL[p.side]}</span>
                      </td>
                      {BUCKET_COLUMNS.map((c) => (
                        <td
                          key={c.key}
                          className={cn(
                            'px-3 py-2 text-right font-mono text-xs tabular-nums',
                            c.key === 'total' ? 'font-medium text-ink' : 'text-ink-soft',
                            c.key === 'd90plus' && Number(p.buckets.d90plus) !== 0
                              ? 'text-critical-ink'
                              : '',
                          )}
                        >
                          {fmt(p.buckets[c.key])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
                {report !== undefined && (
                  <tfoot>
                    <tr className="border-t-2 border-line-strong bg-sunk/40">
                      <td className="px-3 py-2.5 font-medium text-ink" colSpan={2}>
                        Total
                      </td>
                      {BUCKET_COLUMNS.map((c) => (
                        <td
                          key={c.key}
                          className="px-3 py-2.5 text-right font-mono text-xs font-medium tabular-nums text-ink"
                        >
                          {fmt(report.totals[c.key])}
                        </td>
                      ))}
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
