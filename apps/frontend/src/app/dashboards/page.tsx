'use client';

import { useQuery } from '@tanstack/react-query';
import {
  ArrowDown,
  ArrowUp,
  Banknote,
  Coins,
  Loader2,
  Minus,
  TrendingUp,
  Users,
} from 'lucide-react';
import { useMemo, useState } from 'react';

import { AppShell } from '@/components/app-shell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { FormError } from '@/components/ui/form-error';
import { Label } from '@/components/ui/label';
import { ApiError, api } from '@/lib/api-client';
import { useCurrentOrg } from '@/stores/auth-store';
import type { AccountingPeriodView } from '@/types/journals';
import {
  AGING_BUCKETS,
  AGING_BUCKET_LABELS,
  type AgingType,
  type DashboardAging,
  type DashboardSummary,
} from '@/types/dashboards';

interface PeriodsResponse {
  readonly periods: ReadonlyArray<AccountingPeriodView>;
}

/**
 * `/dashboards` — Module 19 wave 1 : overview KPIs + balance âgée.
 *
 * UX :
 *   1. Sélecteur d'exercice en haut (seulement les racines annuelles).
 *   2. Summary : 4 KPI cards (cash, AR, AP, résultat net) + 2 ratios
 *      en mini-indicateurs + breakdown par classe OHADA (table + barres
 *      proportionnelles inline).
 *   3. Aging : toggle clients/fournisseurs + barres par bucket + table
 *      par partenaire triée desc.
 *
 * Pas de lib charts externe en wave 1 — barres CSS pures (div width %).
 * Recharts arrivera quand le brief le demandera (ou en wave 2).
 */
export default function DashboardsPage() {
  const currentOrg = useCurrentOrg();
  const orgId = currentOrg?.id ?? '';

  // ─── Sélecteur d'exercice ───────────────────────────────────────────
  const periodsQuery = useQuery<ReadonlyArray<AccountingPeriodView>, ApiError>({
    queryKey: ['accounting-periods', orgId],
    queryFn: async () => {
      const data = await api.get<PeriodsResponse>(
        `/organizations/${orgId}/accounting-periods`,
      );
      return data.periods;
    },
    enabled: orgId !== '',
  });

  const annualPeriods = useMemo(
    () =>
      (periodsQuery.data ?? [])
        .filter((p) => p.parentId === null)
        .sort((a, b) => b.startDate.localeCompare(a.startDate)),
    [periodsQuery.data],
  );

  const [selectedExerciseId, setSelectedExerciseId] = useState<string | null>(null);

  // Auto-select latest open exercise when periods load.
  const effectiveExerciseId =
    selectedExerciseId ??
    annualPeriods.find((p) => p.status === 'open')?.id ??
    annualPeriods[0]?.id ??
    null;

  return (
    <AppShell>
      <div className="space-y-6">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboards</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Vue synthétique de la santé comptable : trésorerie, créances, dettes, résultat
            YTD, balance âgée des tiers.
          </p>
        </header>

        <Card>
          <CardHeader>
            <CardTitle>Exercice</CardTitle>
            <CardDescription>
              Les KPIs et l&apos;aging sont scoped sur cet exercice fiscal.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {periodsQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">Chargement…</p>
            ) : annualPeriods.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Aucun exercice créé.{' '}
                <a className="underline" href="/accounting-periods">
                  Créer un exercice
                </a>{' '}
                d&apos;abord.
              </p>
            ) : (
              <div className="space-y-1">
                <Label htmlFor="exercise">Exercice fiscal</Label>
                <select
                  id="exercise"
                  value={effectiveExerciseId ?? ''}
                  onChange={(e) => setSelectedExerciseId(e.target.value)}
                  className="flex h-9 w-full max-w-md rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                >
                  {annualPeriods.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label} ({p.startDate} → {p.endDate}) ·{' '}
                      {p.status === 'open' ? 'Ouvert' : 'Fermé'}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <FormError error={periodsQuery.error} className="mt-3" />
          </CardContent>
        </Card>

        {effectiveExerciseId && (
          <>
            <SummarySection orgId={orgId} exerciseId={effectiveExerciseId} />
            <AgingSection orgId={orgId} exerciseId={effectiveExerciseId} />
          </>
        )}
      </div>
    </AppShell>
  );
}

