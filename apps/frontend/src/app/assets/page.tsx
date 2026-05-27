'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, CheckCircle2, Loader2, Package, Plus, X } from 'lucide-react';
import { useState } from 'react';

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

/* Token-aligned status badge classes */
const ASSET_STATUS_CLASS: Record<AssetStatus, string> = {
  active: 'bg-accent-soft text-accent-ink',
  disposed: 'bg-critical-soft text-critical-ink',
};

const SCHEDULE_STATUS_CLASS: Record<ScheduleStatus, string> = {
  posted: 'bg-accent-soft text-accent-ink',
  pending: 'bg-info-soft text-info-ink',
};

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

  return (
    <AppShell>
      <div className="animate-page-in space-y-6">
        <header>
          <p className="eyebrow mb-2">Patrimoine</p>
          <h1 className="font-display text-4xl font-medium tracking-tight text-ink">
            Immobilisations
          </h1>
          <p className="mt-2 text-sm text-ink-mute">
            Registre des immobilisations corporelles et incorporelles SYSCOHADA. Calcul automatique
            de l&apos;échéancier (linéaire ou dégressif) et passage des dotations comme écritures
            comptables validées via Module 8.
          </p>
        </header>

        <section className="rounded-sm border border-line bg-paper p-5">
          <div className="flex items-center justify-between border-b border-line pb-3">
            <div>
              <h2 className="font-display text-xl font-medium text-ink">Registre</h2>
              <p className="mt-1 text-sm text-ink-mute">
                {assetsQuery.data?.length ?? 0} immobilisation(s)
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
          </div>

          {showCreate && (
            <form
              className="mt-4 space-y-3 border-b border-line pb-5"
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
                    className="rounded-sm border border-line-strong bg-paper px-3 py-1 text-sm text-ink transition-colors focus:border-accent focus:outline-none"
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
          )}

          <div className="mt-4">
            {assetsQuery.isLoading ? (
              <p className="text-sm text-ink-mute">Chargement…</p>
            ) : (assetsQuery.data ?? []).length === 0 ? (
              <p className="text-sm text-ink-mute">Aucune immobilisation enregistrée.</p>
            ) : (
              <ul className="divide-y divide-line rounded-sm border border-line">
                {(assetsQuery.data ?? []).map((a) => {
                  const isSelected = a.id === selectedId;
                  return (
                    <li key={a.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(isSelected ? null : a.id)}
                        className={`press flex w-full items-start gap-3 px-3 py-2.5 text-left text-sm transition-colors hover:bg-sunk/60 ${
                          isSelected ? 'bg-sunk/60' : ''
                        }`}
                      >
                        <Package className="mt-0.5 h-4 w-4 text-ink-mute" />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-xs text-ink-soft">{a.code}</span>
                            <span className="font-medium text-ink">{a.label}</span>
                            <span
                              className={`inline-flex items-center rounded-sm px-2 py-0.5 text-2xs uppercase tracking-wide ${ASSET_STATUS_CLASS[a.status]}`}
                            >
                              {a.status === 'active' ? 'Actif' : 'Cédé'}
                            </span>
                          </div>
                          <div className="mt-0.5 grid grid-cols-3 gap-3 text-xs text-ink-mute">
                            <span>
                              Coût :{' '}
                              <span className="font-mono text-ink-soft">
                                {Number(a.acquisitionCost).toLocaleString('fr-FR', {
                                  minimumFractionDigits: 2,
                                })}
                              </span>
                            </span>
                            <span>
                              Méthode : {a.depreciationMethod} · {a.durationMonths} mois
                            </span>
                            <span>Mise en service : {a.putInServiceDate}</span>
                          </div>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            <FormError error={assetsQuery.error} className="mt-3" />
          </div>
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

  return (
    <section className="rounded-sm border border-line bg-paper p-5">
      <div className="flex items-start justify-between border-b border-line pb-3">
        <div>
          <h2 className="flex items-center gap-2 font-display text-xl font-medium text-ink">
            {a?.code} — {a?.label}
            {a && (
              <span
                className={`inline-flex items-center rounded-sm px-2 py-0.5 text-2xs uppercase tracking-wide ${ASSET_STATUS_CLASS[a.status]}`}
              >
                {a.status === 'active' ? 'Actif' : 'Cédé'}
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

      <div className="mt-4 space-y-4">
        {scheduleQuery.isLoading ? (
          <p className="text-sm text-ink-mute">Chargement échéancier…</p>
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
                {(scheduleQuery.data ?? []).map((r, i) => (
                  <ScheduleRowItem
                    key={r.id}
                    orgId={orgId}
                    assetId={assetId}
                    row={r}
                    rowIndex={i}
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
              ? ` pour ${Number(a.disposalValue).toLocaleString('fr-FR', {
                  minimumFractionDigits: 2,
                })}`
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
  rowIndex,
  onMutated,
}: {
  orgId: string;
  assetId: string;
  row: ScheduleRow;
  rowIndex: number;
  onMutated: () => void;
}) {
  const post = useApiMutation(
    async () =>
      api.post(`/organizations/${orgId}/assets/${assetId}/schedules/${row.id}/post`, {}),
    { onSuccess: onMutated },
  );

  const stripe = rowIndex % 2 === 0 ? 'bg-paper' : 'bg-sunk/25';

  return (
    <tr className={`border-t border-line ${stripe}`}>
      <td className="px-3 py-2 font-mono text-ink">{row.fiscalYear}</td>
      <td className="px-3 py-2 text-xs text-ink-mute">
        {row.periodStart} → {row.periodEnd}
      </td>
      <td className="px-3 py-2 text-right font-mono text-ink">
        {Number(row.depreciationAmount).toLocaleString('fr-FR', { minimumFractionDigits: 2 })}
      </td>
      <td className="px-3 py-2 text-right font-mono text-ink">
        {Number(row.cumulativeDepreciation).toLocaleString('fr-FR', { minimumFractionDigits: 2 })}
      </td>
      <td className="px-3 py-2 text-right font-mono text-ink">
        {Number(row.netBookValue).toLocaleString('fr-FR', { minimumFractionDigits: 2 })}
      </td>
      <td className="px-3 py-2">
        <span
          className={`inline-flex items-center rounded-sm px-2 py-0.5 text-2xs uppercase tracking-wide ${SCHEDULE_STATUS_CLASS[row.status]}`}
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
