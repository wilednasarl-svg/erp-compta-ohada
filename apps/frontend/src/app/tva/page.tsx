'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Calculator, CheckCircle2, Loader2, Plus, RotateCcw, X } from 'lucide-react';
import { useState } from 'react';

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

/**
 * `/tva` — Module 13 : codes TVA + déclarations mensuelles OHADA.
 *
 * UX :
 *   - section haute = codes TVA (CRUD léger : create + désactiver).
 *   - section basse = déclarations : compute pour un mois, liste
 *     antéchronologique, détail avec lignes par code, annulation
 *     motivée.
 *
 * Le `rate` est un string (le backend préserve la précision DECIMAL,
 * pas de risque de drift float JS).
 */
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

  // ─── Create code form ───────────────────────────────────────────────
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

  // ─── Compute declaration form ───────────────────────────────────────
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);

  const compute = useApiMutation(
    async () =>
      api.post(`/organizations/${orgId}/tva/declarations`, { year, month }),
    {
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: ['tva', 'declarations', orgId] });
      },
    },
  );

  // ─── Selected declaration detail ────────────────────────────────────
  const [selectedDeclId, setSelectedDeclId] = useState<string | null>(null);

  return (
    <AppShell>
      <div className="space-y-6">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">TVA</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Codes TVA et déclarations mensuelles SYSCOHADA. La déclaration agrège
            automatiquement les écritures du mois en collectée / déductible et calcule
            le net dû.
          </p>
        </header>

        {/* CODES TVA */}
        <Card>
          <CardHeader>
            <CardTitle>Codes TVA</CardTitle>
            <CardDescription>
              Référentiel des taux applicables. Par défaut OHADA : TVA-N-18 (normale 18 %),
              TVA-EXO (exonérée 0 %), TVA-EXP (export 0 %).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <form
              className="grid grid-cols-1 gap-3 md:grid-cols-[140px_2fr_100px_120px_140px_auto] md:items-end"
              onSubmit={(e) => {
                e.preventDefault();
                createCode.mutate(undefined);
              }}
            >
              <div className="space-y-1">
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
              <div className="space-y-1">
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
              <div className="space-y-1">
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
              <div className="space-y-1">
                <Label htmlFor="c-type">Direction</Label>
                <select
                  id="c-type"
                  value={codeType}
                  onChange={(e) => setCodeType(e.target.value as TvaCodeType)}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                >
                  <option value="both">Vente + Achat</option>
                  <option value="sales">Vente seule</option>
                  <option value="purchase">Achat seul</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="c-kind">Nature</Label>
                <select
                  id="c-kind"
                  value={codeKind}
                  onChange={(e) => setCodeKind(e.target.value as TvaCodeKind)}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                >
                  <option value="normal">Normale</option>
                  <option value="reduced">Réduite</option>
                  <option value="exempt">Exempt</option>
                  <option value="exonerated">Exonérée</option>
                  <option value="export">Export</option>
                </select>
              </div>
              <Button type="submit" disabled={createCode.isPending}>
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
              <p className="text-sm text-muted-foreground">Chargement…</p>
            ) : (codesQuery.data ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucun code TVA défini.</p>
            ) : (
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left">Code</th>
                      <th className="px-3 py-2 text-left">Libellé</th>
                      <th className="px-3 py-2 text-right">Taux</th>
                      <th className="px-3 py-2 text-left">Direction</th>
                      <th className="px-3 py-2 text-left">Nature</th>
                      <th className="px-3 py-2 text-left">Statut</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(codesQuery.data ?? []).map((c) => (
                      <tr key={c.id} className="border-t">
                        <td className="px-3 py-2 font-mono">{c.code}</td>
                        <td className="px-3 py-2">{c.label}</td>
                        <td className="px-3 py-2 text-right font-mono">{Number(c.rate).toFixed(2)} %</td>
                        <td className="px-3 py-2 text-xs">{c.type}</td>
                        <td className="px-3 py-2 text-xs">{c.kind}</td>
                        <td className="px-3 py-2">
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
          </CardContent>
        </Card>

        {/* DÉCLARATIONS */}
        <Card>
          <CardHeader>
            <CardTitle>Déclarations mensuelles</CardTitle>
            <CardDescription>
              Calcule la déclaration TVA pour un mois donné — agrège les écritures
              validées en collectée (ventes) et déductible (achats).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <form
              className="grid grid-cols-1 gap-3 md:grid-cols-[140px_140px_auto] md:items-end"
              onSubmit={(e) => {
                e.preventDefault();
                compute.mutate(undefined);
              }}
            >
              <div className="space-y-1">
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
              <div className="space-y-1">
                <Label htmlFor="d-month">Mois</Label>
                <select
                  id="d-month"
                  value={month}
                  onChange={(e) => setMonth(Number(e.target.value))}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                >
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                    <option key={m} value={m}>
                      {String(m).padStart(2, '0')}
                    </option>
                  ))}
                </select>
              </div>
              <Button type="submit" disabled={compute.isPending}>
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
              <p className="text-sm text-muted-foreground">Chargement…</p>
            ) : (declarationsQuery.data ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucune déclaration calculée.</p>
            ) : (
              <ul className="divide-y rounded-md border">
                {(declarationsQuery.data ?? []).map((d) => {
                  const isSelected = d.id === selectedDeclId;
                  return (
                    <li key={d.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedDeclId(isSelected ? null : d.id)}
                        className={`flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-sm hover:bg-muted/60 ${
                          isSelected ? 'bg-muted/60' : ''
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono">
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
                          <div className="mt-0.5 grid grid-cols-4 gap-3 text-xs text-muted-foreground">
                            <span>
                              Collectée :{' '}
                              <span className="font-mono">{fmtAmount(d.tvaCollecteeTotal)}</span>
                            </span>
                            <span>
                              Déductible B&amp;S :{' '}
                              <span className="font-mono">{fmtAmount(d.tvaDeductibleBsTotal)}</span>
                            </span>
                            <span>
                              Déductible Immo :{' '}
                              <span className="font-mono">{fmtAmount(d.tvaDeductibleImmoTotal)}</span>
                            </span>
                            <span className="font-medium">
                              {Number(d.creditTvaReportable) > 0
                                ? 'Crédit reportable : '
                                : 'À décaisser : '}
                              <span className="font-mono">
                                {fmtAmount(
                                  Number(d.creditTvaReportable) > 0
                                    ? d.creditTvaReportable
                                    : d.tvaADecaisser,
                                )}
                              </span>
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
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

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
      // Contrat OpenAPI : `GET /organizations/:id/tva/declarations/:declarationId`
      // renvoie `TvaDeclarationEnvelopeResponse = { declaration: ... }`.
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
  // Le backend agrège la déductible en deux directions séparées
  // (`deductible_bs` biens & services, `deductible_immo` immobilisations) —
  // c'est le contrat OpenAPI. On les regroupe côté UI pour conserver
  // l'affichage "Déductible (achats)".
  const deductible = lines.filter(
    (l) => l.direction === 'deductible_bs' || l.direction === 'deductible_immo',
  );

  return (
    <div className="space-y-4 border-t bg-muted/20 p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase text-muted-foreground">Détail</span>
        <Button type="button" size="sm" variant="outline" onClick={onClose}>
          <X className="h-3 w-3" />
        </Button>
      </div>
      {detailQuery.isLoading ? (
        <p className="text-sm text-muted-foreground">Chargement…</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <LineTable title="Collectée (ventes)" lines={collected} />
          <LineTable title="Déductible (achats)" lines={deductible} />
        </div>
      )}
      {status === 'calculated' && (
        <div className="flex flex-col gap-2 md:flex-row md:items-end">
          <div className="flex-1 space-y-1">
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
        <p className="text-sm text-destructive">
          Annulée — motif : {detailQuery.data.cancelledReason}
        </p>
      )}
      <FormError error={detailQuery.error} />
      <FormError error={cancel.error} />
    </div>
  );
}

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
      <div className="mb-1 text-xs font-medium uppercase text-muted-foreground">{title}</div>
      <div className="overflow-x-auto rounded-md border bg-background">
        <table className="w-full text-xs">
          <thead className="bg-muted/30">
            <tr>
              <th className="px-2 py-1 text-left">Préfixe compte</th>
              <th className="px-2 py-1 text-left">Libellé</th>
              <th className="px-2 py-1 text-right">Montant</th>
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 ? (
              <tr>
                <td className="px-2 py-2 text-center text-muted-foreground" colSpan={3}>
                  <CheckCircle2 className="mr-1 inline h-3 w-3 text-emerald-600" />
                  Aucune ligne
                </td>
              </tr>
            ) : (
              lines.map((l) => (
                <tr key={l.id} className="border-t">
                  <td className="px-2 py-1 font-mono">{l.accountPrefix}</td>
                  <td className="px-2 py-1">{l.accountLabel ?? '—'}</td>
                  <td className="px-2 py-1 text-right font-mono">{fmtAmount(l.amount)}</td>
                </tr>
              ))
            )}
          </tbody>
          <tfoot className="border-t bg-muted/20">
            <tr>
              <td className="px-2 py-1 font-medium" colSpan={2}>
                Total
              </td>
              <td className="px-2 py-1 text-right font-mono font-medium">
                {fmtAmount(total)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function fmtAmount(value: string | number): string {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) {
    return '0,00';
  }
  return n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
