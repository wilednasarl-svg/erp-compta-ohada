'use client';

import { useQuery } from '@tanstack/react-query';
import { CalendarClock } from 'lucide-react';
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

/**
 * Tranches d'âge, ordonnées du sain (à échoir) au critique (+90 j).
 * `bar` = teinte de la barre de répartition et du repère ; `cell` = couleur du
 * texte dans le tableau quand le montant est non nul. Rampe sémantique OKLCH :
 * vert → bleu → ocre → orange → rouge, pour lire l'ancienneté d'un coup d'œil.
 */
type BucketKey = Exclude<keyof AgingBuckets, 'total'>;
const BUCKETS: ReadonlyArray<{ key: BucketKey; label: string; bar: string; cell: string }> = [
  { key: 'notDue', label: 'À échoir', bar: 'oklch(var(--accent))', cell: 'text-ink-soft' },
  { key: 'd1_30', label: '1-30 j', bar: 'oklch(var(--info))', cell: 'text-info-ink' },
  { key: 'd31_60', label: '31-60 j', bar: 'oklch(var(--warn))', cell: 'text-warn-ink' },
  { key: 'd61_90', label: '61-90 j', bar: 'oklch(58% 0.15 45)', cell: 'text-warn-ink' },
  { key: 'd90plus', label: '+90 j', bar: 'oklch(var(--critical))', cell: 'text-critical-ink' },
  { key: 'noDueDate', label: 'Sans éch.', bar: 'oklch(var(--line-strong))', cell: 'text-ink-mute' },
];

function fmt(amount: string | number): string {
  return new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(amount));
}

