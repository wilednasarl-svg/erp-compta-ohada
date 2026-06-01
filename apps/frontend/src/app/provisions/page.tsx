'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, ShieldCheck } from 'lucide-react';
import { useState } from 'react';

import { AppShell } from '@/components/app-shell';
import { FormError } from '@/components/ui/form-error';
import { ApiError, api } from '@/lib/api-client';
import { useCurrentOrg } from '@/stores/auth-store';

/* ─── Types (miroir backend provisions) ─────────────────────── */

type ProvisionStatus = 'active' | 'cancelled' | 'closed';
type ProvisionType =
  | 'litige'
  | 'garantie'
  | 'restructuration'
  | 'demantelement'
  | 'retraite'
  | 'perte_change';
type MovementKind = 'dotation' | 'reprise' | 'utilization';

interface Provision {
  id: string;
  type: ProvisionType;
  accountCode: string;
  label: string;
  initialAmount: string;
  currentAmount: string;
  status: ProvisionStatus;
}

interface Movement {
  id: string;
  kind: MovementKind;
  amount: string;
  effectiveDate: string;
  note: string | null;
}

interface ProvisionDetail {
  provision: Provision;
  movements: Movement[];
}

const TYPE_LABEL: Record<ProvisionType, string> = {
  litige: 'Litige',
  garantie: 'Garantie',
  restructuration: 'Restructuration',
  demantelement: 'Démantèlement',
  retraite: 'Retraite',
  perte_change: 'Perte de change',
};

const STATUS_STYLE: Record<ProvisionStatus, string> = {
  active: 'border-accent bg-accent-soft text-ink',
  closed: 'border-line bg-sunk text-ink-soft',
  cancelled: 'border-critical bg-critical-soft text-critical',
};

