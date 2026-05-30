'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, FileUp, Loader2, Plus, TrendingUp, Upload } from 'lucide-react';
import Link from 'next/link';
import { useRef, useState } from 'react';

import { AppShell } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
import { FormError } from '@/components/ui/form-error';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useApiMutation } from '@/hooks/use-api-mutation';
import { ApiError, api, getAuthToken } from '@/lib/api-client';
import { useCurrentOrg } from '@/stores/auth-store';

// ── Types (miroir backend module budget) ──────────────────────────────────
type BudgetAxisType = 'cost_center' | 'project' | 'agency' | 'product' | 'zone';
type BudgetType = 'OPEX' | 'CAPEX' | 'TRESO' | 'RH';
type BudgetScenario = 'BI' | 'BR' | 'REAL';

interface BudgetAxis {
  id: string;
  axisType: BudgetAxisType;
  code: string;
  label: string;
}
interface BudgetLine {
  id: string;
  fiscalYear: number;
  periodMonth: number | null;
  budgetType: BudgetType;
  scenario: BudgetScenario;
  accountCode: string;
  accountLabel: string | null;
  costCenterAxisId: string | null;
  amountBase: string;
}
interface ListBudgetAxes {
  axes: BudgetAxis[];
}
interface ListBudgetLines {
  lines: BudgetLine[];
  total: number;
}
interface BudgetImportReport {
  totalRows: number;
  created: number;
  updated: number;
  skipped: number;
  errors: { row: number; messages: string[] }[];
}

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';
const SELECT =
  'rounded-sm border border-line-strong bg-paper px-3 py-1.5 text-sm text-ink focus:border-accent focus:outline-none';

const BUDGET_TYPES: BudgetType[] = ['OPEX', 'CAPEX', 'TRESO', 'RH'];
const SCENARIOS: BudgetScenario[] = ['BI', 'BR', 'REAL'];
const AXIS_TYPES: { value: BudgetAxisType; label: string }[] = [
  { value: 'cost_center', label: 'Centre de coût' },
  { value: 'project', label: 'Projet' },
  { value: 'agency', label: 'Agence' },
  { value: 'product', label: 'Produit' },
  { value: 'zone', label: 'Zone' },
];