/** Montant ; chaîne vide pour zéro (réduit le bruit visuel dans la grille). */
function cellAmount(amount: string): string {
  return Number(amount) === 0 ? '' : fmt(amount);
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
  const hasRows = (report?.partners.length ?? 0) > 0;

  return (
    <AppShell>
      <div className="w-full animate-page-in space-y-10">
        {/* ─── Header ─────────────────────────────────────── */}
        <header>
          <p className="eyebrow mb-2">Tiers</p>
          <h1 className="font-display text-3xl font-medium tracking-tight text-ink">Échéancier</h1>
          <p className="mt-3 max-w-[64ch] text-sm leading-relaxed text-ink-soft">
            Balance âgée des comptes clients et fournisseurs : solde ouvert (non lettré) ventilé par
            tranche d&apos;échéance à une date de référence.
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
              Arrêté au <span className="font-mono text-ink-soft">{report.referenceDate}</span>
            </p>
          )}
        </section>

        {/* ─── Synthèse : répartition de l'encours ──────────── */}
        {hasRows && report !== undefined && <AgingSummary totals={report.totals} />}

        {/* ─── Table ──────────────────────────────────────── */}
        <section className="space-y-5">
          {query.isLoading ? (
            <div className="overflow-hidden rounded-sm border border-line" aria-hidden>
              {Array.from({ length: 6 }).map((_, r) => (
                <div key={r} className="flex items-center gap-4 border-b border-line px-3 py-2.5 last:border-0">
                  <div className="h-3.5 w-16 rounded-xs bg-sunk" />
                  <div className="h-3.5 flex-1 rounded-xs bg-sunk" />
                  <div className="h-3.5 w-20 rounded-xs bg-sunk" />
                  <div className="h-3.5 w-20 rounded-xs bg-sunk" />
                </div>
              ))}
            </div>
          ) : !hasRows ? (
            <div className="rounded-sm border border-line bg-paper px-6 py-12 text-center">
              <CalendarClock className="mx-auto h-6 w-6 text-ink-mute" strokeWidth={1.5} />
              <p className="mt-3 font-display text-base font-medium text-ink">Rien à échéance</p>
              <p className="mx-auto mt-1 max-w-md text-sm text-ink-mute">
                Aucune créance client ni dette fournisseur ouverte (non lettrée) à cette date de
                référence. Ajustez la date ou le type de tiers ci-dessus.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-sm border border-line">
              <table className="w-full text-sm">
                <thead className="bg-sunk text-2xs uppercase tracking-wider text-ink-mute">
                  <tr>
                    <th className="px-3 py-2.5 text-left font-medium">Compte</th>
                    <th className="px-3 py-2.5 text-left font-medium">Tiers</th>
                    {BUCKETS.map((b) => (
                      <th key={b.key} className="px-3 py-2.5 text-right font-medium">
                        <span className="inline-flex items-center justify-end gap-1.5">
                          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: b.bar }} aria-hidden />
                          {b.label}
                        </span>
                      </th>
                    ))}
                    <th className="px-3 py-2.5 text-right font-medium">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {report?.partners.map((p) => (
                    <tr
                      key={p.partnerAccountId}
                      className="border-t border-line transition-colors duration-fast hover:bg-sunk/50"
                    >
                      <td className="px-3 py-2 font-mono text-xs text-ink">{p.partnerAccountCode}</td>
                      <td className="px-3 py-2 text-ink-soft">
                        {p.partnerLabel}
                        <span className="ml-2 text-2xs text-ink-mute">{SIDE_LABEL[p.side]}</span>
                      </td>
                      {BUCKETS.map((b) => {
                        const nonZero = Number(p.buckets[b.key]) !== 0;
                        return (
                          <td
                            key={b.key}
                            className={cn(
                              'px-3 py-2 text-right font-mono text-xs tabular-nums',
                              nonZero ? b.cell : 'text-ink-mute',
                            )}
                          >
                            {cellAmount(p.buckets[b.key])}
                          </td>
                        );
                      })}
                      <td className="px-3 py-2 text-right font-mono text-xs font-medium tabular-nums text-ink">
                        {fmt(p.buckets.total)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                {report !== undefined && (
                  <tfoot>
                    <tr className="border-t-2 border-line-strong bg-sunk/40">
                      <td className="px-3 py-2.5 font-medium text-ink" colSpan={2}>
                        Total
                      </td>
                      {BUCKETS.map((b) => (
                        <td
                          key={b.key}
                          className="px-3 py-2.5 text-right font-mono text-xs font-medium tabular-nums text-ink"
                        >
                          {cellAmount(report.totals[b.key])}
                        </td>
                      ))}
                      <td className="px-3 py-2.5 text-right font-mono text-xs font-semibold tabular-nums text-ink">
                        {fmt(report.totals.total)}
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

/* ─── Synthèse de répartition ────────────────────────────────── */

function AgingSummary({ totals }: { totals: AgingBuckets }) {
  const total = Number(totals.total);
  const overdue =
    Number(totals.d1_30) + Number(totals.d31_60) + Number(totals.d61_90) + Number(totals.d90plus);
  const overduePct = total > 0 ? (overdue / total) * 100 : 0;

  return (
    <section aria-label="Répartition de l'encours" className="rounded-md border border-line bg-paper p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <p className="eyebrow">Encours ouvert</p>
          <p className="num mt-1 text-2xl font-medium tabular-nums text-ink">{fmt(totals.total)}</p>
        </div>
        <p className="text-xs text-ink-mute">
          dont{' '}
          <span className={cn('num font-medium tabular-nums', overdue > 0 ? 'text-critical-ink' : 'text-ink')}>
            {fmt(overdue)}
          </span>{' '}
          en retard · {overduePct.toFixed(0)} %
        </p>
      </div>

      {/* Barre de répartition empilée */}
      <div className="mt-4 flex h-3 w-full overflow-hidden rounded-full bg-sunk" aria-hidden>
        {BUCKETS.map((b) => {
          const w = total > 0 ? (Number(totals[b.key]) / total) * 100 : 0;
          if (w <= 0) return null;
          return (
            <div
              key={b.key}
              style={{ width: `${w}%`, backgroundColor: b.bar }}
              title={`${b.label} : ${fmt(totals[b.key])}`}
            />
          );
        })}
      </div>

      {/* Légende */}
      <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-6">
        {BUCKETS.map((b) => (
          <div key={b.key} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: b.bar }} aria-hidden />
            <div className="min-w-0">
              <p className="truncate text-2xs uppercase tracking-wider text-ink-mute">{b.label}</p>
              <p className="num text-xs font-medium tabular-nums text-ink">{fmt(totals[b.key])}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
