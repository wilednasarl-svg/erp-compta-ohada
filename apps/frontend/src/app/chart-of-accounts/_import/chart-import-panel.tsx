'use client';

/**
 * Import d'un plan comptable depuis un fichier CSV ou XLSX. Parsing 100 %
 * client (SheetJS) puis création compte par compte via l'endpoint existant
 * `POST /organizations/:org/chart-of-accounts` — aucun changement backend, donc
 * opérationnel sur le backend en place. Aperçu (à créer / déjà présent /
 * sans parent) avant exécution, progression et bilan.
 */

import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Download, FileUp, Loader2, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import * as XLSX from 'xlsx';

import { ApiError, api } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { useCurrentOrg } from '@/stores/auth-store';
import type { AccountView } from '@/types/accounting-plan';

import { normalizeRows } from './parse';
import { buildImportPlan, type ImportPlan, type PlanItem } from './plan';

type Phase = 'idle' | 'preview' | 'running' | 'done';

interface RunResult {
  readonly created: number;
  readonly skipped: number;
  readonly failed: ReadonlyArray<{ readonly code: string; readonly reason: string }>;
}

export function ChartImportPanel() {
  const org = useCurrentOrg();
  const orgId = org?.id ?? '';
  const fileInput = useRef<HTMLInputElement>(null);

  const [fileName, setFileName] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [parseError, setParseError] = useState<string | null>(null);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState<RunResult | null>(null);
  const [dragActive, setDragActive] = useState(false);

  const accountsQuery = useQuery<ReadonlyArray<AccountView>, ApiError>({
    queryKey: ['chart-of-accounts', orgId],
    queryFn: async () => {
      const data = await api.get<{ accounts: ReadonlyArray<AccountView> }>(
        `/organizations/${orgId}/chart-of-accounts`,
      );
      return data.accounts;
    },
    enabled: orgId !== '',
  });

  const handleFile = async (file: File): Promise<void> => {
    setParseError(null);
    setResult(null);
    setFileName(file.name);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const first = wb.SheetNames[0];
      if (first === undefined) throw new Error('Fichier vide');
      const ws = wb.Sheets[first]!;
      const records = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
      const { rows, dropped, mapping } = normalizeRows(records);
      if (mapping.codeKey === null || mapping.labelKey === null) {
        setParseError(
          'Colonnes « Code » et « Libellé » introuvables. Ajoutez une ligne d’en-tête (ex. : Code, Libellé, Parent).',
        );
        setPhase('idle');
        return;
      }
      if (rows.length === 0) {
        setParseError(`Aucune ligne exploitable (${dropped} ignorée(s)).`);
        setPhase('idle');
        return;
      }
      const existing = (accountsQuery.data ?? []).map((a) => a.code);
      setPlan(buildImportPlan(existing, rows));
      setPhase('preview');
    } catch (err: unknown) {
      setParseError(err instanceof Error ? err.message : 'Lecture du fichier impossible');
      setPhase('idle');
    }
  };

  const runImport = async (): Promise<void> => {
    if (plan === null) return;
    const toCreate = plan.items.filter((i) => i.status === 'create');
    setPhase('running');
    setProgress({ done: 0, total: toCreate.length });
    let created = 0;
    let skipped = 0;
    const failed: Array<{ code: string; reason: string }> = [];

    for (let i = 0; i < toCreate.length; i += 1) {
      const item = toCreate[i]!;
      try {
        await api.post(`/organizations/${orgId}/chart-of-accounts`, {
          parentCode: item.parentCode,
          code: item.code,
          label: item.label,
        });
        created += 1;
      } catch (err: unknown) {
        if (err instanceof ApiError && err.code === 'CHART_ACCOUNT_CODE_TAKEN') {
          skipped += 1;
        } else {
          failed.push({ code: item.code, reason: err instanceof Error ? err.message : 'échec' });
        }
      }
      setProgress({ done: i + 1, total: toCreate.length });
    }

    setResult({ created, skipped, failed });
    setPhase('done');
    void accountsQuery.refetch();
  };

  const downloadTemplate = (): void => {
    const csv = [
      'Code,Libellé,Parent',
      '4011,Fournisseurs locaux,401',
      '60420000,Achats matières et fournitures,604',
      '44520000,TVA récupérable sur achats,4452',
    ].join('\n');
    const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'modele-plan-comptable.csv';
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const onDrop = (e: React.DragEvent): void => {
    e.preventDefault();
    setDragActive(false);
    if (phase === 'running') return;
    const f = e.dataTransfer.files?.[0];
    if (f) void handleFile(f);
  };

  const busy = accountsQuery.isLoading || phase === 'running';

  return (
    <div className="space-y-5">
      <p className="max-w-[68ch] text-sm leading-relaxed text-ink-soft">
        Importez un plan comptable depuis un fichier <strong>CSV</strong> ou{' '}
        <strong>Excel (.xlsx)</strong>. Le fichier doit comporter une ligne d’en-tête avec au moins
        les colonnes <em>Code</em> et <em>Libellé</em> (une colonne <em>Parent</em> est facultative).
        Chaque compte est rattaché à son parent existant ; les comptes déjà présents sont ignorés.
      </p>

      <input
        ref={fileInput}
        type="file"
        accept=".csv,.xlsx,.xls"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleFile(f);
        }}
      />

      <button
        type="button"
        onClick={() => !busy && fileInput.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          if (!busy) setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={onDrop}
        disabled={busy}
        className={cn(
          'flex w-full flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed px-6 py-10 text-center transition-colors duration-fast',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-60',
          dragActive ? 'border-accent bg-accent-soft/40' : 'border-line-strong bg-paper hover:border-ink/40 hover:bg-sunk/30',
        )}
      >
        <span className={cn('flex h-11 w-11 items-center justify-center rounded-full', dragActive ? 'bg-accent text-paper' : 'bg-sunk text-ink-soft')}>
          <FileUp className="h-5 w-5" strokeWidth={1.5} aria-hidden />
        </span>
        <span className="text-sm font-medium text-ink">
          {accountsQuery.isLoading
            ? 'Chargement du plan existant…'
            : fileName !== ''
              ? fileName
              : 'Glissez un fichier ici, ou cliquez pour parcourir'}
        </span>
        <span className="text-2xs uppercase tracking-wider text-ink-mute">CSV · XLSX · XLS</span>
      </button>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-mute">
        <span>En-têtes attendus : <span className="font-mono text-ink-soft">Code, Libellé, Parent</span> (Parent facultatif).</span>
        <button
          type="button"
          onClick={downloadTemplate}
          className="inline-flex items-center gap-1.5 font-medium text-accent-ink underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          <Download className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden />
          Télécharger un modèle CSV
        </button>
      </div>

      {parseError !== null && (
        <p className="flex items-center gap-2 rounded-sm border border-critical/30 bg-critical-soft px-3 py-2 text-sm text-critical-ink">
          <AlertTriangle className="h-4 w-4 shrink-0" strokeWidth={1.5} aria-hidden />
          {parseError}
        </p>
      )}

      {plan !== null && phase !== 'idle' && (
        <PlanPreview
          plan={plan}
          phase={phase}
          progress={progress}
          result={result}
          onRun={() => void runImport()}
        />
      )}
    </div>
  );
}

