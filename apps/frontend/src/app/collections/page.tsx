'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { Download, Mail, Loader2, Copy, Check } from 'lucide-react';
import { useState } from 'react';

import { AppShell } from '@/components/app-shell';
import { FormError } from '@/components/ui/form-error';
import { ApiError, api } from '@/lib/api-client';
import { useCurrentOrg } from '@/stores/auth-store';

/* ─── Types (miroir backend collections) ─────────────────────── */

type DunningLevel = 'none' | 'reminder' | 'first' | 'second' | 'formal_notice';

interface DunningCandidate {
  partnerAccountId: string;
  partnerCode: string;
  partnerLabel: string;
  totalOpen: string;
  totalOverdue: string;
  maxOverdueDays: number;
  level: DunningLevel;
  levelLabel: string;
  invoiceCount: number;
  overdueInvoiceCount: number;
}

interface DunningCandidatesResponse {
  referenceDate: string;
  candidates: DunningCandidate[];
}

interface DunningLetter {
  subject: string;
  body: string;
}

const LEVEL_STYLE: Record<DunningLevel, string> = {
  none: 'border-line text-ink-soft',
  reminder: 'border-info bg-info-soft text-ink',
  first: 'border-warn bg-warn-soft text-ink',
  second: 'border-critical-soft bg-critical-soft text-ink',
  formal_notice: 'border-critical bg-critical-soft text-critical',
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatAmount(value: string): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(n);
}

