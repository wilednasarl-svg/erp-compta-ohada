'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, CheckCircle2, Loader2, Package, Plus, X } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';

import { AppShell } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
import { FormError } from '@/components/ui/form-error';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useApiMutation } from '@/hooks/use-api-mutation';
import { ApiError, api } from '@/lib/api-client';
import { useCurrentOrg } from '@/stores/auth-store';

type DepreciationMethod = 'linear' | 'declining';
type AssetStatus = 'active' | 'disposed';
type ScheduleStatus = 'pending' | 'posted';

interface AssetView {
  readonly id: string;
  readonly code: string;
  readonly label: string;
  readonly acquisitionDate: string;
  readonly putInServiceDate: string;
  readonly acquisitionCost: string;
  readonly residualValue: string;
  readonly depreciationMethod: DepreciationMethod;
  readonly durationMonths: number;
  readonly decliningRate: string | null;
  readonly status: AssetStatus;
  readonly disposalDate: string | null;
  readonly disposalValue: string | null;
}

interface ScheduleRow {
  readonly id: string;
  readonly fiscalYear: number;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly depreciationAmount: string;
  readonly cumulativeDepreciation: string;
  readonly netBookValue: string;
  readonly status: ScheduleStatus;
  readonly journalEntryId: string | null;
  readonly postedAt: string | null;
}

interface AssetsResponse {
  readonly assets: ReadonlyArray<AssetView>;
}
interface ScheduleResponse {
  readonly schedule: ReadonlyArray<ScheduleRow>;
}
interface AssetResponse {
  readonly asset: AssetView;
}

const SCHEDULE_STATUS_CLASS: Record<ScheduleStatus, string> = {
  posted: 'bg-accent-soft text-accent-ink',
  pending: 'bg-info-soft text-info-ink',
};

function fmt(n: number | string): string {
  const v = typeof n === 'string' ? Number(n) : n;
  return Number.isFinite(v) ? v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—';
}

function SkeletonRows({ n = 5 }: { n?: number }) {
  return (
    <div className="animate-pulse divide-y divide-line">
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-3">
          <div className="h-3 w-20 rounded-xs bg-sunk" />
          <div className="h-3 flex-1 rounded-xs bg-sunk" />
          <div className="h-3 w-24 rounded-xs bg-sunk" />
          <div className="h-3 w-16 rounded-xs bg-sunk" />
        </div>
      ))}
    </div>
  );
}

function EmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  actionHref,
  onAction,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  title: string;
  description: string;
  actionLabel?: string;
  actionHref?: string;
  onAction?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
      <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-sunk">
        <Icon className="h-5 w-5 text-ink-mute" strokeWidth={1.5} />
      </span>
      <div>
        <p className="text-sm font-medium text-ink">{title}</p>
        <p className="mt-1 max-w-[40ch] text-xs text-ink-mute">{description}</p>
      </div>
      {actionLabel && actionHref && (
        <Link
          href={actionHref}
          className="inline-flex items-center gap-1.5 rounded-sm bg-accent-soft px-3 py-1.5 text-xs font-medium text-accent-ink transition-colors duration-fast hover:bg-accent hover:text-canvas"
        >
          {actionLabel}
        </Link>
      )}
      {actionLabel && !actionHref && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="press inline-flex items-center gap-1.5 rounded-sm bg-accent-soft px-3 py-1.5 text-xs font-medium text-accent-ink transition-colors duration-fast hover:bg-accent hover:text-canvas"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}

interface AssetComputed {
  readonly cost: number;
  readonly residual: number;
  readonly monthsElapsed: number;
  readonly accumulatedDepreciation: number;
  readonly netBookValue: number;
  readonly annualDotation: number;
  readonly ratePct: number;
  readonly isFullyDepreciated: boolean;
}

