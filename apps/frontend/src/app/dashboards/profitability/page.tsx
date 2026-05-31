'use client';

import { useQuery } from '@tanstack/react-query';
import {
  Layers,
  TrendingUp,
  Wallet,
  Gauge,
  Coins,
  Inbox,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { AppShell } from '@/components/app-shell';
import { FormError } from '@/components/ui/form-error';
import { ApiError, api } from '@/lib/api-client';
import { useCurrentOrg } from '@/stores/auth-store';

// ─────────────────────────────────────────────────────────────────────────────
// Contrat backend (source: apps/backend/src/modules/reports/services/reports.service.ts)
//   GET /organizations/{orgId}/reports/margin-by-axis?axisType&fromDate&toDate
//   GET /organizations/{orgId}/reports/analytic-axes?fromDate&toDate
// Tous les montants sont des chaînes décimales (string). Devise : XOF.
// `axisType` est libre côté backend (string, uppercase) — pas d'enum figé.
// Les types observés sont découverts via analytic-axes ; on propose en plus
// des presets métier alignés sur la vision produit.
// ─────────────────────────────────────────────────────────────────────────────

interface AnalyticAxisSummary {
  readonly axisType: string;
  readonly axisCode: string;
  readonly lineCount: number;
}

interface AnalyticAxesEnvelope {
  readonly axes: readonly AnalyticAxisSummary[];
}

interface MarginByAxisRow {
  readonly axisCode: string;
  readonly chiffreAffaires: string;
  readonly achatsConsommes: string;
  readonly margeBrute: string;
  readonly margeBrutePercent: string | null;
  readonly valeurAjoutee: string;
  readonly tauxValeurAjoutee: string | null;
  readonly excedentBrutExploit: string;
  readonly tauxEbe: string | null;
  readonly chargesPersonnel: string;
  readonly autresCharges: string;
  readonly resultatNet: string;
}

interface MarginByAxisReport {
  readonly fromDate: string;
  readonly toDate: string;
  readonly axisType: string;
  readonly currency: 'XOF';
  readonly rows: readonly MarginByAxisRow[];
  readonly totals: MarginByAxisRow;
}

interface MarginByAxisEnvelope {
  readonly report: MarginByAxisReport;
}

// Presets métier (vision produit). Le backend accepte n'importe quel libellé ;
// ces presets servent d'amorce, complétés par les axes réellement présents.
const AXIS_PRESETS: readonly string[] = [
  'CENTRE',
  'PROJET',
  'PRODUIT',
  'ZONE',
  'CLIENT',
];

const TOP_N_SEGMENTS = 8;

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function startOfYearIso(): string {
  return `${new Date().getFullYear()}-01-01`;
}

export default function ProfitabilityDashboardPage() {
  const currentOrg = useCurrentOrg();
  const orgId = currentOrg?.id ?? '';

  const [axisType, setAxisType] = useState<string>('CENTRE');
  const [fromDate, setFromDate] = useState<string>(startOfYearIso());
  const [toDate, setToDate] = useState<string>(todayIso());

  const axesQuery = useQuery<readonly AnalyticAxisSummary[], ApiError>({
    queryKey: ['profitability', 'analytic-axes', orgId],
    queryFn: async () => {
      const data = await api.get<AnalyticAxesEnvelope>(
        `/organizations/${orgId}/reports/analytic-axes`,
      );
      return data.axes;
    },
    enabled: orgId !== '',
  });

  const knownTypes = useMemo(
    () => Array.from(new Set((axesQuery.data ?? []).map((a) => a.axisType))),
    [axesQuery.data],
  );

  // Union presets + types réellement présents dans les données, ordre stable.
  const axisOptions = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const t of [...AXIS_PRESETS, ...knownTypes]) {
      const up = t.toUpperCase();
      if (!seen.has(up)) {
        seen.add(up);
        out.push(up);
      }
    }
    return out;
  }, [knownTypes]);

  const reportQuery = useQuery<MarginByAxisReport, ApiError>({
    queryKey: ['profitability', 'margin-by-axis', orgId, axisType, fromDate, toDate],
    queryFn: async () => {
      const params = new URLSearchParams({ axisType, fromDate, toDate });
      const data = await api.get<MarginByAxisEnvelope>(
        `/organizations/${orgId}/reports/margin-by-axis?${params.toString()}`,
      );
      return data.report;
    },
    enabled: orgId !== '' && axisType.trim() !== '' && fromDate !== '' && toDate !== '',
  });

  const report = reportQuery.data;
  const hasRows = (report?.rows.length ?? 0) > 0;

  return (
    <AppShell>
      <div className="w-full animate-page-in space-y-8">
        <header>
          <p className="eyebrow">Pilotage · Analytique</p>
          <h1 className="mt-2 font-display text-3xl font-medium tracking-tight text-ink">
            Rentabilité par activité
          </h1>
          <p className="mt-2 max-w-[68ch] text-sm text-ink-soft">
            Le résultat SYSCOHADA reste global ; cette vue le décompose par segment
            analytique pour identifier ce qui crée, ou détruit, de la valeur.
          </p>
        </header>

        <ControlBar
          axisType={axisType}
          axisOptions={axisOptions}
          fromDate={fromDate}
          toDate={toDate}
          onAxisChange={setAxisType}
          onFromChange={setFromDate}
          onToChange={setToDate}
        />

        {reportQuery.isLoading && report === undefined ? (
          <ProfitabilitySkeleton />
        ) : reportQuery.isError ? (
          <div className="rounded-sm border border-critical/40 bg-critical-soft p-4">
            <FormError error={reportQuery.error} />
          </div>
        ) : report !== undefined && !hasRows ? (
          <EmptyState />
        ) : report !== undefined ? (
          <>
            <KpiRow totals={report.totals} />
            <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
              <CaMargeChart rows={report.rows} />
              <ResultatChart rows={report.rows} />
            </div>
            <MarginTable report={report} />
          </>
        ) : null}
      </div>
    </AppShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Controls
// ─────────────────────────────────────────────────────────────────────────────

interface ControlBarProps {
  axisType: string;
  axisOptions: readonly string[];
  fromDate: string;
  toDate: string;
  onAxisChange: (v: string) => void;
  onFromChange: (v: string) => void;
  onToChange: (v: string) => void;
}

function ControlBar({
  axisType,
  axisOptions,
  fromDate,
  toDate,
  onAxisChange,
  onFromChange,
  onToChange,
}: ControlBarProps) {
  return (
    <section className="rounded-sm border border-line bg-paper p-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 lg:items-end">
        <div className="space-y-1.5">
          <label
            htmlFor="axis-type"
            className="text-xs font-medium uppercase tracking-wider text-ink-mute"
          >
            Type d&apos;axe
          </label>
          <select
            id="axis-type"
            value={axisType}
            onChange={(e) => onAxisChange(e.target.value)}
            className="h-9 w-full rounded-sm border border-line bg-paper px-3 text-sm text-ink outline-none focus:border-accent"
          >
            {axisOptions.map((opt) => (
              <option key={opt} value={opt}>
                {labelForAxis(opt)}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <label
            htmlFor="from-date"
            className="text-xs font-medium uppercase tracking-wider text-ink-mute"
          >
            Du
          </label>
          <input
            id="from-date"
            type="date"
            value={fromDate}
            max={toDate}
            onChange={(e) => onFromChange(e.target.value)}
            className="h-9 w-full rounded-sm border border-line bg-paper px-3 text-sm text-ink outline-none focus:border-accent"
          />
        </div>

        <div className="space-y-1.5">
          <label
            htmlFor="to-date"
            className="text-xs font-medium uppercase tracking-wider text-ink-mute"
          >
            Au
          </label>
          <input
            id="to-date"
            type="date"
            value={toDate}
            min={fromDate}
            onChange={(e) => onToChange(e.target.value)}
            className="h-9 w-full rounded-sm border border-line bg-paper px-3 text-sm text-ink outline-none focus:border-accent"
          />
        </div>

        <p className="text-xs text-ink-mute">
          Indicateurs alignés Note 34 (Tome 3) restreints à l&apos;axe sélectionné.
          Devise XOF.
        </p>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// KPI row
// ─────────────────────────────────────────────────────────────────────────────

function KpiRow({ totals }: { totals: MarginByAxisRow }) {
  const ca = toNum(totals.chiffreAffaires);
  const marge = toNum(totals.margeBrute);
  const ebe = toNum(totals.excedentBrutExploit);
  const resultat = toNum(totals.resultatNet);

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Kpi
        label="Chiffre d'affaires"
        value={ca}
        icon={Coins}
        tone="neutral"
      />
      <Kpi
        label="Marge brute"
        value={marge}
        icon={TrendingUp}
        tone={marge >= 0 ? 'positive' : 'negative'}
        hint={`${formatPercent(totals.margeBrutePercent)} de marge`}
      />
      <Kpi
        label="Excédent brut d'exploitation"
        value={ebe}
        icon={Gauge}
        tone={ebe >= 0 ? 'positive' : 'negative'}
        hint={`Taux EBE ${formatPercent(totals.tauxEbe)}`}
      />
      <Kpi
        label="Résultat net"
        value={resultat}
        icon={Wallet}
        tone={resultat >= 0 ? 'positive' : 'negative'}
      />
    </div>
  );
}

interface KpiProps {
  label: string;
  value: number;
  icon: typeof Coins;
  tone: 'positive' | 'negative' | 'neutral';
  hint?: string;
}

function Kpi({ label, value, icon: Icon, tone, hint }: KpiProps) {
  const valueColor =
    tone === 'positive'
      ? 'text-accent-ink'
      : tone === 'negative'
        ? 'text-critical-ink'
        : 'text-ink';
  const badge =
    tone === 'positive'
      ? 'bg-accent-soft text-accent-ink'
      : tone === 'negative'
        ? 'bg-critical-soft text-critical-ink'
        : 'bg-sunk text-ink-soft';

  return (
    <div className="rounded-sm border border-line bg-paper p-5 transition-colors hover:border-line-strong">
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wider text-ink-mute">
            {label}
          </p>
          <p className={`mt-3 font-mono text-xl font-semibold tabular-nums ${valueColor}`}>
            {formatAmount(value)}
          </p>
          {hint !== undefined ? (
            <p className="mt-1 text-xs text-ink-mute">{hint}</p>
          ) : null}
        </div>
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-sm ${badge}`}>
          <Icon className="h-4 w-4" strokeWidth={1.5} />
        </span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Charts
// ─────────────────────────────────────────────────────────────────────────────

interface CaMargePoint {
  axisCode: string;
  ca: number;
  marge: number;
}

function CaMargeChart({ rows }: { rows: readonly MarginByAxisRow[] }) {
  const data: CaMargePoint[] = useMemo(
    () =>
      rows
        .map((r) => ({
          axisCode: r.axisCode,
          ca: toNum(r.chiffreAffaires),
          marge: toNum(r.margeBrute),
        }))
        .sort((a, b) => b.ca - a.ca)
        .slice(0, TOP_N_SEGMENTS),
    [rows],
  );

  return (
    <section className="rounded-sm border border-line bg-paper p-5">
      <div className="mb-4 border-b border-line pb-3">
        <h2 className="font-display text-lg font-medium text-ink">
          Chiffre d&apos;affaires et marge brute
        </h2>
        <p className="mt-1 text-sm text-ink-mute">
          Top {TOP_N_SEGMENTS} segments par CA
        </p>
      </div>
      <div className="h-[320px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-line)" />
            <XAxis
              dataKey="axisCode"
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 11, fill: 'var(--color-ink-mute)' }}
              interval={0}
              dy={8}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 11, fill: 'var(--color-ink-mute)' }}
              tickFormatter={formatShort}
              dx={-6}
            />
            <Tooltip cursor={{ fill: 'var(--color-sunk)' }} content={<CaMargeTooltip />} />
            <Bar
              dataKey="ca"
              name="CA"
              fill="var(--color-accent-soft)"
              stroke="var(--color-accent)"
              radius={[2, 2, 0, 0]}
            />
            <Bar
              dataKey="marge"
              name="Marge brute"
              fill="var(--color-accent)"
              radius={[2, 2, 0, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

function CaMargeTooltip({ active, payload, label }: TooltipShape<CaMargePoint>) {
  if (active !== true || payload === undefined || payload.length === 0) return null;
  const p = payload[0]?.payload;
  if (p === undefined) return null;
  return (
    <div className="min-w-[180px] rounded-sm border border-line bg-paper p-3 shadow-sm">
      <p className="mb-2 text-sm font-medium text-ink">{label}</p>
      <div className="space-y-1.5 text-xs">
        <Row label="CA" value={p.ca} />
        <Row label="Marge brute" value={p.marge} tone={p.marge >= 0 ? 'pos' : 'neg'} />
      </div>
    </div>
  );
}

interface ResultatPoint {
  axisCode: string;
  resultat: number;
}

function ResultatChart({ rows }: { rows: readonly MarginByAxisRow[] }) {
  const data: ResultatPoint[] = useMemo(
    () =>
      rows
        .map((r) => ({ axisCode: r.axisCode, resultat: toNum(r.resultatNet) }))
        .sort((a, b) => b.resultat - a.resultat)
        .slice(0, TOP_N_SEGMENTS),
    [rows],
  );

  return (
    <section className="rounded-sm border border-line bg-paper p-5">
      <div className="mb-4 border-b border-line pb-3">
        <h2 className="font-display text-lg font-medium text-ink">
          Contribution au résultat net
        </h2>
        <p className="mt-1 text-sm text-ink-mute">
          Segments contributeurs et destructeurs de valeur
        </p>
      </div>
      <div className="h-[320px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-line)" />
            <XAxis
              dataKey="axisCode"
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 11, fill: 'var(--color-ink-mute)' }}
              interval={0}
              dy={8}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 11, fill: 'var(--color-ink-mute)' }}
              tickFormatter={formatShort}
              dx={-6}
            />
            <Tooltip cursor={{ fill: 'var(--color-sunk)' }} content={<ResultatTooltip />} />
            <Bar dataKey="resultat" name="Résultat net" radius={[2, 2, 0, 0]}>
              {data.map((d) => (
                <Cell
                  key={d.axisCode}
                  fill={d.resultat >= 0 ? 'var(--color-accent)' : 'var(--color-critical)'}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

function ResultatTooltip({ active, payload, label }: TooltipShape<ResultatPoint>) {
  if (active !== true || payload === undefined || payload.length === 0) return null;
  const p = payload[0]?.payload;
  if (p === undefined) return null;
  return (
    <div className="min-w-[180px] rounded-sm border border-line bg-paper p-3 shadow-sm">
      <p className="mb-2 text-sm font-medium text-ink">{label}</p>
      <div className="space-y-1.5 text-xs">
        <Row
          label="Résultat net"
          value={p.resultat}
          tone={p.resultat >= 0 ? 'pos' : 'neg'}
        />
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: 'pos' | 'neg';
}) {
  const color =
    tone === 'pos' ? 'text-accent-ink' : tone === 'neg' ? 'text-critical-ink' : 'text-ink';
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-ink-mute">{label}</span>
      <span className={`font-mono tabular-nums ${color}`}>{formatAmount(value)}</span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Table
// ─────────────────────────────────────────────────────────────────────────────

function MarginTable({ report }: { report: MarginByAxisReport }) {
  return (
    <section className="rounded-sm border border-line bg-paper">
      <div className="border-b border-line p-5">
        <h2 className="font-display text-lg font-medium text-ink">Détail par segment</h2>
        <p className="mt-1 text-sm text-ink-mute">
          Décomposition complète SIG par axe « {labelForAxis(report.axisType)} ».
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="bg-sunk text-xs uppercase tracking-wider text-ink-mute">
              <th className="px-3 py-2 font-medium">Segment</th>
              <th className="px-3 py-2 text-right font-medium">CA</th>
              <th className="px-3 py-2 text-right font-medium">Achats consommés</th>
              <th className="px-3 py-2 text-right font-medium">Marge brute</th>
              <th className="px-3 py-2 text-right font-medium">Marge %</th>
              <th className="px-3 py-2 text-right font-medium">VA</th>
              <th className="px-3 py-2 text-right font-medium">Taux VA</th>
              <th className="px-3 py-2 text-right font-medium">EBE</th>
              <th className="px-3 py-2 text-right font-medium">Taux EBE</th>
              <th className="px-3 py-2 text-right font-medium">Charges perso.</th>
              <th className="px-3 py-2 text-right font-medium">Autres charges</th>
              <th className="px-3 py-2 text-right font-medium">Résultat net</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {report.rows.map((r) => (
              <DataRow key={r.axisCode} row={r} />
            ))}
          </tbody>
          <tfoot>
            <TotalsRow totals={report.totals} />
          </tfoot>
        </table>
      </div>
    </section>
  );
}

function DataRow({ row }: { row: MarginByAxisRow }) {
  return (
    <tr className="h-8 transition-colors hover:bg-sunk">
      <td className="px-3 py-1.5 font-medium text-ink">{row.axisCode}</td>
      <Num value={row.chiffreAffaires} />
      <Num value={row.achatsConsommes} />
      <Num value={row.margeBrute} signed />
      <Pct value={row.margeBrutePercent} colored />
      <Num value={row.valeurAjoutee} signed />
      <Pct value={row.tauxValeurAjoutee} />
      <Num value={row.excedentBrutExploit} signed />
      <Pct value={row.tauxEbe} />
      <Num value={row.chargesPersonnel} />
      <Num value={row.autresCharges} />
      <Num value={row.resultatNet} signed colored />
    </tr>
  );
}

function TotalsRow({ totals }: { totals: MarginByAxisRow }) {
  return (
    <tr className="h-8 bg-sunk font-medium text-ink">
      <td className="px-3 py-1.5">Total</td>
      <Num value={totals.chiffreAffaires} bold />
      <Num value={totals.achatsConsommes} bold />
      <Num value={totals.margeBrute} bold signed />
      <Pct value={totals.margeBrutePercent} bold colored />
      <Num value={totals.valeurAjoutee} bold signed />
      <Pct value={totals.tauxValeurAjoutee} bold />
      <Num value={totals.excedentBrutExploit} bold signed />
      <Pct value={totals.tauxEbe} bold />
      <Num value={totals.chargesPersonnel} bold />
      <Num value={totals.autresCharges} bold />
      <Num value={totals.resultatNet} bold signed colored />
    </tr>
  );
}

interface NumProps {
  value: string;
  bold?: boolean;
  signed?: boolean;
  colored?: boolean;
}

function Num({ value, bold = false, signed = false, colored = false }: NumProps) {
  const n = toNum(value);
  const color = colored
    ? n > 0
      ? 'text-accent-ink'
      : n < 0
        ? 'text-critical-ink'
        : 'text-ink'
    : 'text-ink';
  return (
    <td
      className={`px-3 py-1.5 text-right font-mono tabular-nums ${color} ${
        bold ? 'font-medium' : ''
      }`}
    >
      {signed ? formatSigned(n) : formatAmount(n)}
    </td>
  );
}

interface PctProps {
  value: string | null;
  bold?: boolean;
  colored?: boolean;
}

function Pct({ value, bold = false, colored = false }: PctProps) {
  const n = value !== null ? Number(value) : null;
  const color =
    colored && n !== null
      ? n >= 0
        ? 'text-accent-ink'
        : 'text-critical-ink'
      : 'text-ink-soft';
  return (
    <td
      className={`px-3 py-1.5 text-right font-mono tabular-nums ${color} ${
        bold ? 'font-medium' : ''
      }`}
    >
      {formatPercent(value)}
    </td>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// States
// ─────────────────────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center rounded-sm border border-line bg-paper py-16 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-sunk">
        <Inbox className="h-5 w-5 text-ink-mute" strokeWidth={1.5} />
      </span>
      <p className="mt-4 text-sm font-medium text-ink">
        Aucune donnée analytique sur cette période.
      </p>
      <p className="mt-1 max-w-[48ch] text-sm text-ink-mute">
        Taguez vos écritures par axe pour faire apparaître la rentabilité segment
        par segment.
      </p>
    </div>
  );
}

function ProfitabilitySkeleton() {
  return (
    <div className="animate-pulse space-y-8">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-28 rounded-sm border border-line bg-paper" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <div className="h-[380px] rounded-sm border border-line bg-paper" />
        <div className="h-[380px] rounded-sm border border-line bg-paper" />
      </div>
      <div className="h-64 rounded-sm border border-line bg-paper" />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

interface TooltipShape<T> {
  active?: boolean;
  label?: string;
  payload?: ReadonlyArray<{ payload: T }>;
}

const AXIS_LABELS: Record<string, string> = {
  CENTRE: 'Centre',
  PROJET: 'Projet',
  PRODUIT: 'Produit',
  ZONE: 'Zone',
  CLIENT: 'Client',
  CHANTIER: 'Chantier',
  BU: 'Business Unit',
  ACTIVITE: 'Activité',
};

function labelForAxis(axisType: string): string {
  return AXIS_LABELS[axisType.toUpperCase()] ?? axisType;
}

function toNum(value: string): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function formatAmount(amount: number): string {
  return new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatSigned(amount: number): string {
  const formatted = formatAmount(Math.abs(amount));
  if (amount < 0) return `-${formatted}`;
  return formatted;
}

function formatPercent(value: string | null): string {
  if (value === null) return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return `${new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(n)} %`;
}

function formatShort(val: number): string {
  if (Math.abs(val) >= 1_000_000) return `${(val / 1_000_000).toFixed(1)}M`;
  if (Math.abs(val) >= 1_000) return `${(val / 1_000).toFixed(0)}k`;
  return val.toString();
}
