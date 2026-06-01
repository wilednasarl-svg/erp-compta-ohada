'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { TrendingDown } from 'lucide-react';
import { useState } from 'react';

import { AppShell } from '@/components/app-shell';
import { FormError } from '@/components/ui/form-error';
import { ApiError, api } from '@/lib/api-client';
import { useCurrentOrg } from '@/stores/auth-store';

/* ─── Types ─────────────────────────────────────────────────── */

type Scope = 'asset' | 'inventory';

interface NamedRef {
  id: string;
  code: string;
  label: string;
}

interface AssetImpairment {
  id: string;
  assetId: string;
  testDate: string;
  carryingAmount: string;
  recoverableAmount: string;
  impairmentAmount: string;
}

interface InventoryImpairment {
  id: string;
  inventoryItemId: string;
  testDate: string;
  carryingAmount: string;
  nrv: string;
  impairmentAmount: string;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
function fmt(value: string): string {
  const n = Number(value);
  return Number.isFinite(n) ? new Intl.NumberFormat('fr-FR').format(n) : value;
}
const INPUT =
  'h-9 w-full rounded-sm border border-line bg-sunk px-2 text-sm text-ink outline-none focus:border-accent';

export default function ImpairmentsPage() {
  const org = useCurrentOrg();
  const orgId = org?.id ?? '';
  const [scope, setScope] = useState<Scope>('asset');

  return (
    <AppShell>
      <div className="w-full animate-page-in space-y-8">
        <header>
          <p className="eyebrow">Retraitement · Dépréciations</p>
          <h1 className="mt-2 font-display text-3xl font-medium tracking-tight text-ink">
            Dépréciations d&apos;actifs &amp; de stocks
          </h1>
          <p className="mt-2 max-w-[64ch] text-sm text-ink-soft">
            Réalisez le test de valeur SYSCOHADA (Tome 2, chap. 12 &amp; 14) : comparez la valeur
            comptable à la valeur recouvrable (ou la VNR pour les stocks). En cas de perte, la
            dotation est dépréciée et l&apos;écriture comptable est posée automatiquement.
          </p>
        </header>

        <div className="inline-flex rounded-sm border border-line bg-paper p-0.5">
          <ToggleButton active={scope === 'asset'} onClick={() => setScope('asset')}>
            Immobilisations
          </ToggleButton>
          <ToggleButton active={scope === 'inventory'} onClick={() => setScope('inventory')}>
            Stocks
          </ToggleButton>
        </div>

        {scope === 'asset' ? (
          <AssetImpairmentSection orgId={orgId} />
        ) : (
          <InventoryImpairmentSection orgId={orgId} />
        )}
      </div>
    </AppShell>
  );
}

function ToggleButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-sm px-4 py-1.5 text-sm font-medium transition-colors ${
        active ? 'bg-accent-soft text-ink' : 'text-ink-soft hover:text-ink'
      }`}
    >
      {children}
    </button>
  );
}

function AssetImpairmentSection({ orgId }: { orgId: string }) {
  const qc = useQueryClient();
  const [assetId, setAssetId] = useState('');
  const [testDate, setTestDate] = useState(todayIso());
  const [recoverableAmount, setRecoverable] = useState('');

  const assetsQuery = useQuery<{ assets: NamedRef[] }, ApiError>({
    queryKey: ['assets-ref', orgId],
    queryFn: async () => api.get(`/organizations/${orgId}/assets`),
    enabled: orgId !== '',
  });
  const listQuery = useQuery<AssetImpairment[], ApiError>({
    queryKey: ['impairments-assets', orgId],
    queryFn: async () => api.get(`/organizations/${orgId}/impairments/assets`),
    enabled: orgId !== '',
  });

  const mutation = useMutation<AssetImpairment, ApiError, void>({
    mutationFn: async () =>
      api.post(`/organizations/${orgId}/impairments/assets/test`, {
        assetId,
        testDate,
        recoverableAmount: recoverableAmount.trim(),
      }),
    onSuccess: () => {
      setRecoverable('');
      void qc.invalidateQueries({ queryKey: ['impairments-assets', orgId] });
    },
  });

  const canSubmit =
    assetId !== '' && /^\d+(\.\d{1,2})?$/.test(recoverableAmount.trim()) && !mutation.isPending;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit) mutation.mutate();
        }}
        className="space-y-3 rounded-sm border border-line bg-paper p-4 lg:col-span-2"
      >
        <h2 className="font-display text-lg font-medium text-ink">Test de dépréciation</h2>
        <label className="block space-y-1">
          <span className="text-xs text-ink-soft">Immobilisation</span>
          <select value={assetId} onChange={(e) => setAssetId(e.target.value)} className={INPUT}>
            <option value="">— Choisir —</option>
            {(assetsQuery.data?.assets ?? []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} · {a.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1">
          <span className="text-xs text-ink-soft">Valeur recouvrable</span>
          <input
            value={recoverableAmount}
            onChange={(e) => setRecoverable(e.target.value)}
            placeholder="0.00"
            className={`${INPUT} font-mono tabular-nums`}
          />
        </label>
        <label className="block space-y-1">
          <span className="text-xs text-ink-soft">Date du test</span>
          <input type="date" value={testDate} onChange={(e) => setTestDate(e.target.value)} className={INPUT} />
        </label>
        {mutation.isError && <FormError error={mutation.error} />}
        <button
          type="submit"
          disabled={!canSubmit}
          className="inline-flex h-9 w-full items-center justify-center rounded-sm border border-accent bg-accent-soft px-3 text-sm font-medium text-ink outline-none transition-colors hover:bg-accent-soft/70 disabled:opacity-60"
        >
          {mutation.isPending ? 'Test en cours…' : 'Lancer le test'}
        </button>
      </form>

      <div className="lg:col-span-3">
        {listQuery.isError && <FormError error={listQuery.error} />}
        <ImpairmentTable
          rows={(listQuery.data ?? []).map((r) => ({
            id: r.id,
            testDate: r.testDate,
            carrying: r.carryingAmount,
            recoverable: r.recoverableAmount,
            loss: r.impairmentAmount,
          }))}
          recoverableLabel="Valeur recouvrable"
          loading={listQuery.isLoading}
        />
      </div>
    </div>
  );
}

function InventoryImpairmentSection({ orgId }: { orgId: string }) {
  const qc = useQueryClient();
  const [inventoryItemId, setItemId] = useState('');
  const [testDate, setTestDate] = useState(todayIso());
  const [nrv, setNrv] = useState('');

  const itemsQuery = useQuery<{ items: NamedRef[] }, ApiError>({
    queryKey: ['inventory-ref', orgId],
    queryFn: async () => api.get(`/organizations/${orgId}/inventory/items`),
    enabled: orgId !== '',
  });
  const listQuery = useQuery<InventoryImpairment[], ApiError>({
    queryKey: ['impairments-inventory', orgId],
    queryFn: async () => api.get(`/organizations/${orgId}/impairments/inventory`),
    enabled: orgId !== '',
  });

  const mutation = useMutation<InventoryImpairment, ApiError, void>({
    mutationFn: async () =>
      api.post(`/organizations/${orgId}/impairments/inventory/test`, {
        inventoryItemId,
        testDate,
        nrv: nrv.trim(),
      }),
    onSuccess: () => {
      setNrv('');
      void qc.invalidateQueries({ queryKey: ['impairments-inventory', orgId] });
    },
  });

  const canSubmit =
    inventoryItemId !== '' && /^\d+(\.\d{1,2})?$/.test(nrv.trim()) && !mutation.isPending;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit) mutation.mutate();
        }}
        className="space-y-3 rounded-sm border border-line bg-paper p-4 lg:col-span-2"
      >
        <h2 className="font-display text-lg font-medium text-ink">Test de dépréciation</h2>
        <label className="block space-y-1">
          <span className="text-xs text-ink-soft">Article de stock</span>
          <select value={inventoryItemId} onChange={(e) => setItemId(e.target.value)} className={INPUT}>
            <option value="">— Choisir —</option>
            {(itemsQuery.data?.items ?? []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} · {a.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1">
          <span className="text-xs text-ink-soft">Valeur nette de réalisation (VNR)</span>
          <input
            value={nrv}
            onChange={(e) => setNrv(e.target.value)}
            placeholder="0.00"
            className={`${INPUT} font-mono tabular-nums`}
          />
        </label>
        <label className="block space-y-1">
          <span className="text-xs text-ink-soft">Date du test</span>
          <input type="date" value={testDate} onChange={(e) => setTestDate(e.target.value)} className={INPUT} />
        </label>
        {mutation.isError && <FormError error={mutation.error} />}
        <button
          type="submit"
          disabled={!canSubmit}
          className="inline-flex h-9 w-full items-center justify-center rounded-sm border border-accent bg-accent-soft px-3 text-sm font-medium text-ink outline-none transition-colors hover:bg-accent-soft/70 disabled:opacity-60"
        >
          {mutation.isPending ? 'Test en cours…' : 'Lancer le test'}
        </button>
      </form>

      <div className="lg:col-span-3">
        {listQuery.isError && <FormError error={listQuery.error} />}
        <ImpairmentTable
          rows={(listQuery.data ?? []).map((r) => ({
            id: r.id,
            testDate: r.testDate,
            carrying: r.carryingAmount,
            recoverable: r.nrv,
            loss: r.impairmentAmount,
          }))}
          recoverableLabel="VNR"
          loading={listQuery.isLoading}
        />
      </div>
    </div>
  );
}

interface ImpairmentRow {
  id: string;
  testDate: string;
  carrying: string;
  recoverable: string;
  loss: string;
}

function ImpairmentTable({
  rows,
  recoverableLabel,
  loading,
}: {
  rows: ImpairmentRow[];
  recoverableLabel: string;
  loading: boolean;
}) {
  return (
    <div className="overflow-hidden rounded-sm border border-line bg-paper">
      <table className="w-full text-sm">
        <thead className="border-b border-line bg-sunk text-left text-xs uppercase tracking-wide text-ink-soft">
          <tr>
            <th className="px-4 py-3 font-medium">Date</th>
            <th className="px-4 py-3 text-right font-medium">VNC</th>
            <th className="px-4 py-3 text-right font-medium">{recoverableLabel}</th>
            <th className="px-4 py-3 text-right font-medium">Dépréciation</th>
          </tr>
        </thead>
        <tbody>
          {loading && (
            <tr>
              <td colSpan={4} className="px-4 py-8 text-center text-ink-soft">
                Chargement…
              </td>
            </tr>
          )}
          {!loading && rows.length === 0 && (
            <tr>
              <td colSpan={4} className="px-4 py-8 text-center text-ink-soft">
                Aucun test enregistré.
              </td>
            </tr>
          )}
          {rows.map((r) => {
            const loss = Number(r.loss);
            return (
              <tr key={r.id} className="border-b border-line/60">
                <td className="px-4 py-3 font-mono text-xs text-ink-soft">{r.testDate}</td>
                <td className="px-4 py-3 text-right tabular-nums text-ink">{fmt(r.carrying)}</td>
                <td className="px-4 py-3 text-right tabular-nums text-ink">{fmt(r.recoverable)}</td>
                <td className="px-4 py-3 text-right">
                  <span
                    className={`inline-flex items-center gap-1 font-medium tabular-nums ${
                      loss > 0 ? 'text-critical' : 'text-ink-soft'
                    }`}
                  >
                    {loss > 0 && <TrendingDown className="h-3.5 w-3.5" aria-hidden />}
                    {fmt(r.loss)}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
