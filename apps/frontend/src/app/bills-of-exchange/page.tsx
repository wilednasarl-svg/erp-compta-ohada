'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, ScrollText } from 'lucide-react';
import { useState } from 'react';

import { AppShell } from '@/components/app-shell';
import { SyscohadaGuidancePanel } from '@/components/syscohada/syscohada-guidance-panel';
import { FormError } from '@/components/ui/form-error';
import { ApiError, api } from '@/lib/api-client';
import { useCurrentOrg } from '@/stores/auth-store';

/* ─── Types (miroir backend bills-of-exchange) ─────────────── */

type BillKind = 'receivable' | 'payable';
type BillStatus = 'issued' | 'discounted' | 'paid' | 'unpaid' | 'cancelled';
type BillEventType = 'issuance' | 'discount' | 'payment' | 'unpaid_return';

interface Bill {
  id: string;
  kind: BillKind;
  partnerAccountCode: string;
  partnerName: string;
  billNumber: string;
  issueDate: string;
  dueDate: string;
  nominalAmount: string;
  status: BillStatus;
}

interface BillEvent {
  id: string;
  eventType: BillEventType;
  eventDate: string;
  amount: string;
  netAmount: string | null;
}

interface BillDetail {
  bill: Bill;
  events: BillEvent[];
}