function computeAssetMetrics(a: AssetView, today: Date = new Date()): AssetComputed {
  const cost = Number(a.acquisitionCost) || 0;
  const residual = Number(a.residualValue) || 0;
  const depreciable = Math.max(0, cost - residual);
  const duration = Math.max(1, a.durationMonths);

  const startStr = a.putInServiceDate || a.acquisitionDate;
  const start = new Date(startStr);
  let monthsElapsed = 0;
  if (!isNaN(start.getTime())) {
    monthsElapsed =
      (today.getFullYear() - start.getFullYear()) * 12 + (today.getMonth() - start.getMonth());
    monthsElapsed = Math.max(0, Math.min(duration, monthsElapsed));
  }

  const annualDotation = depreciable * (12 / duration);
  let accumulatedDepreciation = 0;
  if (a.depreciationMethod === 'linear') {
    accumulatedDepreciation = (depreciable * monthsElapsed) / duration;
  } else {
    const r = Number(a.decliningRate) || 0;
    accumulatedDepreciation = Math.min(depreciable, depreciable * r * (monthsElapsed / 12));
  }

  const netBookValue = Math.max(residual, cost - accumulatedDepreciation);
  const ratePct = (12 / duration) * 100;
  const isFullyDepreciated = monthsElapsed >= duration && a.status === 'active';

  return {
    cost,
    residual,
    monthsElapsed,
    accumulatedDepreciation,
    netBookValue,
    annualDotation,
    ratePct,
    isFullyDepreciated,
  };
}

/**
 * `/assets` — Module 12 : Immobilisations & Amortissements SYSCOHADA.
 */
