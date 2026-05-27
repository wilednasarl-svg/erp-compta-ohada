'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Calculator, CheckCircle2, Loader2, Plus, RotateCcw, X } from 'lucide-react';
import { useState } from 'react';

import { AppShell } from '@/components/app-shell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FormError } from '@/components/ui/form-error';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useApiMutation } from '@/hooks/use-api-mutation';
import { ApiError, api } from '@/lib/api-client';
import type {
  ListTvaCodes,
  ListTvaDeclarations,
  TvaCode,
  TvaCodeKind,
  TvaCodeType,
  TvaDeclaration,
  TvaDeclarationEnvelope,
  TvaDeclarationLine,
  TvaDeclarationStatus,
} from '@/lib/api/types';
import { useCurrentOrg } from '@/stores/auth-store';

export default function TvaPage() {
  const currentOrg = useCurrentOrg();
  const orgId = currentOrg?.id ?? '';
  const qc = useQueryClient();

  const codesQuery = useQuery<ReadonlyArray<TvaCode>, ApiError>({
    queryKey: ['tva', 'codes', orgId],
    queryFn: async () => {
      const data = await api.get<ListTvaCodes>(`/organizations/${orgId}/tva/codes`);
      return data.codes;
    },
    enabled: orgId !== '',
  });

  const declarationsQuery = useQuery<ReadonlyArray<TvaDeclaration>, ApiError>({
    queryKey: ['tva', 'declarations', orgId],
    queryFn: async () => {
      const data = await api.get<ListTvaDeclarations>(
        `/organizations/${orgId}/tva/declarations`,
      );
      return data.declarations;
    },
    enabled: orgId !== '',
  });

  /* ─── Create code form ──────────────────────────────────────── */
  const [codeCode, setCodeCode] = useState('');
  const [codeLabel, setCodeLabel] = useState('');
  const [codeRate, setCodeRate] = useState('');
  const [codeType, setCodeType] = useState<TvaCodeType>('both');
  const [codeKind, setCodeKind] = useState<TvaCodeKind>('normal');

  const createCode = useApiMutation(
    async () =>
      api.post(`/organizations/${orgId}/tva/codes`, {
        code: codeCode.trim().toUpperCase(),
        label: codeLabel.trim(),
        rate: codeRate.trim(),
        type: codeType,
        kind: codeKind,
        isActive: true,
      }),
    {
      onSuccess: () => {
        setCodeCode('');
        setCodeLabel('');
        setCodeRate('');
        void qc.invalidateQueries({ queryKey: ['tva', 'codes', orgId] });
      },
    },
  );

  /* ─── Compute declaration form ──────────────────────────────── */
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);

  const compute = useApiMutation(
    async () => api.post(`/organizations/${orgId}/tva/declarations`, { year, month }),
    {
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: ['tva', 'declarations', orgId] });
      },
    },
  );

  const [selectedDeclId, setSelectedDeclId] = useState<string | null>(null);

  return (
    <AppShell>
      <div className="mx-auto max-w-[1100px] animate-page-in space-y-12">
        {/* ─── Header ─────────────────────────────────────── */}
        <header>
          <p className="eyebrow mb-2">Fiscalité</p>
          <h1 className="font-display text-4xl font-medium tracking-tight text-ink">TVA</h1>
          <p className="mt-3 max-w-[64ch] text-sm leading-relaxed text-ink-soft">
            Codes TVA et déclarations mensuelles SYSCOHADA. La déclaration agrège
            automatiquement les écritures validées en collectée / déductible et calcule
            le net dû.
          </p>
        </header>

        {/* ─── Codes TVA ──────────────────────────────────── */}
        <section aria-labelledby="codes-title" className="space-y-5">
          <div className="border-b border-line pb-3">
            <h2 id="codes-title" className="font-display text-xl font-medium text-ink">
              Codes TVA
            </h2>
            <p className="mt-1 text-xs text-ink-mute">
              Référentiel des taux applicables. Par défaut OHADA : TVA-N-18 (18 %),
              TVA-EXO (0 %), TVA-EXP export (0 %).
            </p>
          </div>

          <form
            className="grid grid-cols-1 gap-3 md:grid-cols-[140px_2fr_100px_120px_140px_auto] md:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              createCode.mutate(undefined);
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="c-code">Code</Label>
              <Input
                id="c-code"
                value={codeCode}
                onChange={(e) => setCodeCode(e.target.value.toUpperCase())}
                placeholder="TVA-R-9"
                pattern="[A-Z0-9-]{1,16}"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-label">Libellé</Label>
              <Input
                id="c-label"
                value={codeLabel}
                onChange={(e) => setCodeLabel(e.target.value)}
                placeholder="TVA Réduite 9%"
                maxLength={200}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-rate">Taux %</Label>
              <Input
                id="c-rate"
                value={codeRate}
                onChange={(e) => setCodeRate(e.target.value)}
                placeholder="9.00"
                pattern="\d{1,2}(\.\d{1,2})?"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-type">Direction</Label>
              <select
                id="c-type"
                value={codeType}
                onChange={(e) => setCodeType(e.target.value as TvaCodeType)}
                className="flex h-9 w-full rounded-sm border border-line-strong bg-paper px-3 py-1 text-sm text-ink focus:border-accent focus:outline-none"
              >
                <option value="both">Vente + Achat</option>
                <option value="sales">Vente seule</option>
                <option value="purchase">Achat seul</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-kind">Nature</Label>
              <select
                id="c-kind"
                value={codeKind}
                onChange={(e) => setCodeKind(e.target.value as TvaCodeKind)}
                className="flex h-9 w-full rounded-sm border border-line-strong bg-paper px-3 py-1 text-sm text-ink focus:border-accent focus:outline-none"
              >
                <option value="normal">Normale</option>
                <option value="reduced">Réduite</option>
                <option value="exempt">Exempt</option>
                <option value="exonerated">Exonérée</option>
                <option value="export">Export</option>
              </select>
            </div>
            <Button type="submit" className="press" disabled={createCode.isPending}>
              {createCode.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Plus className="mr-2 h-4 w-4" />
              )}
              Créer
            </Button>
          </form>
          <FormError error={createCode.error} />

          {codesQuery.isLoading ? (
            <p className="py-4 text-sm text-ink-mute">Chargement…</p>
          ) : (codesQuery.data ?? []).length === 0 ? (
            <p className="py-4 text-sm text-ink-mute">Aucun code TVA défini.</p>
          ) : (
            <div className="overflow-x-auto rounded-sm border border-line">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line bg-sunk">
                    <th className="px-3 py-2.5 text-left">
                      <span className="eyebrow">Code</span>
                    </th>
                    <th className="px-3 py-2.5 text-left">
                      <span className="eyebrow">Libellé</span>
                    </th>
                    <th className="px-3 py-2.5 text-right">
                      <span className="eyebrow">Taux</span>
                    </th>
                    <th className="px-3 py-2.5 text-left">
                      <span className="eyebrow">Direction</span>
                    </th>
                    <th className="px-3 py-2.5 text-left">
                      <span className="eyebrow">Nature</span>
                    </th>
                    <th className="px-3 py-2.5 text-left">
                      <span className="eyebrow">Statut</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {(codesQuery.data ?? []).map((c, i) => (
                    <tr
                      key={c.id}
                      className={`border-b border-line last:border-0 ${
                        i % 2 === 1 ? 'bg-sunk/30' : 'bg-paper'
                      }`}
                    >
                      <td className="px-3 py-2.5 font-mono text-xs text-ink">{c.code}</td>
                      <td className="px-3 py-2.5 text-ink">{c.label}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-xs tabular-nums text-ink">
                        {Number(c.rate).toFixed(2)} %
                      </td>
                      <td className="px-3 py-2.5 text-xs text-ink-soft">{c.type}</td>
                      <td className="px-3 py-2.5 text-xs text-ink-soft">{c.kind}</td>
                      <td className="px-3 py-2.5">
                        <Badge variant={c.isActive ? 'default' : 'muted'}>
                          {c.isActive ? 'Actif' : 'Inactif'}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <FormError error={codesQuery.error} />
        </section>

        {/* ─── Déclarations ───────────────────────────────── */}
        <section aria-labelledby="decl-title" className="space-y-5">
          <div className="border-b border-line pb-3">
            <h2 id="decl-title" className="font-display text-xl font-medium text-ink">
              Déclarations mensuelles
            </h2>
            <p className="mt-1 text-xs text-ink-mute">
              Calcule la déclaration TVA pour un mois donné — agrège les écritures
              validées en collectée (ventes) et déductible (achats).
            </p>
          </div>

          <form
            className="flex flex-wrap items-end gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              compute.mutate(undefined);
            }}
          >
            <div className="w-32 space-y-1.5">
              <Label htmlFor="d-year">Année</Label>
              <Input
                id="d-year"
                type="number"
                min="2000"
                max="2200"
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
                required
              />
            </div>
            <div className="w-32 space-y-1.5">
              <Label htmlFor="d-month">Mois</Label>
              <select
                id="d-month"
                value={month}
                onChange={(e) => setMonth(Number(e.target.value))}
                className="flex h-9 w-full rounded-sm border border-line-strong bg-paper px-3 py-1 text-sm text-ink focus:border-accent focus:outline-none"
              >
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                  <option key={m} value={m}>
                    {String(m).padStart(2, '0')}
                  </option>
                ))}
              </select>
            </div>
            <Button type="submit" className="press" disabled={compute.isPending}>
              {compute.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Calculator className="mr-2 h-4 w-4" />
              )}
              Calculer
            </Button>
          </form>
          <FormError error={compute.error} />

          {declarationsQuery.isLoading ? (
            <p className="py-4 text-sm text-ink-mute">Chargement…</p>
          ) : (declarationsQuery.data ?? []).length === 0 ? (
            <p className="py-4 text-sm text-ink-mute">Aucune déclaration calculée.</p>
          ) : (
            <ul className="divide-y divide-line rounded-sm border border-line">
              {(declarationsQuery.data ?? []).map((d) => {
                const isSelected = d.id === selectedDeclId;
                return (
                  <li key={d.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedDeclId(isSelected ? null : d.id)}
                      className={`flex w-full items-center justify-between gap-4 px-4 py-3 text-left text-sm transition-colors duration-fast hover:bg-sunk/50 ${
                        isSelected ? 'bg-sunk/50' : ''
                      }`}
                    >
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-sm font-medium tabular-nums text-ink">
                            {d.periodYear}-{String(d.periodMonth).padStart(2, '0')}
                          </span>
                          <Badge
                            variant={
                              d.status === 'cancelled'
                                ? 'destructive'
                                : d.status === 'calculated'
                                  ? 'default'
                                  : 'muted'
                            }
                          >
                            {d.status}
                          </Badge>
                        </div>
                        <div className="flex flex-wrap gap-x-6 gap-y-0.5 font-mono text-xs tabular-nums text-ink-mute">
                          <span>Collectée : {fmtAmount(d.tvaCollecteeTotal)}</span>
                          <span>Déd. B&amp;S : {fmtAmount(d.tvaDeductibleBsTotal)}</span>
                          <span>Déd. Immo : {fmtAmount(d.tvaDeductibleImmoTotal)}</span>
                          <span className="font-medium text-ink">
                            {Number(d.creditTvaReportable) > 0
                              ? `Crédit : ${fmtAmount(d.creditTvaReportable)}`
                              : `À décaisser : ${fmtAmount(d.tvaADecaisser)}`}
                          </span>
                        </div>
                      </div>
                    </button>
                    {isSelected && (
                      <DeclarationDetailPanel
                        orgId={orgId}
                        declarationId={d.id}
                        status={d.status}
                        onMutated={() => {
                          void qc.invalidateQueries({
                            queryKey: ['tva', 'declarations', orgId],
                          });
                        }}
                        onClose={() => setSelectedDeclId(null)}
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          <FormError error={declarationsQuery.error} />
        </section>
      </div>
    </AppShell>
  );
}

/* ─── Declaration detail panel ───────────────────────────────── */

function DeclarationDetailPanel({
  orgId,
  declarationId,
  status,
  onMutated,
  onClose,
}: {
  orgId: string;
  declarationId: string;
  status: TvaDeclarationStatus;
  onMutated: () => void;
  onClose: () => void;
}) {
  const detailQuery = useQuery<TvaDeclaration, ApiError>({
    queryKey: ['tva', 'declaration', orgId, declarationId],
    queryFn: async () => {
      const data = await api.get<TvaDeclarationEnvelope>(
        `/organizations/${orgId}/tva/declarations/${declarationId}`,
      );
      return data.declaration;
    },
  });

  const [reason, setReason] = useState('');
  const cancel = useApiMutation(
    async () =>
      api.post(`/organizations/${orgId}/tva/declarations/${declarationId}/cancel`, {
        reason: reason.trim(),
      }),
    {
      onSuccess: () => {
        setReason('');
        onMutated();
      },
    },
  );

  const lines = detailQuery.data?.lines ?? [];
  const collected = lines.filter((l) => l.direction === 'collected');
  const deductible = lines.filter(
    (l) => l.direction === 'deductible_bs' || l.direction === 'deductible_immo',
  );

  return (
    <div className="space-y-5 border-t border-line bg-sunk/40 px-4 py-5">
      <div className="flex items-center justify-between">
        <p className="eyebrow">Détail de la déclaration</p>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-6 w-6 items-center justify-center rounded-xs text-ink-mute transition-colors duration-fast hover:bg-sunk hover:text-ink"
          aria-label="Fermer"
        >
          <X className="h-3.5 w-3.5" strokeWidth={1.5} />
        </button>
      </div>

      {detailQuery.isLoading ? (
        <div className="flex items-center gap-2 py-4 text-sm text-ink-mute">
          <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.5} />
          Chargement…
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <LineTable title="Collectée (ventes)" lines={collected} />
          <LineTable title="Déductible (achats)" lines={deductible} />
        </div>
      )}

      {status === 'calculated' && (
        <div className="flex flex-col gap-3 border-t border-line pt-5 md:flex-row md:items-end">
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="cancel-reason">Motif d&apos;annulation</Label>
            <Input
              id="cancel-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ex. erreur de saisie d'écriture"
              maxLength={500}
            />
          </div>
          <Button
            type="button"
            variant="destructive"
            className="press"
            disabled={cancel.isPending || reason.trim() === ''}
            onClick={() => cancel.mutate(undefined)}
          >
            {cancel.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RotateCcw className="mr-2 h-4 w-4" />
            )}
            Annuler la déclaration
          </Button>
        </div>
      )}

      {status === 'cancelled' && detailQuery.data?.cancelledReason && (
        <p className="text-sm text-critical-ink">
          Annulée — motif : {detailQuery.data.cancelledReason}
        </p>
      )}
      <FormError error={detailQuery.error} />
      <FormError error={cancel.error} />
    </div>
  );
}

/* ─── Line table ─────────────────────────────────────────────── */

function LineTable({
  title,
  lines,
}: {
  title: string;
  lines: ReadonlyArray<TvaDeclarationLine>;
}) {
  const total = lines.reduce((s, l) => s + Number(l.amount), 0);
  return (
    <div>
      <p className="eyebrow mb-2">{title}</p>
      <div className="overflow-x-auto rounded-sm border border-line bg-paper">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-line bg-sunk">
              <th className="px-2.5 py-2 text-left text-ink-mute">Préfixe</th>
              <th className="px-2.5 py-2 text-left text-ink-mute">Libellé</th>
              <th className="px-2.5 py-2 text-right text-ink-mute">Montant</th>
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 ? (
              <tr>
                <td className="px-2.5 py-3 text-center text-ink-mute" colSpan={3}>
                  <CheckCircle2
                    className="mr-1 inline h-3 w-3 text-accent-ink"
                    strokeWidth={1.5}
                  />
                  Aucune ligne
                </td>
              </tr>
            ) : (
              lines.map((l) => (
                <tr key={l.id} className="border-b border-line last:border-0">
                  <td className="px-2.5 py-2 font-mono text-ink">{l.accountPrefix}</td>
                  <td className="px-2.5 py-2 text-ink-soft">{l.accountLabel ?? '—'}</td>
                  <td className="px-2.5 py-2 text-right font-mono tabular-nums text-ink">
                    {fmtAmount(l.amount)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
          <tfoot>
            <tr className="border-t border-line-strong bg-sunk">
              <td className="px-2.5 py-2 font-medium text-ink" colSpan={2}>
                Total
              </td>
              <td className="px-2.5 py-2 text-right font-mono font-medium tabular-nums text-ink">
                {fmtAmount(total)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

/* ─── Helpers ────────────────────────────────────────────────── */

function fmtAmount(value: string | number): string {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return '0,00';
  return n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