// ─────────────────────────────────────────────────────────────────────
// SUMMARY
// ─────────────────────────────────────────────────────────────────────

function SummarySection({ orgId, exerciseId }: { orgId: string; exerciseId: string }) {
  const summaryQuery = useQuery<{ summary: DashboardSummary }, ApiError>({
    queryKey: ['dashboard-summary', orgId, exerciseId],
    queryFn: async () =>
      api.get(`/organizations/${orgId}/dashboards/summary?exerciseId=${exerciseId}`),
  });

  if (summaryQuery.isLoading) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-muted-foreground">
          <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
          Chargement du summary…
        </CardContent>
      </Card>
    );
  }

  if (summaryQuery.error) {
    return (
      <Card>
        <CardContent className="py-6">
          <FormError error={summaryQuery.error} />
        </CardContent>
      </Card>
    );
  }

  const s = summaryQuery.data?.summary;
  if (!s) return null;

  return (
    <>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Trésorerie"
          value={s.cashBalance}
          currency={s.currency}
          icon={Banknote}
          tone="positive"
        />
        <KpiCard
          label="Créances clients"
          value={s.receivables}
          currency={s.currency}
          icon={Users}
          tone="neutral"
        />
        <KpiCard
          label="Dettes fournisseurs"
          value={s.payables}
          currency={s.currency}
          icon={Coins}
          tone="neutral"
        />
        <KpiCard
          label="Résultat YTD"
          value={s.netResultYtd}
          currency={s.currency}
          icon={TrendingUp}
          tone="signed"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Produits / Charges YTD</CardTitle>
            <CardDescription>
              Période {s.periodStart} → {s.periodEnd}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Row label="Produits" value={s.revenueYtd} currency={s.currency} tone="positive" />
            <Row label="Charges" value={s.expensesYtd} currency={s.currency} tone="negative" />
            <div className="border-t pt-2">
              <Row
                label="Résultat net"
                value={s.netResultYtd}
                currency={s.currency}
                tone="signed"
                bold
              />
            </div>
            <div className="grid grid-cols-2 gap-3 pt-2">
              <RatioCard
                label="Marge brute"
                value={s.grossMarginRatio}
                format="percent"
              />
              <RatioCard label="Liquidité" value={s.liquidityRatio} format="multiple" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Répartition par classe OHADA</CardTitle>
            <CardDescription>Mouvements de l&apos;exercice (signed net)</CardDescription>
          </CardHeader>
          <CardContent>
            {s.accountClassBreakdown.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Aucune écriture validée sur cet exercice.
              </p>
            ) : (
              <ClassBreakdownChart breakdown={s.accountClassBreakdown} />
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

interface KpiCardProps {
  readonly label: string;
  readonly value: string;
  readonly currency: string;
  readonly icon: React.ComponentType<{ className?: string }>;
  readonly tone: 'positive' | 'negative' | 'neutral' | 'signed';
}

function KpiCard({ label, value, currency, icon: Icon, tone }: KpiCardProps) {
  const num = Number(value);
  const color =
    tone === 'positive'
      ? 'text-emerald-700'
      : tone === 'negative'
        ? 'text-destructive'
        : tone === 'signed'
          ? num >= 0
            ? 'text-emerald-700'
            : 'text-destructive'
          : 'text-foreground';
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>{label}</span>
          <Icon className="h-4 w-4" />
        </div>
        <div className={`mt-2 font-mono text-2xl font-semibold ${color}`}>
          {formatAmount(num)}
        </div>
        <div className="text-xs text-muted-foreground">{currency}</div>
      </CardContent>
    </Card>
  );
}

function Row({
  label,
  value,
  currency,
  tone,
  bold,
}: {
  label: string;
  value: string;
  currency: string;
  tone: 'positive' | 'negative' | 'neutral' | 'signed';
  bold?: boolean;
}) {
  const num = Number(value);
  const color =
    tone === 'positive'
      ? 'text-emerald-700'
      : tone === 'negative'
        ? 'text-destructive'
        : tone === 'signed'
          ? num >= 0
            ? 'text-emerald-700'
            : 'text-destructive'
          : 'text-foreground';
  return (
    <div className="flex items-baseline justify-between text-sm">
      <span className={bold ? 'font-medium' : 'text-muted-foreground'}>{label}</span>
      <span className={`font-mono ${color} ${bold ? 'font-semibold' : ''}`}>
        {formatAmount(num)} <span className="text-xs">{currency}</span>
      </span>
    </div>
  );
}

function RatioCard({
  label,
  value,
  format,
}: {
  label: string;
  value: number | null;
  format: 'percent' | 'multiple';
}) {
  return (
    <div className="rounded-md border bg-muted/30 px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-mono text-sm font-medium">
        {value === null ? (
          <span className="text-muted-foreground">N/A</span>
        ) : format === 'percent' ? (
          `${(value * 100).toFixed(1)} %`
        ) : (
          `${value.toFixed(2)}x`
        )}
      </div>
    </div>
  );
}

function ClassBreakdownChart({
  breakdown,
}: {
  breakdown: ReadonlyArray<{
    accountClass: number;
    label: string;
    net: string;
  }>;
}) {
  // Échelle : valeur abs max pour proportionner les barres.
  const maxAbs = Math.max(...breakdown.map((b) => Math.abs(Number(b.net))), 1);

  return (
    <ul className="space-y-2 text-sm">
      {breakdown.map((b) => {
        const num = Number(b.net);
        const pct = (Math.abs(num) / maxAbs) * 100;
        const positive = num >= 0;
        return (
          <li key={b.accountClass} className="space-y-1">
            <div className="flex items-baseline justify-between">
              <span>
                <span className="font-mono text-xs text-muted-foreground">
                  Cl.{b.accountClass}
                </span>{' '}
                {b.label}
              </span>
              <span
                className={`font-mono text-xs ${
                  positive ? 'text-emerald-700' : 'text-destructive'
                }`}
              >
                {positive ? '+' : ''}
                {formatAmount(num)}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className={positive ? 'h-full bg-emerald-500' : 'h-full bg-destructive'}
                style={{ width: `${pct}%` }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// ─────────────────────────────────────────────────────────────────────
// AGING
// ─────────────────────────────────────────────────────────────────────

function AgingSection({ orgId, exerciseId }: { orgId: string; exerciseId: string }) {
  const [type, setType] = useState<AgingType>('clients');

  const agingQuery = useQuery<{ aging: DashboardAging }, ApiError>({
    queryKey: ['dashboard-aging', orgId, exerciseId, type],
    queryFn: async () =>
      api.get(
        `/organizations/${orgId}/dashboards/aging?exerciseId=${exerciseId}&type=${type}`,
      ),
  });

  const aging = agingQuery.data?.aging;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle>Balance âgée</CardTitle>
            <CardDescription>
              Soldes non lettrés par bucket d&apos;ancienneté ·{' '}
              {aging ? `arrêté au ${aging.asOfDate}` : '…'}
            </CardDescription>
          </div>
          <div className="flex gap-1 rounded-md border bg-muted/30 p-0.5">
            <Button
              type="button"
              size="sm"
              variant={type === 'clients' ? 'default' : 'outline'}
              onClick={() => setType('clients')}
              className={type === 'clients' ? '' : 'border-0 bg-transparent'}
            >
              Clients
            </Button>
            <Button
              type="button"
              size="sm"
              variant={type === 'fournisseurs' ? 'default' : 'outline'}
              onClick={() => setType('fournisseurs')}
              className={type === 'fournisseurs' ? '' : 'border-0 bg-transparent'}
            >
              Fournisseurs
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {agingQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">
            <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
            Chargement…
          </p>
        ) : agingQuery.error ? (
          <FormError error={agingQuery.error} />
        ) : !aging ? null : aging.partnerBreakdown.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Aucun encours {type === 'clients' ? 'client' : 'fournisseur'} sur cet exercice.
          </p>
        ) : (
          <>
            <BucketBars buckets={aging.buckets} currency={aging.currency} />
            <div className="flex items-baseline justify-between border-t pt-3 text-sm">
              <span className="font-medium">Total encours</span>
              <span className="font-mono text-lg font-semibold">
                {formatAmount(Number(aging.totalOutstanding))}{' '}
                <span className="text-xs text-muted-foreground">{aging.currency}</span>
              </span>
            </div>
            <PartnerAgingTable
              partners={aging.partnerBreakdown}
              currency={aging.currency}
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}

function BucketBars({
  buckets,
  currency,
}: {
  buckets: ReadonlyArray<{ bucket: string; amount: string; lineCount: number }>;
  currency: string;
}) {
  const maxAmount = Math.max(...buckets.map((b) => Number(b.amount)), 1);
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
      {AGING_BUCKETS.map((b) => {
        const bucket = buckets.find((x) => x.bucket === b);
        const amount = bucket ? Number(bucket.amount) : 0;
        const pct = (amount / maxAmount) * 100;
        const isOver = b === 'over-90';
        return (
          <div
            key={b}
            className={`rounded-md border p-3 ${isOver && amount > 0 ? 'border-destructive/50 bg-destructive/5' : ''}`}
          >
            <div className="text-xs text-muted-foreground">{AGING_BUCKET_LABELS[b]}</div>
            <div
              className={`mt-1 font-mono text-lg font-semibold ${isOver && amount > 0 ? 'text-destructive' : ''}`}
            >
              {formatAmount(amount)}
            </div>
            <div className="text-xs text-muted-foreground">
              {bucket?.lineCount ?? 0} ligne(s) · {currency}
            </div>
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted">
              <div
                className={isOver ? 'h-full bg-destructive' : 'h-full bg-primary'}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function PartnerAgingTable({
  partners,
  currency,
}: {
  partners: ReadonlyArray<{
    accountId: string;
    accountCode: string;
    accountLabel: string;
    totalOutstanding: string;
    amountsByBucket: Record<string, string>;
  }>;
  currency: string;
}) {
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left">Compte</th>
            <th className="px-3 py-2 text-left">Libellé</th>
            {AGING_BUCKETS.map((b) => (
              <th key={b} className="px-3 py-2 text-right">
                {AGING_BUCKET_LABELS[b]}
              </th>
            ))}
            <th className="px-3 py-2 text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          {partners.slice(0, 100).map((p) => {
            const over = Number(p.amountsByBucket['over-90']);
            return (
              <tr key={p.accountId} className="border-t">
                <td className="px-3 py-2 font-mono text-xs">{p.accountCode}</td>
                <td className="px-3 py-2">{p.accountLabel}</td>
                {AGING_BUCKETS.map((b) => {
                  const v = Number(p.amountsByBucket[b]);
                  return (
                    <td
                      key={b}
                      className={`px-3 py-2 text-right font-mono ${
                        b === 'over-90' && v > 0 ? 'text-destructive font-medium' : ''
                      } ${v === 0 ? 'text-muted-foreground' : ''}`}
                    >
                      {v === 0 ? '—' : formatAmount(v)}
                    </td>
                  );
                })}
                <td className="px-3 py-2 text-right font-mono font-medium">
                  {formatAmount(Number(p.totalOutstanding))}
                  {over > 0 && (
                    <Badge variant="destructive" className="ml-2 px-1 py-0 text-[10px]">
                      <ArrowUp className="inline h-2 w-2" /> 90j+
                    </Badge>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot className="border-t bg-muted/30 text-sm font-medium">
          <tr>
            <td className="px-3 py-2" colSpan={2}>
              Total ({partners.length} partenaire(s))
            </td>
            {AGING_BUCKETS.map((b) => {
              const total = partners.reduce(
                (sum, p) => sum + Number(p.amountsByBucket[b]),
                0,
              );
              return (
                <td key={b} className="px-3 py-2 text-right font-mono">
                  {formatAmount(total)}
                </td>
              );
            })}
            <td className="px-3 py-2 text-right font-mono">
              {formatAmount(
                partners.reduce((sum, p) => sum + Number(p.totalOutstanding), 0),
              )}{' '}
              <span className="text-xs text-muted-foreground">{currency}</span>
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function formatAmount(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