export default function AssetsPage() {
  const currentOrg = useCurrentOrg();
  const orgId = currentOrg?.id ?? '';
  const qc = useQueryClient();

  const assetsQuery = useQuery<ReadonlyArray<AssetView>, ApiError>({
    queryKey: ['assets', orgId],
    queryFn: async () => {
      const data = await api.get<AssetsResponse>(`/organizations/${orgId}/assets`);
      return data.assets;
    },
    enabled: orgId !== '',
  });

  // ─── Create form ────────────────────────────────────────────────────
  const [showCreate, setShowCreate] = useState(false);
  const [code, setCode] = useState('');
  const [label, setLabel] = useState('');
  const [acquisitionDate, setAcquisitionDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [putInServiceDate, setPutInServiceDate] = useState('');
  const [acquisitionCost, setAcquisitionCost] = useState('');
  const [residualValue, setResidualValue] = useState('0.00');
  const [method, setMethod] = useState<DepreciationMethod>('linear');
  const [durationMonths, setDurationMonths] = useState(60);
  const [decliningRate, setDecliningRate] = useState('');
  const [assetAccount, setAssetAccount] = useState('');
  const [depreciationAccount, setDepreciationAccount] = useState('');
  const [expenseAccount, setExpenseAccount] = useState('');

  const create = useApiMutation(
    async () => {
      const body: Record<string, unknown> = {
        code: code.trim().toUpperCase(),
        label: label.trim(),
        acquisitionDate,
        acquisitionCost: acquisitionCost.trim(),
        residualValue: residualValue.trim() || '0.00',
        depreciationMethod: method,
        durationMonths,
        assetAccountCode: assetAccount.trim(),
        depreciationAccountCode: depreciationAccount.trim(),
        expenseAccountCode: expenseAccount.trim(),
      };
      if (putInServiceDate.trim() !== '') body.putInServiceDate = putInServiceDate;
      if (method === 'declining' && decliningRate.trim() !== '') {
        body.decliningRate = decliningRate.trim();
      }
      return api.post(`/organizations/${orgId}/assets`, body);
    },
    {
      onSuccess: () => {
        setCode('');
        setLabel('');
        setAcquisitionCost('');
        setPutInServiceDate('');
        setShowCreate(false);
        void qc.invalidateQueries({ queryKey: ['assets', orgId] });
      },
    },
  );

  // ─── Detail ─────────────────────────────────────────────────────────
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const summary = useMemo(() => {
    const assets = assetsQuery.data ?? [];
    const currentYear = new Date().getFullYear();
    let grossTotal = 0;
    let netTotal = 0;
    let yearDotation = 0;
    let activeCount = 0;
    let disposedCount = 0;
    let fullyDeprecatedCount = 0;

    for (const a of assets) {
      const m = computeAssetMetrics(a);
      grossTotal += m.cost;
      if (a.status === 'disposed') {
        disposedCount += 1;
      } else {
        netTotal += m.netBookValue;
        activeCount += 1;
        // Dotation de l'exercice courant (approx linéaire)
        const startYear = new Date(a.putInServiceDate || a.acquisitionDate).getFullYear();
        const endYear = startYear + Math.ceil(a.durationMonths / 12);
        if (currentYear >= startYear && currentYear < endYear) {
          yearDotation += m.annualDotation;
        }
        if (m.isFullyDepreciated) fullyDeprecatedCount += 1;
      }
    }

    return { grossTotal, netTotal, yearDotation, activeCount, disposedCount, fullyDeprecatedCount };
  }, [assetsQuery.data]);

  return (
    <AppShell>
      <div className="animate-page-in space-y-8">
        <header className="flex items-start justify-between gap-4">
          <div>
            <p className="eyebrow mb-2">États · Immobilisations</p>
            <h1 className="font-display text-3xl font-medium tracking-tight text-ink">
              Immobilisations
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-ink-mute">
              Suivi des actifs, amortissements et dotations. Méthode linéaire SYSCOHADA.
            </p>
          </div>
          <Button
            type="button"
            variant={showCreate ? 'secondary' : 'default'}
            onClick={() => setShowCreate((v) => !v)}
            className="press"
          >
            <Plus className="mr-2 h-4 w-4" />
            {showCreate ? 'Annuler' : 'Nouvelle immobilisation'}
          </Button>
        </header>

        {/* Summary bar */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-sm border border-line bg-paper p-4">
            <p className="eyebrow">Valeur brute</p>
            <p className="mt-1 font-mono text-2xl font-medium tabular-nums text-ink">{fmt(summary.grossTotal)}</p>
            <p className="mt-1 text-xs text-ink-mute">total à l&apos;acquisition</p>
          </div>
          <div className="rounded-sm border border-line bg-paper p-4">
            <p className="eyebrow">Valeur nette comptable</p>
            <p className="mt-1 font-mono text-2xl font-medium tabular-nums text-ink">{fmt(summary.netTotal)}</p>
            <p className="mt-1 text-xs text-ink-mute">après amortissements</p>
          </div>
          <div className="rounded-sm border border-line bg-paper p-4">
            <p className="eyebrow">Dotation exercice</p>
            <p className="mt-1 font-mono text-2xl font-medium tabular-nums text-ink">{fmt(summary.yearDotation)}</p>
            <p className="mt-1 text-xs text-ink-mute">annuelle (linéaire)</p>
          </div>
          <div className="rounded-sm border border-line bg-paper p-4">
            <p className="eyebrow">Actifs</p>
            <p className="mt-1 font-mono text-2xl font-medium tabular-nums text-ink">
              {summary.activeCount}
              <span className="ml-1 text-base text-ink-mute">/ {summary.activeCount + summary.disposedCount}</span>
            </p>
            <p className="mt-1 text-xs text-ink-mute">
              {summary.fullyDeprecatedCount > 0 && (
                <span className="text-warn-ink">{summary.fullyDeprecatedCount} amorti{summary.fullyDeprecatedCount > 1 ? 's' : ''} · </span>
              )}
              {summary.disposedCount} sorti{summary.disposedCount > 1 ? 's' : ''}
            </p>
          </div>
        </div>

        {showCreate && (
          <section className="rounded-sm border border-line bg-paper p-5">
            <div className="border-b border-line pb-3">
              <h2 className="font-display text-xl font-medium text-ink">Nouvelle immobilisation</h2>
              <p className="mt-1 text-sm text-ink-mute">Saisie d&apos;un actif avec son plan d&apos;amortissement</p>
            </div>
            <form
              className="mt-4 space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                create.mutate(undefined);
              }}
            >
              <div className="grid grid-cols-1 gap-3 md:grid-cols-[180px_1fr]">
                <div className="space-y-1">
                  <Label htmlFor="a-code">Code</Label>
                  <Input
                    id="a-code"
                    value={code}
                    onChange={(e) => setCode(e.target.value.toUpperCase())}
                    placeholder="IMMO-2026-001"
                    pattern="[A-Z0-9-]{1,20}"
                    required
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="a-label">Libellé</Label>
                  <Input
                    id="a-label"
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    placeholder="Ordinateur portable MacBook Pro"
                    maxLength={200}
                    required
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <div className="space-y-1">
                  <Label htmlFor="a-acq-date">Date acquisition</Label>
                  <Input
                    id="a-acq-date"
                    type="date"
                    value={acquisitionDate}
                    onChange={(e) => setAcquisitionDate(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="a-svc-date">Date mise en service (optionnel)</Label>
                  <Input
                    id="a-svc-date"
                    type="date"
                    value={putInServiceDate}
                    onChange={(e) => setPutInServiceDate(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="a-cost">Coût HT</Label>
                  <Input
                    id="a-cost"
                    type="number"
                    step="0.01"
                    min="0"
                    value={acquisitionCost}
                    onChange={(e) => setAcquisitionCost(e.target.value)}
                    placeholder="1500000.00"
                    required
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                <div className="space-y-1">
                  <Label htmlFor="a-method">Méthode</Label>
                  <select
                    id="a-method"
                    value={method}
                    onChange={(e) => setMethod(e.target.value as DepreciationMethod)}
                    className="w-full rounded-sm border border-line-strong bg-paper px-3 py-2 text-sm text-ink transition-colors duration-fast focus:border-accent focus:outline-none"
                  >
                    <option value="linear">Linéaire</option>
                    <option value="declining">Dégressif</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="a-duration">Durée (mois)</Label>
                  <Input
                    id="a-duration"
                    type="number"
                    min="1"
                    value={durationMonths}
                    onChange={(e) => setDurationMonths(Number(e.target.value))}
                    required
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="a-residual">Valeur résiduelle</Label>
                  <Input
                    id="a-residual"
                    type="number"
                    step="0.01"
                    min="0"
                    value={residualValue}
                    onChange={(e) => setResidualValue(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="a-rate">Taux dégressif</Label>
                  <Input
                    id="a-rate"
                    value={decliningRate}
                    onChange={(e) => setDecliningRate(e.target.value)}
                    placeholder="0.3500"
                    disabled={method === 'linear'}
                    required={method === 'declining'}
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <div className="space-y-1">
                  <Label htmlFor="a-asset-acc">Compte immobilisation (21x/22x/23x/24x)</Label>
                  <Input
                    id="a-asset-acc"
                    value={assetAccount}
                    onChange={(e) => setAssetAccount(e.target.value)}
                    placeholder="2411"
                    pattern="\d{1,10}"
                    required
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="a-dep-acc">Compte amortissement cumulé (28x)</Label>
                  <Input
                    id="a-dep-acc"
                    value={depreciationAccount}
                    onChange={(e) => setDepreciationAccount(e.target.value)}
                    placeholder="2841"
                    pattern="\d{1,10}"
                    required
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="a-exp-acc">Compte dotation (681x)</Label>
                  <Input
                    id="a-exp-acc"
                    value={expenseAccount}
                    onChange={(e) => setExpenseAccount(e.target.value)}
                    placeholder="6811"
                    pattern="\d{1,10}"
                    required
                  />
                </div>
              </div>
              <Button type="submit" disabled={create.isPending} className="press">
                {create.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="mr-2 h-4 w-4" />
                )}
                Créer l&apos;immobilisation
              </Button>
              <FormError error={create.error} />
            </form>
          </section>
        )}

        <section className="space-y-4">
          <div className="flex items-end justify-between gap-3 border-b border-line pb-3">
            <div>
              <h2 className="font-display text-xl font-medium text-ink">Registre des immobilisations</h2>
              <p className="mt-1 text-sm text-ink-mute">
                {assetsQuery.data?.length ?? 0} immobilisation{(assetsQuery.data?.length ?? 0) > 1 ? 's' : ''}
              </p>
            </div>
          </div>

          {assetsQuery.isLoading ? (
            <div className="rounded-sm border border-line">
              <SkeletonRows n={6} />
            </div>
          ) : (assetsQuery.data ?? []).length === 0 ? (
            <div className="rounded-sm border border-line bg-paper">
              <EmptyState
                icon={Package}
                title="Aucune immobilisation enregistrée"
                description="Saisissez vos actifs pour suivre l'amortissement SYSCOHADA"
                actionLabel="Créer une immobilisation"
                onAction={() => setShowCreate(true)}
              />
            </div>
          ) : (
            <div className="overflow-x-auto rounded-sm border border-line bg-paper">
              <table className="w-full text-sm">
                <thead className="bg-sunk">
                  <tr>
                    <th className="px-3 py-2 text-left"><span className="eyebrow">Code</span></th>
                    <th className="px-3 py-2 text-left"><span className="eyebrow">Désignation</span></th>
                    <th className="px-3 py-2 text-left"><span className="eyebrow">Acquisition</span></th>
                    <th className="px-3 py-2 text-left"><span className="eyebrow">Plan</span></th>
                    <th className="px-3 py-2 text-right"><span className="eyebrow">Valeur brute</span></th>
                    <th className="px-3 py-2 text-right"><span className="eyebrow">Amort. cumulé</span></th>
                    <th className="px-3 py-2 text-right"><span className="eyebrow">VNC</span></th>
                    <th className="px-3 py-2 text-left"><span className="eyebrow">Statut</span></th>
                  </tr>
                </thead>
                <tbody>
                  {(assetsQuery.data ?? []).map((a) => {
                    const isSelected = a.id === selectedId;
                    const m = computeAssetMetrics(a);
                    const rateLabel =
                      a.depreciationMethod === 'linear'
                        ? `${m.ratePct.toFixed(0)}% lin.`
                        : `${(Number(a.decliningRate) * 100).toFixed(0)}% dég.`;
                    const isDisposed = a.status === 'disposed';
                    const isFully = m.isFullyDepreciated;
                    return (
                      <tr
                        key={a.id}
                        onClick={() => setSelectedId(isSelected ? null : a.id)}
                        className={`cursor-pointer border-t border-line transition-colors duration-fast hover:bg-sunk/60 ${
                          isSelected ? 'bg-sunk/60' : ''
                        }`}
                      >
                        <td className="px-3 py-2 font-mono text-xs text-ink-soft">{a.code}</td>
                        <td className="px-3 py-2 text-ink">{a.label}</td>
                        <td className="px-3 py-2 font-mono text-xs text-ink-mute">{a.acquisitionDate}</td>
                        <td className="px-3 py-2">
                          <span className="inline-flex items-center rounded-xs bg-sunk px-1.5 py-0.5 font-mono text-[10px] font-medium text-ink-soft">
                            {rateLabel}
                          </span>
                        </td>
                        <td className="num px-3 py-2 text-right font-mono tabular-nums text-ink-soft">
                          {fmt(m.cost)}
                        </td>
                        <td className="num px-3 py-2 text-right font-mono tabular-nums text-ink-soft">
                          {fmt(m.accumulatedDepreciation)}
                        </td>
                        <td className="num px-3 py-2 text-right font-mono font-medium tabular-nums text-ink">
                          {fmt(m.netBookValue)}
                        </td>
                        <td className="px-3 py-2">
                          {isDisposed ? (
                            <span className="inline-flex items-center rounded-xs bg-sunk px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-ink-soft">
                              Sorti
                            </span>
                          ) : isFully ? (
                            <span className="inline-flex items-center rounded-xs bg-warn-soft px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-warn-ink">
                              Amorti
                            </span>
                          ) : (
                            <span className="inline-flex items-center rounded-xs bg-accent-soft px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-accent-ink">
                              Actif
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="border-t-2 border-line-strong bg-sunk">
                  <tr>
                    <td colSpan={4} className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-ink-soft">
                      Totaux
                    </td>
                    <td className="num px-3 py-2 text-right font-mono text-base font-medium tabular-nums text-ink">
                      {fmt(summary.grossTotal)}
                    </td>
                    <td className="num px-3 py-2 text-right font-mono tabular-nums text-ink-soft">
                      {fmt(summary.grossTotal - summary.netTotal)}
                    </td>
                    <td className="num px-3 py-2 text-right font-mono text-base font-medium tabular-nums text-ink">
                      {fmt(summary.netTotal)}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
          <FormError error={assetsQuery.error} />
        </section>

        {selectedId !== null && (
          <AssetDetailCard
            orgId={orgId}
            assetId={selectedId}
            onClose={() => setSelectedId(null)}
            onMutated={() => {
              void qc.invalidateQueries({ queryKey: ['assets', orgId] });
            }}
          />
        )}
      </div>
    </AppShell>
  );
}

function AssetDetailCard({
  orgId,
  assetId,
  onClose,
  onMutated,
}: {
  orgId: string;
  assetId: string;
  onClose: () => void;
  onMutated: () => void;
}) {
  const assetQuery = useQuery<AssetView, ApiError>({
    queryKey: ['asset', orgId, assetId],
    queryFn: async () => {
      const data = await api.get<AssetResponse>(`/organizations/${orgId}/assets/${assetId}`);
      return data.asset;
    },
  });

  const scheduleQuery = useQuery<ReadonlyArray<ScheduleRow>, ApiError>({
    queryKey: ['asset-schedule', orgId, assetId],
    queryFn: async () => {
      const data = await api.get<ScheduleResponse>(
        `/organizations/${orgId}/assets/${assetId}/schedule`,
      );
      return data.schedule;
    },
  });

  // Dispose
  const [disposalDate, setDisposalDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [disposalValue, setDisposalValue] = useState('');
  const [showDispose, setShowDispose] = useState(false);

  const dispose = useApiMutation(
    async () => {
      const body: Record<string, unknown> = { disposalDate };
      if (disposalValue.trim() !== '') body.disposalValue = disposalValue.trim();
      return api.post(`/organizations/${orgId}/assets/${assetId}/dispose`, body);
    },
    {
      onSuccess: () => {
        setShowDispose(false);
        setDisposalValue('');
        onMutated();
        void assetQuery.refetch();
        void scheduleQuery.refetch();
      },
    },
  );

  const a = assetQuery.data;
  const metrics = a ? computeAssetMetrics(a) : null;

  return (
    <section className="rounded-sm border border-line bg-paper p-5">
      <div className="flex items-start justify-between border-b border-line pb-3">
        <div>
          <h2 className="flex flex-wrap items-center gap-2 font-display text-xl font-medium text-ink">
            <span className="font-mono text-xs text-ink-soft">{a?.code}</span>
            <span>{a?.label}</span>
            {a && a.status === 'disposed' && (
              <span className="inline-flex items-center rounded-xs bg-sunk px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-ink-soft">
                Sorti
              </span>
            )}
            {a && a.status === 'active' && metrics?.isFullyDepreciated && (
              <span className="inline-flex items-center rounded-xs bg-warn-soft px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-warn-ink">
                Amorti
              </span>
            )}
            {a && a.status === 'active' && !metrics?.isFullyDepreciated && (
              <span className="inline-flex items-center rounded-xs bg-accent-soft px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-accent-ink">
                Actif
              </span>
            )}
          </h2>
          <p className="mt-1 text-sm text-ink-mute">
            Échéancier d&apos;amortissement et dotations passées en journal
          </p>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={onClose} className="press">
          <X className="h-4 w-4" />
        </Button>
      </div>

      {a && metrics && (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-sm border border-line bg-sunk/30 p-3">
            <p className="eyebrow">Coût d&apos;acquisition</p>
            <p className="mt-1 num font-mono text-sm font-medium tabular-nums text-ink">{fmt(metrics.cost)}</p>
          </div>
          <div className="rounded-sm border border-line bg-sunk/30 p-3">
            <p className="eyebrow">Amortissement cumulé</p>
            <p className="mt-1 num font-mono text-sm font-medium tabular-nums text-ink">{fmt(metrics.accumulatedDepreciation)}</p>
          </div>
          <div className="rounded-sm border border-line bg-sunk/30 p-3">
            <p className="eyebrow">VNC</p>
            <p className="mt-1 num font-mono text-sm font-medium tabular-nums text-ink">{fmt(metrics.netBookValue)}</p>
          </div>
          <div className="rounded-sm border border-line bg-sunk/30 p-3">
            <p className="eyebrow">Dotation annuelle</p>
            <p className="mt-1 num font-mono text-sm font-medium tabular-nums text-ink">{fmt(metrics.annualDotation)}</p>
          </div>
        </div>
      )}

      <div className="mt-4 space-y-4">
        {scheduleQuery.isLoading ? (
          <div className="rounded-sm border border-line">
            <SkeletonRows n={5} />
          </div>
        ) : (
          <div className="overflow-x-auto rounded-sm border border-line">
            <table className="w-full text-sm">
              <thead className="bg-sunk">
                <tr>
                  <th className="px-3 py-2 text-left">
                    <span className="eyebrow">Exercice</span>
                  </th>
                  <th className="px-3 py-2 text-left">
                    <span className="eyebrow">Période</span>
                  </th>
                  <th className="px-3 py-2 text-right">
                    <span className="eyebrow">Dotation</span>
                  </th>
                  <th className="px-3 py-2 text-right">
                    <span className="eyebrow">Cumul</span>
                  </th>
                  <th className="px-3 py-2 text-right">
                    <span className="eyebrow">VNC</span>
                  </th>
                  <th className="px-3 py-2 text-left">
                    <span className="eyebrow">Statut</span>
                  </th>
                  <th className="px-3 py-2 text-right">
                    <span className="eyebrow">Action</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {(scheduleQuery.data ?? []).map((r) => (
                  <ScheduleRowItem
                    key={r.id}
                    orgId={orgId}
                    assetId={assetId}
                    row={r}
                    onMutated={() => {
                      onMutated();
                      void scheduleQuery.refetch();
                    }}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
        <FormError error={scheduleQuery.error} />

        {a?.status === 'active' && (
          <div className="border-t border-line pt-4">
            {!showDispose ? (
              <Button
                type="button"
                variant="destructive"
                onClick={() => setShowDispose(true)}
                className="press"
              >
                <Ban className="mr-2 h-4 w-4" />
                Céder / Mettre au rebut
              </Button>
            ) : (
              <form
                className="grid grid-cols-1 gap-3 md:grid-cols-[200px_200px_auto] md:items-end"
                onSubmit={(e) => {
                  e.preventDefault();
                  dispose.mutate(undefined);
                }}
              >
                <div className="space-y-1">
                  <Label htmlFor="d-date">Date cession</Label>
                  <Input
                    id="d-date"
                    type="date"
                    value={disposalDate}
                    onChange={(e) => setDisposalDate(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="d-value">Valeur cession (vide = rebut)</Label>
                  <Input
                    id="d-value"
                    type="number"
                    step="0.01"
                    min="0"
                    value={disposalValue}
                    onChange={(e) => setDisposalValue(e.target.value)}
                    placeholder="500000.00"
                  />
                </div>
                <div className="flex gap-2">
                  <Button
                    type="submit"
                    variant="destructive"
                    disabled={dispose.isPending}
                    className="press"
                  >
                    {dispose.isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Ban className="mr-2 h-4 w-4" />
                    )}
                    Confirmer
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setShowDispose(false)}
                    className="press"
                  >
                    Annuler
                  </Button>
                </div>
                <FormError error={dispose.error} className="md:col-span-3" />
              </form>
            )}
          </div>
        )}
        {a?.status === 'disposed' && (
          <p className="text-sm text-ink-mute">
            <Ban className="mr-1 inline h-4 w-4" />
            Immobilisation cédée le {a.disposalDate}
            {a.disposalValue
              ? (<> pour <span className="font-mono tabular-nums">{fmt(a.disposalValue)}</span></>)
              : ' (mise au rebut)'}
          </p>
        )}
      </div>
    </section>
  );
}

function ScheduleRowItem({
  orgId,
  assetId,
  row,
  onMutated,
}: {
  orgId: string;
  assetId: string;
  row: ScheduleRow;
  onMutated: () => void;
}) {
  const post = useApiMutation(
    async () =>
      api.post(`/organizations/${orgId}/assets/${assetId}/schedules/${row.id}/post`, {}),
    { onSuccess: onMutated },
  );

  return (
    <tr className="border-t border-line transition-colors duration-fast hover:bg-sunk/40">
      <td className="px-3 py-2 font-mono text-ink">{row.fiscalYear}</td>
      <td className="px-3 py-2 font-mono text-xs text-ink-mute">
        {row.periodStart} → {row.periodEnd}
      </td>
      <td className="num px-3 py-2 text-right font-mono tabular-nums text-ink">
        {fmt(row.depreciationAmount)}
      </td>
      <td className="num px-3 py-2 text-right font-mono tabular-nums text-ink-soft">
        {fmt(row.cumulativeDepreciation)}
      </td>
      <td className="num px-3 py-2 text-right font-mono font-medium tabular-nums text-ink">
        {fmt(row.netBookValue)}
      </td>
      <td className="px-3 py-2">
        <span
          className={`inline-flex items-center rounded-sm px-2 py-0.5 text-[11px] font-medium ${SCHEDULE_STATUS_CLASS[row.status]}`}
        >
          {row.status === 'posted' ? (
            <>
              <CheckCircle2 className="mr-1 inline h-3 w-3" />
              Posté
            </>
          ) : (
            'En attente'
          )}
        </span>
      </td>
      <td className="px-3 py-2 text-right">
        {row.status === 'pending' && (
          <Button
            type="button"
            size="sm"
            disabled={post.isPending}
            onClick={() => post.mutate(undefined)}
            className="press"
          >
            {post.isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
            Poster
          </Button>
        )}
        {post.error && <FormError error={post.error} className="mt-1 text-right" />}
      </td>
    </tr>
  );
}