export default function CollectionsPage() {
  const currentOrg = useCurrentOrg();
  const orgId = currentOrg?.id ?? '';

  const [referenceDate, setReferenceDate] = useState<string>(todayIso());
  const [selected, setSelected] = useState<DunningCandidate | null>(null);
  const [copied, setCopied] = useState(false);

  const candidatesQuery = useQuery<DunningCandidatesResponse, ApiError>({
    queryKey: ['dunning-candidates', orgId, referenceDate],
    queryFn: async () =>
      api.get(`/organizations/${orgId}/collections/candidates?referenceDate=${referenceDate}`),
    enabled: orgId !== '',
  });

  const letterMutation = useMutation<DunningLetter, ApiError, DunningCandidate>({
    mutationFn: async (candidate) =>
      api.get(
        `/organizations/${orgId}/collections/${candidate.partnerAccountId}/letter?referenceDate=${referenceDate}`,
      ),
    onSuccess: () => setCopied(false),
  });

  const candidates = candidatesQuery.data?.candidates ?? [];

  const exportCsv = () => {
    void api.download(
      `/organizations/${orgId}/collections/receivables.csv?referenceDate=${referenceDate}&overdueOnly=true`,
      `creances-clients-${referenceDate}.csv`,
    );
  };

  const openLetter = (candidate: DunningCandidate) => {
    setSelected(candidate);
    letterMutation.mutate(candidate);
  };

  const copyLetter = async () => {
    if (letterMutation.data === undefined) return;
    await navigator.clipboard.writeText(letterMutation.data.body);
    setCopied(true);
  };

  return (
    <AppShell>
      <div className="w-full animate-page-in space-y-8">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="eyebrow">Trésorerie · Recouvrement</p>
            <h1 className="mt-2 font-display text-3xl font-medium tracking-tight text-ink">
              Relances clients
            </h1>
            <p className="mt-2 max-w-[64ch] text-sm text-ink-soft">
              Identifiez les clients dont les créances sont échues, générez une lettre de
              relance adaptée au retard, et exportez le détail des créances ouvertes.
            </p>
          </div>
          <div className="flex flex-col items-stretch gap-2 sm:items-end">
            <label className="flex items-center gap-2 text-sm text-ink-soft">
              <span>Date de référence</span>
              <input
                type="date"
                value={referenceDate}
                onChange={(e) => setReferenceDate(e.target.value || todayIso())}
                className="h-9 rounded-sm border border-line bg-paper px-3 text-sm text-ink outline-none focus:border-accent"
              />
            </label>
            <button
              type="button"
              onClick={exportCsv}
              disabled={orgId === ''}
              className="inline-flex h-9 items-center justify-center gap-2 rounded-sm border border-line bg-paper px-3 text-sm font-medium text-ink outline-none transition-colors hover:border-accent disabled:opacity-60"
            >
              <Download className="h-4 w-4" aria-hidden />
              Exporter les créances (CSV)
            </button>
          </div>
        </header>

        {candidatesQuery.isError && <FormError error={candidatesQuery.error} />}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
          {/* Liste des clients à relancer */}
          <section className="lg:col-span-3">
            <div className="overflow-hidden rounded-sm border border-line bg-paper">
              <table className="w-full text-sm">
                <thead className="border-b border-line bg-sunk text-left text-xs uppercase tracking-wide text-ink-soft">
                  <tr>
                    <th className="px-4 py-3 font-medium">Client</th>
                    <th className="px-4 py-3 font-medium">Palier</th>
                    <th className="px-4 py-3 text-right font-medium">Échu</th>
                    <th className="px-4 py-3 text-right font-medium">Retard</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {candidatesQuery.isLoading && (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-ink-soft">
                        Chargement…
                      </td>
                    </tr>
                  )}
                  {!candidatesQuery.isLoading && candidates.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-ink-soft">
                        Aucun client à relancer à cette date. 🎉
                      </td>
                    </tr>
                  )}
                  {candidates.map((c) => (
                    <tr
                      key={c.partnerAccountId}
                      className={`border-b border-line/60 transition-colors hover:bg-sunk ${
                        selected?.partnerAccountId === c.partnerAccountId ? 'bg-sunk' : ''
                      }`}
                    >
                      <td className="px-4 py-3">
                        <div className="font-medium text-ink">{c.partnerLabel}</div>
                        <div className="text-xs text-ink-soft">
                          {c.overdueInvoiceCount} facture(s) échue(s)
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center rounded-sm border px-2 py-0.5 text-xs font-medium ${LEVEL_STYLE[c.level]}`}
                        >
                          {c.levelLabel}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-medium tabular-nums text-ink">
                        {formatAmount(c.totalOverdue)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-ink-soft">
                        {c.maxOverdueDays} j
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => openLetter(c)}
                          className="inline-flex items-center gap-1.5 rounded-sm border border-line px-2.5 py-1 text-xs font-medium text-ink outline-none transition-colors hover:border-accent"
                        >
                          <Mail className="h-3.5 w-3.5" aria-hidden />
                          Lettre
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Aperçu de la lettre de relance */}
          <section className="lg:col-span-2">
            <div className="rounded-sm border border-line bg-paper p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-display text-lg font-medium text-ink">Lettre de relance</h2>
                {letterMutation.data !== undefined && (
                  <button
                    type="button"
                    onClick={() => void copyLetter()}
                    className="inline-flex items-center gap-1.5 rounded-sm border border-line px-2.5 py-1 text-xs font-medium text-ink outline-none transition-colors hover:border-accent"
                  >
                    {copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
                    {copied ? 'Copié' : 'Copier'}
                  </button>
                )}
              </div>

              {selected === null && (
                <p className="text-sm text-ink-soft">
                  Sélectionnez un client pour générer sa lettre de relance.
                </p>
              )}
              {letterMutation.isPending && (
                <p className="flex items-center gap-2 text-sm text-ink-soft">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Génération…
                </p>
              )}
              {letterMutation.isError && <FormError error={letterMutation.error} />}
              {letterMutation.data !== undefined && (
                <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-sm bg-sunk p-3 font-mono text-xs leading-relaxed text-ink">
                  {letterMutation.data.body}
                </pre>
              )}
            </div>
          </section>
        </div>
      </div>
    </AppShell>
  );
}