const KIND_LABEL: Record<MovementKind, string> = {
  dotation: 'Dotation',
  reprise: 'Reprise',
  utilization: 'Utilisation',
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

export default function ProvisionsPage() {
  const org = useCurrentOrg();
  const orgId = org?.id ?? '';
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const listQuery = useQuery<Provision[], ApiError>({
    queryKey: ['provisions', orgId],
    queryFn: async () => api.get(`/organizations/${orgId}/provisions`),
    enabled: orgId !== '',
  });

  const provisions = listQuery.data ?? [];

  return (
    <AppShell>
      <div className="w-full animate-page-in space-y-8">
        <header>
          <p className="eyebrow">Retraitement · Provisions</p>
          <h1 className="mt-2 font-display text-3xl font-medium tracking-tight text-ink">
            Provisions pour risques &amp; charges
          </h1>
          <p className="mt-2 max-w-[64ch] text-sm text-ink-soft">
            Constituez vos provisions SYSCOHADA (classe 19), suivez leur solde et passez les
            dotations, reprises et utilisations — les écritures comptables sont posées
            automatiquement.
          </p>
        </header>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
          <section className="space-y-4 lg:col-span-3">
            {listQuery.isError && <FormError error={listQuery.error} />}
            <div className="overflow-hidden rounded-sm border border-line bg-paper">
              <table className="w-full text-sm">
                <thead className="border-b border-line bg-sunk text-left text-xs uppercase tracking-wide text-ink-soft">
                  <tr>
                    <th className="px-4 py-3 font-medium">Provision</th>
                    <th className="px-4 py-3 font-medium">Type</th>
                    <th className="px-4 py-3 text-right font-medium">Solde</th>
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
                  {!listQuery.isLoading && provisions.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-4 py-8 text-center text-ink-soft">
                        Aucune provision. Créez-en une ci-contre.
                      </td>
                    </tr>
                  )}
                  {provisions.map((p) => (
                    <tr
                      key={p.id}
                      onClick={() => setSelectedId(p.id)}
                      className={`cursor-pointer border-b border-line/60 transition-colors hover:bg-sunk ${
                        selectedId === p.id ? 'bg-sunk' : ''
                      }`}
                    >
                      <td className="px-4 py-3">
                        <div className="font-medium text-ink">{p.label}</div>
                        <div className="font-mono text-xs text-ink-soft">{p.accountCode}</div>
                      </td>
                      <td className="px-4 py-3 text-ink-soft">{TYPE_LABEL[p.type]}</td>
                      <td className="px-4 py-3 text-right font-medium tabular-nums text-ink">
                        {fmt(p.currentAmount)}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center rounded-sm border px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[p.status]}`}
                        >
                          {p.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {selectedId !== null && (
              <ProvisionDetailPanel
                orgId={orgId}
                provisionId={selectedId}
                onChanged={() => {
                  void qc.invalidateQueries({ queryKey: ['provisions', orgId] });
                  void qc.invalidateQueries({ queryKey: ['provision', selectedId] });
                }}
              />
            )}
          </section>

          <section className="lg:col-span-2">
            <CreateProvisionForm
              orgId={orgId}
              onCreated={() => void qc.invalidateQueries({ queryKey: ['provisions', orgId] })}
            />
          </section>
        </div>
      </div>
    </AppShell>
  );
}

function CreateProvisionForm({ orgId, onCreated }: { orgId: string; onCreated: () => void }) {
  const [type, setType] = useState<ProvisionType>('litige');
  const [label, setLabel] = useState('');
  const [initialAmount, setInitialAmount] = useState('');
  const [effectiveDate, setEffectiveDate] = useState(todayIso());
  const [note, setNote] = useState('');

  const mutation = useMutation<Provision, ApiError, void>({
    mutationFn: async () =>
      api.post(`/organizations/${orgId}/provisions`, {
        type,
        label: label.trim(),
        initialAmount: initialAmount.trim(),
        effectiveDate,
        note: note.trim() === '' ? undefined : note.trim(),
      }),
    onSuccess: () => {
      setLabel('');
      setInitialAmount('');
      setNote('');
      onCreated();
    },
  });

  const canSubmit =
    label.trim() !== '' && /^\d{1,15}(\.\d{1,2})?$/.test(initialAmount.trim()) && !mutation.isPending;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (canSubmit) mutation.mutate();
      }}
      className="space-y-3 rounded-sm border border-line bg-paper p-4"
    >
      <h2 className="flex items-center gap-2 font-display text-lg font-medium text-ink">
        <Plus className="h-4 w-4" aria-hidden /> Nouvelle provision
      </h2>
      <label className="block space-y-1">
        <span className="text-xs text-ink-soft">Type</span>
        <select value={type} onChange={(e) => setType(e.target.value as ProvisionType)} className={INPUT}>
          {(Object.keys(TYPE_LABEL) as ProvisionType[]).map((t) => (
            <option key={t} value={t}>
              {TYPE_LABEL[t]}
            </option>
          ))}
        </select>
      </label>
      <label className="block space-y-1">
        <span className="text-xs text-ink-soft">Libellé</span>
        <input value={label} onChange={(e) => setLabel(e.target.value)} className={INPUT} />
      </label>
      <label className="block space-y-1">
        <span className="text-xs text-ink-soft">Montant initial</span>
        <input
          value={initialAmount}
          onChange={(e) => setInitialAmount(e.target.value)}
          placeholder="5000000.00"
          className={`${INPUT} font-mono tabular-nums`}
        />
      </label>
      <label className="block space-y-1">
        <span className="text-xs text-ink-soft">Date d&apos;effet</span>
        <input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} className={INPUT} />
      </label>
      <label className="block space-y-1">
        <span className="text-xs text-ink-soft">Note (optionnel)</span>
        <input value={note} onChange={(e) => setNote(e.target.value)} className={INPUT} />
      </label>
      {mutation.isError && <FormError error={mutation.error} />}
      <button
        type="submit"
        disabled={!canSubmit}
        className="inline-flex h-9 w-full items-center justify-center rounded-sm border border-accent bg-accent-soft px-3 text-sm font-medium text-ink outline-none transition-colors hover:bg-accent-soft/70 disabled:opacity-60"
      >
        {mutation.isPending ? 'Création…' : 'Créer la provision'}
      </button>
    </form>
  );
}

function ProvisionDetailPanel({
  orgId,
  provisionId,
  onChanged,
}: {
  orgId: string;
  provisionId: string;
  onChanged: () => void;
}) {
  const detailQuery = useQuery<ProvisionDetail, ApiError>({
    queryKey: ['provision', provisionId],
    queryFn: async () => api.get(`/organizations/${orgId}/provisions/${provisionId}`),
    enabled: orgId !== '',
  });

  const [kind, setKind] = useState<MovementKind>('reprise');
  const [amount, setAmount] = useState('');
  const [effectiveDate, setEffectiveDate] = useState(todayIso());

  const movementMutation = useMutation<unknown, ApiError, void>({
    mutationFn: async () =>
      api.post(`/organizations/${orgId}/provisions/${provisionId}/${kind}`, {
        amount: amount.trim(),
        effectiveDate,
      }),
    onSuccess: () => {
      setAmount('');
      void detailQuery.refetch();
      onChanged();
    },
  });

  const detail = detailQuery.data;
  const canSubmit = /^\d{1,15}(\.\d{1,2})?$/.test(amount.trim()) && !movementMutation.isPending;

  return (
    <div className="rounded-sm border border-line bg-paper p-4">
      <h2 className="mb-3 font-display text-lg font-medium text-ink">
        {detail ? detail.provision.label : 'Provision'}
      </h2>
      {detail && (
        <div className="mb-3 flex flex-wrap gap-4 text-sm">
          <span className="text-ink-soft">
            Solde : <span className="font-medium text-ink">{fmt(detail.provision.currentAmount)}</span>
          </span>
          <span className="text-ink-soft">
            Initial : <span className="text-ink">{fmt(detail.provision.initialAmount)}</span>
          </span>
        </div>
      )}

      {detail?.provision.status === 'active' && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (canSubmit) movementMutation.mutate();
          }}
          className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-4"
        >
          <select value={kind} onChange={(e) => setKind(e.target.value as MovementKind)} className={INPUT}>
            <option value="dotation">Dotation</option>
            <option value="reprise">Reprise</option>
            <option value="utilization">Utilisation</option>
          </select>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="Montant"
            className={`${INPUT} font-mono tabular-nums`}
          />
          <input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} className={INPUT} />
          <button
            type="submit"
            disabled={!canSubmit}
            className="inline-flex h-9 items-center justify-center rounded-sm border border-accent bg-accent-soft px-3 text-sm font-medium text-ink outline-none transition-colors hover:bg-accent-soft/70 disabled:opacity-60"
          >
            {movementMutation.isPending ? '…' : 'Passer'}
          </button>
        </form>
      )}
      {movementMutation.isError && <FormError error={movementMutation.error} />}

      <div className="overflow-hidden rounded-sm border border-line">
        <table className="w-full text-sm">
          <thead className="border-b border-line bg-sunk text-left text-xs uppercase tracking-wide text-ink-soft">
            <tr>
              <th className="px-3 py-2 font-medium">Mouvement</th>
              <th className="px-3 py-2 text-right font-medium">Montant</th>
              <th className="px-3 py-2 font-medium">Date</th>
            </tr>
          </thead>
          <tbody>
            {(detail?.movements ?? []).map((m) => (
              <tr key={m.id} className="border-b border-line/60">
                <td className="px-3 py-2">
                  <span className="inline-flex items-center gap-2">
                    <ShieldCheck className="h-3.5 w-3.5 text-ink-soft" aria-hidden />
                    {KIND_LABEL[m.kind]}
                  </span>
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-ink">{fmt(m.amount)}</td>
                <td className="px-3 py-2 font-mono text-xs text-ink-soft">{m.effectiveDate}</td>
              </tr>
            ))}
            {detail && detail.movements.length === 0 && (
              <tr>
                <td colSpan={3} className="px-3 py-4 text-center text-ink-soft">
                  Aucun mouvement.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