const KIND_LABEL: Record<BillKind, string> = {
  receivable: 'À recevoir',
  payable: 'À payer',
};
const STATUS_STYLE: Record<BillStatus, string> = {
  issued: 'border-accent bg-accent-soft text-ink',
  discounted: 'border-info bg-info-soft text-ink',
  paid: 'border-line bg-sunk text-ink-soft',
  unpaid: 'border-critical bg-critical-soft text-critical',
  cancelled: 'border-line bg-sunk text-ink-soft',
};
const EVENT_LABEL: Record<BillEventType, string> = {
  issuance: 'Émission',
  discount: 'Escompte',
  payment: 'Paiement',
  unpaid_return: 'Impayé',
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
function fmt(value: string | null): string {
  if (value === null) return '—';
  const n = Number(value);
  return Number.isFinite(n) ? new Intl.NumberFormat('fr-FR').format(n) : value;
}
const INPUT =
  'h-9 w-full rounded-sm border border-line bg-sunk px-2 text-sm text-ink outline-none focus:border-accent';

export default function BillsOfExchangePage() {
  const org = useCurrentOrg();
  const orgId = org?.id ?? '';
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const listQuery = useQuery<Bill[], ApiError>({
    queryKey: ['bills', orgId],
    queryFn: async () => api.get(`/organizations/${orgId}/bills-of-exchange`),
    enabled: orgId !== '',
  });
  const bills = listQuery.data ?? [];

  return (
    <AppShell>
      <div className="w-full animate-page-in space-y-8">
        <header>
          <p className="eyebrow">Retraitement · Effets de commerce</p>
          <h1 className="mt-2 font-display text-3xl font-medium tracking-tight text-ink">
            Effets de commerce
          </h1>
          <p className="mt-2 max-w-[64ch] text-sm text-ink-soft">
            Gérez le cycle de vie des lettres de change et billets à ordre (comptes 402/412) :
            émission, escompte, paiement et impayé — chaque transition pose son écriture
            comptable SYSCOHADA automatiquement.
          </p>
        </header>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
          <section className="space-y-4 lg:col-span-3">
            {listQuery.isError && <FormError error={listQuery.error} />}
            <div className="overflow-hidden rounded-sm border border-line bg-paper">
              <table className="w-full text-sm">
                <thead className="border-b border-line bg-sunk text-left text-xs uppercase tracking-wide text-ink-soft">
                  <tr>
                    <th className="px-4 py-3 font-medium">Effet</th>
                    <th className="px-4 py-3 font-medium">Sens</th>
                    <th className="px-4 py-3 text-right font-medium">Nominal</th>
                    <th className="px-4 py-3 font-medium">Échéance</th>
                    <th className="px-4 py-3 font-medium">Statut</th>
                  </tr>
                </thead>
                <tbody>
                  {listQuery.isLoading && (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-ink-soft">
                        Chargement…
                      </td>
                    </tr>
                  )}
                  {!listQuery.isLoading && bills.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-ink-soft">
                        Aucun effet. Émettez-en un ci-contre.
                      </td>
                    </tr>
                  )}
                  {bills.map((b) => (
                    <tr
                      key={b.id}
                      onClick={() => setSelectedId(b.id)}
                      className={`cursor-pointer border-b border-line/60 transition-colors hover:bg-sunk ${
                        selectedId === b.id ? 'bg-sunk' : ''
                      }`}
                    >
                      <td className="px-4 py-3">
                        <div className="font-medium text-ink">{b.billNumber}</div>
                        <div className="text-xs text-ink-soft">{b.partnerName}</div>
                      </td>
                      <td className="px-4 py-3 text-ink-soft">{KIND_LABEL[b.kind]}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-ink">{fmt(b.nominalAmount)}</td>
                      <td className="px-4 py-3 font-mono text-xs text-ink-soft">{b.dueDate}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center rounded-sm border px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[b.status]}`}
                        >
                          {b.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {selectedId !== null && (
              <BillDetailPanel
                orgId={orgId}
                billId={selectedId}
                onChanged={() => {
                  void qc.invalidateQueries({ queryKey: ['bills', orgId] });
                  void qc.invalidateQueries({ queryKey: ['bill', selectedId] });
                }}
              />
            )}
          </section>

          <section className="space-y-6 lg:col-span-2">
            <IssueBillForm
              orgId={orgId}
              onIssued={() => void qc.invalidateQueries({ queryKey: ['bills', orgId] })}
            />
            <SyscohadaGuidancePanel module="bills-of-exchange" />
          </section>
        </div>
      </div>
    </AppShell>
  );
}

function IssueBillForm({ orgId, onIssued }: { orgId: string; onIssued: () => void }) {
  const [kind, setKind] = useState<BillKind>('receivable');
  const [partnerAccountCode, setPac] = useState('');
  const [partnerName, setPn] = useState('');
  const [billNumber, setBn] = useState('');
  const [issueDate, setIssue] = useState(todayIso());
  const [dueDate, setDue] = useState(todayIso());
  const [nominalAmount, setNominal] = useState('');

  const mutation = useMutation<Bill, ApiError, void>({
    mutationFn: async () =>
      api.post(`/organizations/${orgId}/bills-of-exchange`, {
        kind,
        partnerAccountCode: partnerAccountCode.trim(),
        partnerName: partnerName.trim(),
        billNumber: billNumber.trim(),
        issueDate,
        dueDate,
        nominalAmount: nominalAmount.trim(),
      }),
    onSuccess: () => {
      setPac('');
      setPn('');
      setBn('');
      setNominal('');
      onIssued();
    },
  });

  const canSubmit =
    partnerAccountCode.trim() !== '' &&
    partnerName.trim() !== '' &&
    billNumber.trim() !== '' &&
    /^\d{1,15}(\.\d{1,2})?$/.test(nominalAmount.trim()) &&
    !mutation.isPending;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (canSubmit) mutation.mutate();
      }}
      className="space-y-3 rounded-sm border border-line bg-paper p-4"
    >
      <h2 className="flex items-center gap-2 font-display text-lg font-medium text-ink">
        <Plus className="h-4 w-4" aria-hidden /> Émettre un effet
      </h2>
      <label className="block space-y-1">
        <span className="text-xs text-ink-soft">Sens</span>
        <select value={kind} onChange={(e) => setKind(e.target.value as BillKind)} className={INPUT}>
          <option value="receivable">À recevoir (client)</option>
          <option value="payable">À payer (fournisseur)</option>
        </select>
      </label>
      <label className="block space-y-1">
        <span className="text-xs text-ink-soft">Compte tiers (411x / 401x)</span>
        <input value={partnerAccountCode} onChange={(e) => setPac(e.target.value)} className={`${INPUT} font-mono`} />
      </label>
      <label className="block space-y-1">
        <span className="text-xs text-ink-soft">Nom du tiers</span>
        <input value={partnerName} onChange={(e) => setPn(e.target.value)} className={INPUT} />
      </label>
      <label className="block space-y-1">
        <span className="text-xs text-ink-soft">N° de l&apos;effet</span>
        <input value={billNumber} onChange={(e) => setBn(e.target.value)} className={INPUT} />
      </label>
      <label className="block space-y-1">
        <span className="text-xs text-ink-soft">Montant nominal</span>
        <input
          value={nominalAmount}
          onChange={(e) => setNominal(e.target.value)}
          placeholder="3000000.00"
          className={`${INPUT} font-mono tabular-nums`}
        />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="block space-y-1">
          <span className="text-xs text-ink-soft">Émission</span>
          <input type="date" value={issueDate} onChange={(e) => setIssue(e.target.value)} className={INPUT} />
        </label>
        <label className="block space-y-1">
          <span className="text-xs text-ink-soft">Échéance</span>
          <input type="date" value={dueDate} onChange={(e) => setDue(e.target.value)} className={INPUT} />
        </label>
      </div>
      {mutation.isError && <FormError error={mutation.error} />}
      <button
        type="submit"
        disabled={!canSubmit}
        className="inline-flex h-9 w-full items-center justify-center rounded-sm border border-accent bg-accent-soft px-3 text-sm font-medium text-ink outline-none transition-colors hover:bg-accent-soft/70 disabled:opacity-60"
      >
        {mutation.isPending ? 'Émission…' : 'Émettre l’effet'}
      </button>
    </form>
  );
}

function BillDetailPanel({
  orgId,
  billId,
  onChanged,
}: {
  orgId: string;
  billId: string;
  onChanged: () => void;
}) {
  const detailQuery = useQuery<BillDetail, ApiError>({
    queryKey: ['bill', billId],
    queryFn: async () => api.get(`/organizations/${orgId}/bills-of-exchange/${billId}`),
    enabled: orgId !== '',
  });

  const [eventDate, setEventDate] = useState(todayIso());
  const [discountFee, setDiscountFee] = useState('');
  const [bankFee, setBankFee] = useState('');

  const refresh = () => {
    void detailQuery.refetch();
    onChanged();
  };

  const act = (path: string, body: Record<string, string>) =>
    api.post(`/organizations/${orgId}/bills-of-exchange/${billId}/${path}`, body);

  const discountMut = useMutation<unknown, ApiError, void>({
    mutationFn: async () => act('discount', { eventDate, discountFee: discountFee.trim(), bankFee: bankFee.trim() }),
    onSuccess: () => {
      setDiscountFee('');
      setBankFee('');
      refresh();
    },
  });
  const settleMut = useMutation<unknown, ApiError, void>({
    mutationFn: async () => act('settle', { eventDate }),
    onSuccess: refresh,
  });
  const unpaidMut = useMutation<unknown, ApiError, void>({
    mutationFn: async () => act('mark-unpaid', { eventDate }),
    onSuccess: refresh,
  });

  const detail = detailQuery.data;
  const bill = detail?.bill;
  const isActive = bill?.status === 'issued' || bill?.status === 'discounted';
  const canDiscount = bill?.kind === 'receivable' && bill?.status === 'issued';
  const canUnpaid = bill?.kind === 'receivable' && isActive;

  return (
    <div className="rounded-sm border border-line bg-paper p-4">
      <h2 className="mb-3 font-display text-lg font-medium text-ink">
        {bill ? `Effet ${bill.billNumber}` : 'Effet'}
      </h2>
      {bill && (
        <div className="mb-3 flex flex-wrap gap-4 text-sm text-ink-soft">
          <span>Nominal : <span className="font-medium text-ink">{fmt(bill.nominalAmount)}</span></span>
          <span>Échéance : {bill.dueDate}</span>
          <span>Statut : {bill.status}</span>
        </div>
      )}

      {isActive && (
        <div className="mb-4 space-y-2">
          <div className="flex flex-wrap items-end gap-2">
            <label className="space-y-1">
              <span className="block text-[11px] text-ink-soft">Date d&apos;événement</span>
              <input type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} className={INPUT} />
            </label>
            <button
              type="button"
              onClick={() => settleMut.mutate()}
              disabled={settleMut.isPending}
              className="h-9 rounded-sm border border-accent bg-accent-soft px-3 text-sm font-medium text-ink outline-none transition-colors hover:bg-accent-soft/70 disabled:opacity-60"
            >
              Encaisser / Payer
            </button>
            {canUnpaid && (
              <button
                type="button"
                onClick={() => unpaidMut.mutate()}
                disabled={unpaidMut.isPending}
                className="h-9 rounded-sm border border-critical px-3 text-sm font-medium text-critical outline-none transition-colors hover:bg-critical-soft disabled:opacity-60"
              >
                Impayé
              </button>
            )}
          </div>
          {canDiscount && (
            <div className="flex flex-wrap items-end gap-2 border-t border-line/60 pt-2">
              <label className="space-y-1">
                <span className="block text-[11px] text-ink-soft">Agios (6745)</span>
                <input value={discountFee} onChange={(e) => setDiscountFee(e.target.value)} placeholder="0.00" className={`${INPUT} w-28 font-mono`} />
              </label>
              <label className="space-y-1">
                <span className="block text-[11px] text-ink-soft">Frais (6312)</span>
                <input value={bankFee} onChange={(e) => setBankFee(e.target.value)} placeholder="0.00" className={`${INPUT} w-28 font-mono`} />
              </label>
              <button
                type="button"
                onClick={() => discountMut.mutate()}
                disabled={discountMut.isPending || !/^\d{1,15}(\.\d{1,2})?$/.test(discountFee.trim()) || !/^\d{1,15}(\.\d{1,2})?$/.test(bankFee.trim())}
                className="h-9 rounded-sm border border-accent bg-accent-soft px-3 text-sm font-medium text-ink outline-none transition-colors hover:bg-accent-soft/70 disabled:opacity-60"
              >
                Escompter
              </button>
            </div>
          )}
        </div>
      )}
      {discountMut.isError && <FormError error={discountMut.error} />}
      {settleMut.isError && <FormError error={settleMut.error} />}
      {unpaidMut.isError && <FormError error={unpaidMut.error} />}

      <div className="overflow-hidden rounded-sm border border-line">
        <table className="w-full text-sm">
          <thead className="border-b border-line bg-sunk text-left text-xs uppercase tracking-wide text-ink-soft">
            <tr>
              <th className="px-3 py-2 font-medium">Événement</th>
              <th className="px-3 py-2 text-right font-medium">Montant</th>
              <th className="px-3 py-2 font-medium">Date</th>
            </tr>
          </thead>
          <tbody>
            {(detail?.events ?? []).map((ev) => (
              <tr key={ev.id} className="border-b border-line/60">
                <td className="px-3 py-2">
                  <span className="inline-flex items-center gap-2">
                    <ScrollText className="h-3.5 w-3.5 text-ink-soft" aria-hidden />
                    {EVENT_LABEL[ev.eventType]}
                  </span>
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-ink">{fmt(ev.netAmount ?? ev.amount)}</td>
                <td className="px-3 py-2 font-mono text-xs text-ink-soft">{ev.eventDate}</td>
              </tr>
            ))}
            {detail && detail.events.length === 0 && (
              <tr>
                <td colSpan={3} className="px-3 py-4 text-center text-ink-soft">
                  Aucun événement.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
