'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, HandCoins } from 'lucide-react';
import { useState } from 'react';

import { AppShell } from '@/components/app-shell';
import { FormError } from '@/components/ui/form-error';
import { ApiError, api } from '@/lib/api-client';
import { useCurrentOrg } from '@/stores/auth-store';

/* ─── Types (miroir backend subsidies) ─────────────────────── */

type ReleaseMethod = 'on_depreciation' | 'linear_10y' | 'manual';
type SubsidyStatus = 'active' | 'fully_released' | 'cancelled';

interface Subsidy {
  id: string;
  grantorName: string;
  grantDate: string;
  totalAmount: string;
  releasedAmount: string;
  releaseMethod: ReleaseMethod;
  status: SubsidyStatus;
}

interface Release {
  id: string;
  releaseDate: string;
  amount: string;
}

interface SubsidyDetail {
  subsidy: Subsidy;
  releases: Release[];
}

const METHOD_LABEL: Record<ReleaseMethod, string> = {
  on_depreciation: 'Sur amortissement',
  linear_10y: 'Linéaire 10 ans',
  manual: 'Manuelle',
};

const STATUS_STYLE: Record<SubsidyStatus, string> = {
  active: 'border-accent bg-accent-soft text-ink',
  fully_released: 'border-line bg-sunk text-ink-soft',
  cancelled: 'border-critical bg-critical-soft text-critical',
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
function fmt(value: string): string {
  const n = Number(value);
  return Number.isFinite(n) ? new Intl.NumberFormat('fr-FR').format(n) : value;
}
const INPUT =
  'h-9 w-full rounded-sm border border-line bg-sunk px-2 text-sm text-ink outline-none focus:border-accent';

export default function SubsidiesPage() {
  const org = useCurrentOrg();
  const orgId = org?.id ?? '';
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const listQuery = useQuery<Subsidy[], ApiError>({
    queryKey: ['subsidies', orgId],
    queryFn: async () => api.get(`/organizations/${orgId}/subsidies`),
    enabled: orgId !== '',
  });

  const subsidies = listQuery.data ?? [];

  return (
    <AppShell>
      <div className="w-full animate-page-in space-y-8">
        <header>
          <p className="eyebrow">Référentiel · Financement</p>
          <h1 className="mt-2 font-display text-3xl font-medium tracking-tight text-ink">
            Subventions d&apos;investissement
          </h1>
          <p className="mt-2 max-w-[64ch] text-sm text-ink-soft">
            Enregistrez les subventions reçues (compte 1411) et pilotez leur reprise au résultat
            (compte 799) — par amortissement, linéaire sur 10 ans, ou manuelle. Les écritures
            d&apos;octroi et de reprise sont posées automatiquement.
          </p>
        </header>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
          <section className="space-y-4 lg:col-span-3">
            {listQuery.isError && <FormError error={listQuery.error} />}
            <div className="overflow-hidden rounded-sm border border-line bg-paper">
              <table className="w-full text-sm">
                <thead className="border-b border-line bg-sunk text-left text-xs uppercase tracking-wide text-ink-soft">
                  <tr>
                    <th className="px-4 py-3 font-medium">Bailleur</th>
                    <th className="px-4 py-3 font-medium">Reprise</th>
                    <th className="px-4 py-3 text-right font-medium">Repris / Total</th>
                    <th className="px-4 py-3 font-medium">Statut</th>
                  </tr>
                </thead>
                <tbody>
                  {listQuery.isLoading && (
                    <tr>
                      <td colSpan={4} className="px-4 py-8 text-center text-ink-soft">
                        Chargement…
                      </td>
                    </tr>
                  )}
                  {!listQuery.isLoading && subsidies.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-4 py-8 text-center text-ink-soft">
                        Aucune subvention. Créez-en une ci-contre.
                      </td>
                    </tr>
                  )}
                  {subsidies.map((s) => (
                    <tr
                      key={s.id}
                      onClick={() => setSelectedId(s.id)}
                      className={`cursor-pointer border-b border-line/60 transition-colors hover:bg-sunk ${
                        selectedId === s.id ? 'bg-sunk' : ''
                      }`}
                    >
                      <td className="px-4 py-3">
                        <div className="font-medium text-ink">{s.grantorName}</div>
                        <div className="font-mono text-xs text-ink-soft">{s.grantDate}</div>
                      </td>
                      <td className="px-4 py-3 text-ink-soft">{METHOD_LABEL[s.releaseMethod]}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-ink">
                        {fmt(s.releasedAmount)} / {fmt(s.totalAmount)}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center rounded-sm border px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[s.status]}`}
                        >
                          {s.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {selectedId !== null && (
              <SubsidyDetailPanel
                orgId={orgId}
                subsidyId={selectedId}
                onChanged={() => {
                  void qc.invalidateQueries({ queryKey: ['subsidies', orgId] });
                  void qc.invalidateQueries({ queryKey: ['subsidy', selectedId] });
                }}
              />
            )}
          </section>

          <section className="lg:col-span-2">
            <CreateSubsidyForm
              orgId={orgId}
              onCreated={() => void qc.invalidateQueries({ queryKey: ['subsidies', orgId] })}
            />
          </section>
        </div>
      </div>
    </AppShell>
  );
}

function CreateSubsidyForm({ orgId, onCreated }: { orgId: string; onCreated: () => void }) {
  const [grantorName, setGrantor] = useState('');
  const [grantDate, setGrantDate] = useState(todayIso());
  const [totalAmount, setTotal] = useState('');
  const [releaseMethod, setMethod] = useState<ReleaseMethod>('on_depreciation');

  const mutation = useMutation<Subsidy, ApiError, void>({
    mutationFn: async () =>
      api.post(`/organizations/${orgId}/subsidies`, {
        grantorName: grantorName.trim(),
        grantDate,
        totalAmount: totalAmount.trim(),
        releaseMethod,
      }),
    onSuccess: () => {
      setGrantor('');
      setTotal('');
      onCreated();
    },
  });

  const canSubmit =
    grantorName.trim() !== '' && /^\d{1,15}(\.\d{1,2})?$/.test(totalAmount.trim()) && !mutation.isPending;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (canSubmit) mutation.mutate();
      }}
      className="space-y-3 rounded-sm border border-line bg-paper p-4"
    >
      <h2 className="flex items-center gap-2 font-display text-lg font-medium text-ink">
        <Plus className="h-4 w-4" aria-hidden /> Nouvelle subvention
      </h2>
      <label className="block space-y-1">
        <span className="text-xs text-ink-soft">Bailleur</span>
        <input value={grantorName} onChange={(e) => setGrantor(e.target.value)} className={INPUT} />
      </label>
      <label className="block space-y-1">
        <span className="text-xs text-ink-soft">Montant octroyé</span>
        <input
          value={totalAmount}
          onChange={(e) => setTotal(e.target.value)}
          placeholder="20000000.00"
          className={`${INPUT} font-mono tabular-nums`}
        />
      </label>
      <label className="block space-y-1">
        <span className="text-xs text-ink-soft">Méthode de reprise</span>
        <select value={releaseMethod} onChange={(e) => setMethod(e.target.value as ReleaseMethod)} className={INPUT}>
          {(Object.keys(METHOD_LABEL) as ReleaseMethod[]).map((m) => (
            <option key={m} value={m}>
              {METHOD_LABEL[m]}
            </option>
          ))}
        </select>
      </label>
      <label className="block space-y-1">
        <span className="text-xs text-ink-soft">Date d&apos;octroi</span>
        <input type="date" value={grantDate} onChange={(e) => setGrantDate(e.target.value)} className={INPUT} />
      </label>
      {mutation.isError && <FormError error={mutation.error} />}
      <button
        type="submit"
        disabled={!canSubmit}
        className="inline-flex h-9 w-full items-center justify-center rounded-sm border border-accent bg-accent-soft px-3 text-sm font-medium text-ink outline-none transition-colors hover:bg-accent-soft/70 disabled:opacity-60"
      >
        {mutation.isPending ? 'Création…' : 'Enregistrer la subvention'}
      </button>
    </form>
  );
}

function SubsidyDetailPanel({
  orgId,
  subsidyId,
  onChanged,
}: {
  orgId: string;
  subsidyId: string;
  onChanged: () => void;
}) {
  const detailQuery = useQuery<SubsidyDetail, ApiError>({
    queryKey: ['subsidy', subsidyId],
    queryFn: async () => api.get(`/organizations/${orgId}/subsidies/${subsidyId}`),
    enabled: orgId !== '',
  });

  const [amount, setAmount] = useState('');
  const [releaseDate, setReleaseDate] = useState(todayIso());

  const refresh = () => {
    void detailQuery.refetch();
    onChanged();
  };

  const manualRelease = useMutation<unknown, ApiError, void>({
    mutationFn: async () =>
      api.post(`/organizations/${orgId}/subsidies/${subsidyId}/release-manual`, {
        amount: amount.trim(),
        releaseDate,
      }),
    onSuccess: () => {
      setAmount('');
      refresh();
    },
  });

  const cancelMut = useMutation<unknown, ApiError, void>({
    mutationFn: async () => api.post(`/organizations/${orgId}/subsidies/${subsidyId}/cancel`, {}),
    onSuccess: refresh,
  });

  const detail = detailQuery.data;
  const subsidy = detail?.subsidy;
  const canRelease = /^\d{1,15}(\.\d{1,2})?$/.test(amount.trim()) && !manualRelease.isPending;

  return (
    <div className="rounded-sm border border-line bg-paper p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-lg font-medium text-ink">
          {subsidy ? subsidy.grantorName : 'Subvention'}
        </h2>
        {subsidy?.status === 'active' && (
          <button
            type="button"
            onClick={() => cancelMut.mutate()}
            disabled={cancelMut.isPending}
            className="rounded-sm border border-critical px-2.5 py-1 text-xs font-medium text-critical outline-none transition-colors hover:bg-critical-soft disabled:opacity-60"
          >
            Annuler
          </button>
        )}
      </div>

      {subsidy && (
        <div className="mb-3 flex flex-wrap gap-4 text-sm">
          <span className="text-ink-soft">
            Repris : <span className="font-medium text-ink">{fmt(subsidy.releasedAmount)}</span> /{' '}
            {fmt(subsidy.totalAmount)}
          </span>
          <span className="text-ink-soft">Méthode : {METHOD_LABEL[subsidy.releaseMethod]}</span>
        </div>
      )}

      {subsidy?.status === 'active' && subsidy.releaseMethod === 'manual' && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (canRelease) manualRelease.mutate();
          }}
          className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-3"
        >
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="Montant à reprendre"
            className={`${INPUT} font-mono tabular-nums`}
          />
          <input type="date" value={releaseDate} onChange={(e) => setReleaseDate(e.target.value)} className={INPUT} />
          <button
            type="submit"
            disabled={!canRelease}
            className="inline-flex h-9 items-center justify-center rounded-sm border border-accent bg-accent-soft px-3 text-sm font-medium text-ink outline-none transition-colors hover:bg-accent-soft/70 disabled:opacity-60"
          >
            {manualRelease.isPending ? '…' : 'Reprendre'}
          </button>
        </form>
      )}
      {manualRelease.isError && <FormError error={manualRelease.error} />}
      {cancelMut.isError && <FormError error={cancelMut.error} />}

      <div className="overflow-hidden rounded-sm border border-line">
        <table className="w-full text-sm">
          <thead className="border-b border-line bg-sunk text-left text-xs uppercase tracking-wide text-ink-soft">
            <tr>
              <th className="px-3 py-2 font-medium">Reprise</th>
              <th className="px-3 py-2 text-right font-medium">Montant</th>
              <th className="px-3 py-2 font-medium">Date</th>
            </tr>
          </thead>
          <tbody>
            {(detail?.releases ?? []).map((r) => (
              <tr key={r.id} className="border-b border-line/60">
                <td className="px-3 py-2">
                  <span className="inline-flex items-center gap-2">
                    <HandCoins className="h-3.5 w-3.5 text-ink-soft" aria-hidden />
                    Reprise
                  </span>
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-ink">{fmt(r.amount)}</td>
                <td className="px-3 py-2 font-mono text-xs text-ink-soft">{r.releaseDate}</td>
              </tr>
            ))}
            {detail && detail.releases.length === 0 && (
              <tr>
                <td colSpan={3} className="px-3 py-4 text-center text-ink-soft">
                  Aucune reprise.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