function fmt(amount: string): string {
  const n = Number(amount);
  return Number.isNaN(n)
    ? amount
    : n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function BudgetSaisiePage() {
  const currentOrg = useCurrentOrg();
  const orgId = currentOrg?.id ?? '';
  const qc = useQueryClient();
  const fileInput = useRef<HTMLInputElement | null>(null);

  const [fiscalYear, setFiscalYear] = useState('2026');
  const [scenario, setScenario] = useState<BudgetScenario | ''>('');
  const [budgetType, setBudgetType] = useState<BudgetType | ''>('');
  const [report, setReport] = useState<BudgetImportReport | null>(null);
  const [busy, setBusy] = useState<null | 'import' | 'export' | 'template'>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  const axesQuery = useQuery<BudgetAxis[], ApiError>({
    queryKey: ['budget-axes', orgId],
    queryFn: async () =>
      (await api.get<ListBudgetAxes>(`/organizations/${orgId}/budget/axes`)).axes,
    enabled: orgId !== '',
  });

  const linesQuery = useQuery<ListBudgetLines, ApiError>({
    queryKey: ['budget-lines', orgId, fiscalYear, scenario, budgetType],
    queryFn: async () => {
      const p = new URLSearchParams({ fiscalYear, limit: '500' });
      if (scenario) p.set('scenario', scenario);
      if (budgetType) p.set('budgetType', budgetType);
      return api.get<ListBudgetLines>(`/organizations/${orgId}/budget/lines?${p.toString()}`);
    },
    enabled: orgId !== '',
  });

  // ── Saisie ligne ──────────────────────────────────────────────────────
  const [lType, setLType] = useState<BudgetType>('OPEX');
  const [lScen, setLScen] = useState<BudgetScenario>('BI');
  const [lMonth, setLMonth] = useState('');
  const [lAccount, setLAccount] = useState('');
  const [lLabel, setLLabel] = useState('');
  const [lCc, setLCc] = useState('');
  const [lAmount, setLAmount] = useState('');

  const createLine = useApiMutation<unknown, void>(
    () =>
      api.post(`/organizations/${orgId}/budget/lines`, {
        fiscalYear: Number(fiscalYear),
        periodMonth: lMonth ? Number(lMonth) : undefined,
        budgetType: lType,
        scenario: lScen,
        accountCode: lAccount,
        accountLabel: lLabel || undefined,
        costCenterAxisId: lCc || undefined,
        amount: lAmount,
      }),
    {
      onSuccess: () => {
        setLAccount('');
        setLLabel('');
        setLAmount('');
        void qc.invalidateQueries({ queryKey: ['budget-lines', orgId] });
      },
    },
  );

  // ── Axes ──────────────────────────────────────────────────────────────
  const [aType, setAType] = useState<BudgetAxisType>('cost_center');
  const [aCode, setACode] = useState('');
  const [aLabel, setALabel] = useState('');
  const createAxis = useApiMutation<unknown, void>(
    () =>
      api.post(`/organizations/${orgId}/budget/axes`, { axisType: aType, code: aCode, label: aLabel }),
    {
      onSuccess: () => {
        setACode('');
        setALabel('');
        void qc.invalidateQueries({ queryKey: ['budget-axes', orgId] });
      },
    },
  );

  // ── Download / upload authentifiés ───────────────────────────────────
  async function download(path: string, filename: string, kind: 'export' | 'template') {
    setBusy(kind);
    try {
      const res = await fetch(`${API_BASE}${path}`, {
        headers: { Authorization: `Bearer ${getAuthToken() ?? ''}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setFileError(e instanceof Error ? e.message : 'Téléchargement échoué');
    } finally {
      setBusy(null);
    }
  }

  async function onImport(file: File) {
    setBusy('import');
    setFileError(null);
    setReport(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(`${API_BASE}/organizations/${orgId}/budget/import`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${getAuthToken() ?? ''}` },
        body: form,
      });
      const json = (await res.json()) as { data?: BudgetImportReport; error?: { message: string } };
      if (!res.ok || !json.data) throw new Error(json.error?.message ?? `HTTP ${res.status}`);
      setReport(json.data);
      void qc.invalidateQueries({ queryKey: ['budget-lines', orgId] });
    } catch (e) {
      setFileError(e instanceof Error ? e.message : 'Import échoué');
    } finally {
      setBusy(null);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  const lines = linesQuery.data?.lines ?? [];
  const codeById = new Map(axesQuery.data?.map((a) => [a.id, a.code]));
  const costCenters = axesQuery.data?.filter((a) => a.axisType === 'cost_center') ?? [];

  return (
    <AppShell>
      <div className="w-full animate-page-in space-y-12">
        <header>
          <p className="eyebrow mb-2">Pilotage · Contrôle budgétaire</p>
          <h1 className="font-display text-3xl font-medium tracking-tight text-ink">
            Saisie &amp; import du budget
          </h1>
          <p className="mt-3 max-w-[64ch] text-sm leading-relaxed text-ink-soft">
            Téléchargez le modèle, faites-le remplir par les opérationnels, puis réimportez-le pour
            consolidation. Ou saisissez les lignes directement. Les écarts sont suivis sur la page{' '}
            <Link href="/budget" className="text-accent underline">
              Budget vs Réalisé
            </Link>
            .
          </p>
        </header>

        {/* Toolbar */}
        <section className="flex flex-wrap items-center gap-3">
          <Button
            variant="secondary"
            disabled={busy !== null}
            onClick={() =>
              void download(
                `/organizations/${orgId}/budget/template.xlsx`,
                'template-budget.xlsx',
                'template',
              )
            }
          >
            <Download className="mr-2 size-4" /> Télécharger le modèle
          </Button>
          <Button variant="secondary" disabled={busy !== null} onClick={() => fileInput.current?.click()}>
            {busy === 'import' ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <FileUp className="mr-2 size-4" />
            )}
            Réimporter (rempli)
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onImport(f);
            }}
          />
          <Button
            variant="secondary"
            disabled={busy !== null}
            onClick={() =>
              void download(
                `/organizations/${orgId}/budget/export.xlsx?fiscalYear=${fiscalYear}`,
                `budget-${fiscalYear}.xlsx`,
                'export',
              )
            }
          >
            <Upload className="mr-2 size-4" /> Exporter
          </Button>
          <Link href="/budget">
            <Button variant="ghost">
              <TrendingUp className="mr-2 size-4" /> Écarts réalisé / budget
            </Button>
          </Link>
        </section>

        {fileError ? <FormError error={{ message: fileError }} /> : null}
        {report ? (
          <div className="rounded-sm border border-line bg-surface p-4 text-sm">
            <p className="font-display font-medium text-ink">
              Import : {report.created} créées · {report.updated} mises à jour · {report.skipped}{' '}
              rejetées sur {report.totalRows} lignes
            </p>
            {report.errors.length > 0 ? (
              <ul className="mt-2 space-y-1 text-ink-soft">
                {report.errors.slice(0, 12).map((e) => (
                  <li key={e.row}>
                    Ligne {e.row} : {e.messages.join(' ; ')}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        {/* Filtres */}
        <section className="flex flex-wrap items-end gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="y">Exercice</Label>
            <Input id="y" value={fiscalYear} onChange={(e) => setFiscalYear(e.target.value)} className="w-28" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="s">Scénario</Label>
            <select id="s" className={SELECT} value={scenario} onChange={(e) => setScenario(e.target.value as BudgetScenario | '')}>
              <option value="">Tous</option>
              {SCENARIOS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="t">Type</Label>
            <select id="t" className={SELECT} value={budgetType} onChange={(e) => setBudgetType(e.target.value as BudgetType | '')}>
              <option value="">Tous</option>
              {BUDGET_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
        </section>

        {/* Saisie ligne */}
        <section className="space-y-4">
          <h2 className="font-display text-lg font-medium text-ink">Nouvelle ligne budgétaire</h2>
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              createLine.mutate();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="lt">Type</Label>
              <select id="lt" className={SELECT} value={lType} onChange={(e) => setLType(e.target.value as BudgetType)}>
                {BUDGET_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ls">Scénario</Label>
              <select id="ls" className={SELECT} value={lScen} onChange={(e) => setLScen(e.target.value as BudgetScenario)}>
                {SCENARIOS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lm">Mois</Label>
              <Input id="lm" value={lMonth} onChange={(e) => setLMonth(e.target.value)} placeholder="1-12" className="w-20" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="la">Compte</Label>
              <Input id="la" value={lAccount} onChange={(e) => setLAccount(e.target.value)} placeholder="6221" className="w-28" required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ll">Libellé</Label>
              <Input id="ll" value={lLabel} onChange={(e) => setLLabel(e.target.value)} className="w-48" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lcc">Centre de coût</Label>
              <select id="lcc" className={SELECT} value={lCc} onChange={(e) => setLCc(e.target.value)}>
                <option value="">—</option>
                {costCenters.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lam">Montant</Label>
              <Input id="lam" value={lAmount} onChange={(e) => setLAmount(e.target.value)} placeholder="1500000" className="w-32" required />
            </div>
            <Button type="submit" disabled={createLine.isPending}>
              {createLine.isPending ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <Plus className="mr-2 size-4" />
              )}
              Ajouter
            </Button>
          </form>
          {createLine.error ? <FormError error={createLine.error} /> : null}
        </section>

        {/* Table lignes */}
        <section className="space-y-4">
          <h2 className="font-display text-lg font-medium text-ink">
            Lignes budgétaires <span className="text-ink-soft">({linesQuery.data?.total ?? 0})</span>
          </h2>
          {linesQuery.isLoading ? (
            <div className="space-y-2">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-9 animate-pulse rounded-sm bg-surface" />
              ))}
            </div>
          ) : lines.length === 0 ? (
            <p className="rounded-sm border border-dashed border-line p-8 text-center text-sm text-ink-soft">
              Aucune ligne pour ces filtres. Téléchargez le modèle, renseignez-le et réimportez, ou
              saisissez une ligne ci-dessus.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-sm border border-line">
              <table className="w-full text-sm">
                <thead className="border-b border-line bg-surface text-left text-ink-soft">
                  <tr>
                    <th className="px-3 py-2 font-medium">Période</th>
                    <th className="px-3 py-2 font-medium">Type</th>
                    <th className="px-3 py-2 font-medium">Scén.</th>
                    <th className="px-3 py-2 font-medium">Compte</th>
                    <th className="px-3 py-2 font-medium">CC</th>
                    <th className="px-3 py-2 text-right font-medium">Montant (XOF)</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.id} className="border-b border-line/50 last:border-0">
                      <td className="px-3 py-2 text-ink-soft">
                        {l.fiscalYear}
                        {l.periodMonth ? `-${String(l.periodMonth).padStart(2, '0')}` : ''}
                      </td>
                      <td className="px-3 py-2">{l.budgetType}</td>
                      <td className="px-3 py-2 text-ink-soft">{l.scenario}</td>
                      <td className="px-3 py-2">
                        <span className="font-medium text-ink">{l.accountCode}</span>{' '}
                        <span className="text-ink-soft">{l.accountLabel}</span>
                      </td>
                      <td className="px-3 py-2 text-ink-soft">
                        {l.costCenterAxisId ? (codeById.get(l.costCenterAxisId) ?? '—') : '—'}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmt(l.amountBase)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Axes */}
        <section className="space-y-4">
          <h2 className="font-display text-lg font-medium text-ink">Axes analytiques</h2>
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              createAxis.mutate();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="at">Type</Label>
              <select id="at" className={SELECT} value={aType} onChange={(e) => setAType(e.target.value as BudgetAxisType)}>
                {AXIS_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ac">Code</Label>
              <Input id="ac" value={aCode} onChange={(e) => setACode(e.target.value.toUpperCase())} placeholder="COMM" className="w-28" required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="al">Libellé</Label>
              <Input id="al" value={aLabel} onChange={(e) => setALabel(e.target.value)} placeholder="Direction commerciale" className="w-56" required />
            </div>
            <Button type="submit" variant="secondary" disabled={createAxis.isPending}>
              {createAxis.isPending ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <Plus className="mr-2 size-4" />
              )}
              Créer l&apos;axe
            </Button>
          </form>
          {createAxis.error ? <FormError error={createAxis.error} /> : null}
          {(axesQuery.data?.length ?? 0) > 0 ? (
            <div className="flex flex-wrap gap-2">
              {axesQuery.data?.map((a) => (
                <span key={a.id} className="rounded-sm border border-line bg-surface px-2.5 py-1 text-xs text-ink-soft">
                  <span className="font-medium text-ink">{a.code}</span> · {a.label}
                </span>
              ))}
            </div>
          ) : null}
        </section>
      </div>
    </AppShell>
  );
}