function PlanPreview({
  plan, phase, progress, result, onRun,
}: {
  readonly plan: ImportPlan;
  readonly phase: Phase;
  readonly progress: { readonly done: number; readonly total: number };
  readonly result: RunResult | null;
  readonly onRun: () => void;
}) {
  const pct = progress.total === 0 ? 0 : Math.round((progress.done / progress.total) * 100);
  return (
    <div className="space-y-4 rounded-md border border-line bg-paper p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Stat value={plan.toCreate} label="à créer" tone="accent" />
        <Stat value={plan.existing} label="déjà présents" tone="muted" />
        {plan.blocked > 0 && <Stat value={plan.blocked} label="sans parent" tone="warn" />}
        {phase === 'preview' && (
          <button
            type="button"
            onClick={onRun}
            disabled={plan.toCreate === 0}
            className="ml-auto inline-flex h-9 items-center gap-2 rounded-sm bg-accent px-4 text-sm font-medium text-paper transition-colors duration-fast hover:bg-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50"
          >
            <Upload className="h-4 w-4" strokeWidth={1.5} aria-hidden />
            Importer {plan.toCreate} compte(s)
          </button>
        )}
      </div>

      {phase === 'running' && (
        <div className="space-y-1.5" role="status" aria-live="polite">
          <div className="flex items-center justify-between text-xs text-ink-soft">
            <span className="inline-flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin text-accent" strokeWidth={1.5} /> Création…
            </span>
            <span className="font-mono tabular-nums">{progress.done}/{progress.total}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-sunk">
            <div
              className="h-full origin-left rounded-full bg-accent transition-transform duration-slow ease-out-quart motion-reduce:transition-none"
              style={{ transform: `scaleX(${pct / 100})` }}
            />
          </div>
        </div>
      )}

      {phase === 'done' && result !== null && (
        <div className="rounded-sm border border-accent/25 bg-accent-soft/40 p-3 text-sm text-accent-ink">
          <p className="inline-flex items-center gap-2 font-medium">
            <CheckCircle2 className="h-4 w-4" strokeWidth={1.5} aria-hidden />
            Import terminé : {result.created} créé(s), {result.skipped} ignoré(s), {result.failed.length} en échec.
          </p>
          {result.failed.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-xs text-critical-ink">
              {result.failed.slice(0, 10).map((f) => (
                <li key={f.code}>
                  <span className="font-mono">{f.code}</span> — {f.reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="max-h-80 overflow-auto rounded-sm border border-line">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0">
            <tr className="border-b border-line-strong bg-sunk text-2xs uppercase tracking-wider text-ink-mute">
              <th className="px-3 py-1.5 text-left font-medium">Code</th>
              <th className="px-3 py-1.5 text-left font-medium">Libellé</th>
              <th className="px-3 py-1.5 text-left font-medium">Parent</th>
              <th className="px-3 py-1.5 text-left font-medium">Statut</th>
            </tr>
          </thead>
          <tbody>
            {plan.items.map((item) => (
              <PlanRow key={item.code} item={item} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({
  value, label, tone,
}: {
  readonly value: number;
  readonly label: string;
  readonly tone: 'accent' | 'muted' | 'warn';
}) {
  const cls = {
    accent: 'border-accent/25 bg-accent-soft/50 text-accent-ink',
    muted: 'border-line bg-sunk text-ink-soft',
    warn: 'border-warn/30 bg-warn-soft text-warn-ink',
  }[tone];
  return (
    <span className={cn('inline-flex items-baseline gap-1.5 rounded-sm border px-2.5 py-1', cls)}>
      <span className="font-mono text-sm font-medium tabular-nums">{value}</span>
      <span className="text-2xs uppercase tracking-wider">{label}</span>
    </span>
  );
}

function PlanRow({ item }: { readonly item: PlanItem }) {
  const badge = {
    create: { label: 'À créer', cls: 'bg-accent-soft text-accent-ink' },
    exists: { label: 'Existe', cls: 'bg-sunk text-ink-mute' },
    'no-parent': { label: 'Parent absent', cls: 'bg-warn-soft text-warn-ink' },
  }[item.status];
  return (
    <tr className="border-b border-line/60">
      <td className="px-3 py-1.5 font-mono tabular-nums text-ink">{item.code}</td>
      <td className="px-3 py-1.5 text-ink-soft">{item.label}</td>
      <td className="px-3 py-1.5 font-mono text-ink-mute">{item.parentCode ?? '—'}</td>
      <td className="px-3 py-1.5">
        <span className={cn('rounded-full px-2 py-0.5 text-2xs font-medium', badge.cls)}>{badge.label}</span>
      </td>
    </tr>
  );
}
