'use client';

import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  CircleSlash,
  FileWarning,
  Loader2,
  Package,
  PieChart as PieIcon,
  Scale,
  TrendingDown,
  TrendingUp,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMemo } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { AppShell } from '@/components/app-shell';
import { FormError } from '@/components/ui/form-error';
import { ApiError, api } from '@/lib/api-client';
import { useCurrentOrg } from '@/stores/auth-store';
import type { ImportAnalytics } from '@/types/imports';

interface AnalyticsResponse {
  readonly analytics: ImportAnalytics;
}

const VALIDATION_ERROR_LABELS: Record<string, string> = {
  missing_required_field: 'Champ requis manquant',
  unknown_account: 'Compte inconnu',
  invalid_date: 'Date invalide',
  date_out_of_fiscal_year: 'Date hors exercice',
  invalid_amount: 'Montant invalide',
  debit_credit_both_zero: 'Débit et crédit à zéro',
  debit_credit_both_nonzero: 'Débit et crédit renseignés',
  negative_amount: 'Montant négatif',
};

/**
 * `/imports/[sessionId]/dashboard` — analytique d'une session d'import.
 */
export default function ImportDashboardPage() {
  const params = useParams<{ sessionId: string }>();
  const sessionId = params.sessionId;
  const currentOrg = useCurrentOrg();
  const orgId = currentOrg?.id ?? '';

  const analyticsQuery = useQuery<ImportAnalytics, ApiError>({
    queryKey: ['imports', 'analytics', orgId, sessionId],
    queryFn: async () => {
      const data = await api.get<AnalyticsResponse>(
        `/organizations/${orgId}/imports/sessions/${sessionId}/analytics`,
      );
      return data.analytics;
    },
    enabled: orgId !== '' && sessionId !== '',
  });

  return (
    <AppShell>
      <div className="animate-page-in space-y-6">
        <header className="flex items-start justify-between gap-4">
          <div>
            <Link
              href="/imports"
              className="mb-2 inline-flex items-center text-sm text-ink-mute transition-colors hover:text-ink"
            >
              <ArrowLeft className="mr-1 h-3.5 w-3.5" />
              Retour aux imports
            </Link>
            <p className="eyebrow mb-2">Session d&apos;import</p>
            <h1 className="font-display text-3xl font-medium tracking-tight text-ink">
              Analyse de la session d&apos;import
            </h1>
            <p className="mt-2 text-sm text-ink-mute">
              Vue analytique calculée à la volée à partir des lignes en staging — débit/crédit,
              journaux, comptes, classes SYSCOHADA, qualité du fichier.
            </p>
          </div>
          <Link
            href="/reports/console"
            className="press inline-flex items-center gap-2 rounded-sm border border-accent bg-accent px-3 py-1.5 text-sm font-medium text-paper transition-colors hover:bg-accent-ink"
            title="Générer le dossier annuel SYSCOHADA à partir des écritures validées"
          >
            <Package className="h-4 w-4" />
            Générer les états financiers
          </Link>
        </header>

        {analyticsQuery.isLoading && (
          <section className="rounded-sm border border-line bg-paper p-5">
            <div className="flex items-center gap-2 py-12 text-sm text-ink-mute">
              <Loader2 className="h-4 w-4 animate-spin" />
              Calcul de l&apos;analyse en cours…
            </div>
          </section>
        )}

        {analyticsQuery.error && <FormError error={analyticsQuery.error} />}

        {analyticsQuery.data && <AnalyticsDashboard analytics={analyticsQuery.data} />}
      </div>
    </AppShell>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Dashboard principal
// ─────────────────────────────────────────────────────────────────────

function AnalyticsDashboard({ analytics }: { analytics: ImportAnalytics }) {
  const { kpis, daily, byJournal, topAccounts, byAccountClass, errorBreakdown } = analytics;

  return (
    <>
      {/* KPIs */}
      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          icon={<BookOpen className="h-4 w-4 text-ink-mute" />}
          label="Lignes importées"
          value={fmtInt(kpis.totalLines)}
          hint={`${kpis.distinctJournals} journaux · ${kpis.distinctAccounts} comptes`}
        />
        <KpiCard
          icon={<TrendingUp className="h-4 w-4 text-accent-ink" />}
          label="Total débit"
          value={fmtMoney(kpis.totalDebit, analytics.currency)}
          hint={`Crédit : ${fmtMoney(kpis.totalCredit, analytics.currency)}`}
        />
        <KpiCard
          icon={
            <Scale
              className={`h-4 w-4 ${kpis.isBalanced ? 'text-accent-ink' : 'text-warn-ink'}`}
            />
          }
          label="Équilibre D − C"
          value={fmtMoney(kpis.netBalance, analytics.currency)}
          hint={kpis.isBalanced ? 'Écritures équilibrées' : 'Déséquilibre détecté'}
          tone={kpis.isBalanced ? 'success' : 'warning'}
        />
        <KpiCard
          icon={
            kpis.errorLines === 0 ? (
              <CheckCircle2 className="h-4 w-4 text-accent-ink" />
            ) : (
              <AlertTriangle className="h-4 w-4 text-critical-ink" />
            )
          }
          label="Taux de validité"
          value={`${kpis.validRatePercent.toFixed(1)} %`}
          hint={`${fmtInt(kpis.validLines)} valides · ${fmtInt(kpis.errorLines)} en erreur`}
          tone={kpis.errorLines === 0 ? 'success' : 'warning'}
        />
      </section>

      {/* Period + partners */}
      <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="rounded-sm border border-line bg-paper p-5">
          <p className="text-xs uppercase tracking-wide text-ink-mute">Période couverte</p>
          <p className="mt-2 font-display text-xl font-medium text-ink">
            {kpis.periodStart ?? '—'} → {kpis.periodEnd ?? '—'}
          </p>
        </div>
        <div className="rounded-sm border border-line bg-paper p-5">
          <p className="text-xs uppercase tracking-wide text-ink-mute">Tiers distincts</p>
          <p className="mt-2 font-display text-xl font-medium text-ink">
            <Users className="mr-2 inline h-4 w-4 text-ink-mute" />
            {fmtInt(kpis.distinctPartners)}
          </p>
        </div>
        <div className="rounded-sm border border-line bg-paper p-5">
          <p className="text-xs uppercase tracking-wide text-ink-mute">Devise</p>
          <p className="mt-2 font-display text-xl font-medium text-ink">{analytics.currency}</p>
        </div>
      </section>

      {/* Évolution journalière */}
      <section className="rounded-sm border border-line bg-paper p-5">
        <div className="border-b border-line pb-3">
          <h2 className="font-display text-xl font-medium text-ink">
            Évolution journalière débit / crédit
          </h2>
          <p className="mt-1 text-sm text-ink-mute">
            Somme des débits et crédits par jour ouvré présent dans le fichier importé.
          </p>
        </div>
        <div className="mt-4">
          {daily.length === 0 ? (
            <EmptyHint icon={<CircleSlash className="h-4 w-4" />}>
              Aucune date valide dans le fichier — impossible de tracer l&apos;évolution
              temporelle.
            </EmptyHint>
          ) : (
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={daily.map((p) => ({
                    date: p.date,
                    debit: Number(p.debit),
                    credit: Number(p.credit),
                    net: Number(p.net),
                  }))}
                  margin={{ top: 5, right: 10, left: 0, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="oklch(var(--line))" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => fmtShort(v)} />
                  <Tooltip formatter={(v) => fmtMoney(Number(v), analytics.currency)} />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="debit"
                    stroke="oklch(var(--accent))"
                    strokeWidth={2}
                    dot={false}
                    name="Débit"
                  />
                  <Line
                    type="monotone"
                    dataKey="credit"
                    stroke="oklch(var(--critical))"
                    strokeWidth={2}
                    dot={false}
                    name="Crédit"
                  />
                  <Line
                    type="monotone"
                    dataKey="net"
                    stroke="oklch(var(--info))"
                    strokeDasharray="5 5"
                    dot={false}
                    name="Net"
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </section>

      {/* Histogramme par journal + Classes SYSCOHADA */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-sm border border-line bg-paper p-5">
          <div className="border-b border-line pb-3">
            <h2 className="font-display text-xl font-medium text-ink">Répartition par journal</h2>
            <p className="mt-1 text-sm text-ink-mute">
              Volume débit + crédit par journal ({byJournal.length} journaux).
            </p>
          </div>
          <div className="mt-4">
            {byJournal.length === 0 ? (
              <EmptyHint icon={<CircleSlash className="h-4 w-4" />}>
                Pas de journal renseigné dans le fichier.
              </EmptyHint>
            ) : (
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={byJournal.slice(0, 10).map((j) => ({
                      journal: j.journal,
                      Débit: Number(j.debit),
                      Crédit: Number(j.credit),
                    }))}
                    margin={{ top: 5, right: 10, left: 0, bottom: 5 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="oklch(var(--line))" />
                    <XAxis dataKey="journal" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => fmtShort(v)} />
                    <Tooltip formatter={(v) => fmtMoney(Number(v), analytics.currency)} />
                    <Legend />
                    <Bar dataKey="Débit" fill="oklch(var(--accent))" />
                    <Bar dataKey="Crédit" fill="oklch(var(--critical))" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </div>

        <div className="rounded-sm border border-line bg-paper p-5">
          <div className="border-b border-line pb-3">
            <h2 className="font-display text-xl font-medium text-ink">
              <PieIcon className="mr-2 inline h-4 w-4 text-ink-mute" />
              Classes SYSCOHADA
            </h2>
            <p className="mt-1 text-sm text-ink-mute">
              Distribution des lignes par 1er digit du compte.
            </p>
          </div>
          <div className="mt-4">
            <ClassPie data={byAccountClass} />
          </div>
        </div>
      </section>

      {/* Top comptes */}
      <section className="rounded-sm border border-line bg-paper p-5">
        <div className="border-b border-line pb-3">
          <h2 className="font-display text-xl font-medium text-ink">Top 10 comptes par mouvement</h2>
          <p className="mt-1 text-sm text-ink-mute">
            Comptes avec le plus grand écart |débit − crédit|.
          </p>
        </div>
        <div className="mt-4">
          {topAccounts.length === 0 ? (
            <EmptyHint icon={<CircleSlash className="h-4 w-4" />}>
              Aucun compte renseigné dans le fichier.
            </EmptyHint>
          ) : (
            <div className="overflow-x-auto rounded-sm border border-line">
              <table className="w-full text-sm">
                <thead className="bg-sunk">
                  <tr>
                    <th className="px-3 py-2 text-left">
                      <span className="eyebrow">#</span>
                    </th>
                    <th className="px-3 py-2 text-left">
                      <span className="eyebrow">Compte</span>
                    </th>
                    <th className="px-3 py-2 text-right">
                      <span className="eyebrow">Débit</span>
                    </th>
                    <th className="px-3 py-2 text-right">
                      <span className="eyebrow">Crédit</span>
                    </th>
                    <th className="px-3 py-2 text-right">
                      <span className="eyebrow">Mouvement</span>
                    </th>
                    <th className="px-3 py-2 text-right">
                      <span className="eyebrow">Lignes</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {topAccounts.map((a, i) => {
                    return (
                      <tr
                        key={a.account}
                        className="border-t border-line transition-colors duration-fast hover:bg-sunk/50"
                      >
                        <td className="px-3 py-2 text-ink-mute">{i + 1}</td>
                        <td className="px-3 py-2 font-mono text-ink">{a.account}</td>
                        <td className="px-3 py-2 text-right font-mono text-accent-ink">
                          {fmtMoney(a.debit, analytics.currency)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-critical-ink">
                          {fmtMoney(a.credit, analytics.currency)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono font-semibold text-ink">
                          {fmtMoney(a.movement, analytics.currency)}
                        </td>
                        <td className="px-3 py-2 text-right text-ink-mute">{a.lines}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {/* Qualité — erreurs */}
      <section className="rounded-sm border border-line bg-paper p-5">
        <div className="border-b border-line pb-3">
          <h2 className="font-display text-xl font-medium text-ink">
            <FileWarning className="mr-2 inline h-4 w-4 text-ink-mute" />
            Qualité du fichier
          </h2>
          <p className="mt-1 text-sm text-ink-mute">
            Codes d&apos;erreurs détectés par la validation.
          </p>
        </div>
        <div className="mt-4">
          {errorBreakdown.length === 0 ? (
            <p className="flex items-center gap-2 text-sm text-accent-ink">
              <CheckCircle2 className="h-4 w-4" />
              Aucune erreur de validation détectée. Le fichier est prêt pour commit.
            </p>
          ) : (
            <div className="space-y-2">
              {errorBreakdown.map((e) => (
                <div key={e.code} className="flex items-center gap-3">
                  <div className="w-56 text-sm text-ink">
                    {VALIDATION_ERROR_LABELS[e.code] ?? e.code}
                  </div>
                  <div className="relative h-5 flex-1 overflow-hidden rounded-sm bg-sunk">
                    <div
                      className="absolute inset-y-0 left-0 bg-critical-ink/80"
                      style={{ width: `${Math.min(100, e.sharePercent * 4)}%` }}
                    />
                  </div>
                  <div className="w-24 text-right text-sm tabular-nums text-ink">
                    {fmtInt(e.count)}{' '}
                    <span className="text-ink-mute">({e.sharePercent.toFixed(1)}%)</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Insights synthétique */}
      <section className="rounded-sm border border-line bg-paper p-5">
        <div className="border-b border-line pb-3">
          <h2 className="font-display text-xl font-medium text-ink">Analyse de synthèse</h2>
          <p className="mt-1 text-sm text-ink-mute">
            Lecture rapide automatique du fichier importé.
          </p>
        </div>
        <ul className="mt-4 space-y-2 text-sm text-ink">
          {buildInsights(analytics).map((insight, idx) => (
            <li key={idx} className="flex items-start gap-2">
              <span className="mt-0.5">{insight.icon}</span>
              <span>{insight.text}</span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Sous-composants
// ─────────────────────────────────────────────────────────────────────

interface KpiCardProps {
  readonly icon: React.ReactNode;
  readonly label: string;
  readonly value: string;
  readonly hint?: string;
  readonly tone?: 'success' | 'warning' | 'default';
}

function KpiCard({ icon, label, value, hint, tone = 'default' }: KpiCardProps) {
  const toneBorder =
    tone === 'success'
      ? 'border-accent-soft'
      : tone === 'warning'
        ? 'border-warn-soft'
        : 'border-line';
  return (
    <div className={`rounded-sm border bg-paper p-5 ${toneBorder}`}>
      <div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-ink-mute">
        {icon}
        {label}
      </div>
      <div className="mt-2 font-display text-2xl font-medium tabular-nums text-ink">{value}</div>
      {hint !== undefined && <p className="mt-1 text-xs text-ink-mute">{hint}</p>}
    </div>
  );
}

const CLASS_COLORS = [
  'oklch(var(--info))',
  'oklch(var(--accent))',
  'oklch(var(--warn))',
  'oklch(var(--critical))',
  'oklch(52% 0.16 295)', // violet
  'oklch(60% 0.14 220)', // sky
  'oklch(58% 0.18 350)', // pink
  'oklch(62% 0.15 125)', // lime
  'oklch(var(--ink-mute))', // neutral / autre
];

interface ClassPieProps {
  readonly data: ReadonlyArray<{
    readonly accountClass: string;
    readonly classLabel: string;
    readonly lines: number;
  }>;
}

function ClassPie({ data }: ClassPieProps) {
  const chartData = useMemo(
    () => data.filter((d) => d.lines > 0).map((d) => ({ name: d.classLabel, value: d.lines })),
    [data],
  );

  if (chartData.length === 0) {
    return (
      <EmptyHint icon={<CircleSlash className="h-4 w-4" />}>
        Pas de compte renseigné — impossible de classer.
      </EmptyHint>
    );
  }

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Tooltip formatter={(v) => `${Number(v)} lignes`} />
          <Pie
            data={chartData}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            outerRadius={80}
            label={(entry: { name?: string }) => {
              const name = entry.name ?? '';
              return name.split(' — ')[0] ?? name;
            }}
            labelLine={false}
            style={{ fontSize: 11 }}
          >
            {chartData.map((_, i) => (
              <Cell key={i} fill={CLASS_COLORS[i % CLASS_COLORS.length]} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

function EmptyHint({
  icon,
  children,
}: {
  readonly icon: React.ReactNode;
  readonly children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 rounded-sm border border-dashed border-line bg-sunk/30 px-4 py-6 text-sm text-ink-mute">
      {icon}
      <span>{children}</span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Insights — règles déterministes (pas d'IA, mais texte humain)
// ─────────────────────────────────────────────────────────────────────

function buildInsights(a: ImportAnalytics): Array<{ icon: React.ReactNode; text: string }> {
  const out: Array<{ icon: React.ReactNode; text: string }> = [];
  const { kpis, byJournal, topAccounts, byAccountClass, errorBreakdown } = a;

  // Volumétrie
  out.push({
    icon: <BookOpen className="h-4 w-4 text-ink-mute" />,
    text: `${fmtInt(kpis.totalLines)} ligne(s) projetée(s) sur ${kpis.distinctJournals} journal/journaux et ${kpis.distinctAccounts} compte(s).`,
  });

  // Équilibre
  if (kpis.isBalanced) {
    out.push({
      icon: <CheckCircle2 className="h-4 w-4 text-accent-ink" />,
      text: `Le fichier est équilibré (débit = crédit = ${fmtMoney(kpis.totalDebit, a.currency)}).`,
    });
  } else {
    out.push({
      icon: <Scale className="h-4 w-4 text-warn-ink" />,
      text: `Déséquilibre de ${fmtMoney(kpis.netBalance, a.currency)} entre débit et crédit — l'écriture comptable ne sera pas acceptée telle quelle.`,
    });
  }

  // Journal dominant
  if (byJournal.length > 0) {
    const top = byJournal[0]!;
    out.push({
      icon: <TrendingUp className="h-4 w-4 text-info-ink" />,
      text: `Journal le plus actif : "${top.journal}" (${fmtInt(top.lines)} ligne(s), ${fmtMoney(top.total, a.currency)} de volume).`,
    });
  }

  // Compte dominant
  if (topAccounts.length > 0) {
    const top = topAccounts[0]!;
    out.push({
      icon: <TrendingUp className="h-4 w-4 text-info-ink" />,
      text: `Compte avec le mouvement le plus fort : ${top.account} → ${fmtMoney(top.movement, a.currency)}.`,
    });
  }

  // Classe dominante
  const dominantClass = [...byAccountClass].sort((x, y) => y.lines - x.lines)[0];
  if (dominantClass !== undefined && dominantClass.lines > 0) {
    out.push({
      icon: <PieIcon className="h-4 w-4 text-ink-soft" />,
      text: `${dominantClass.classLabel} concentre ${fmtInt(dominantClass.lines)} ligne(s).`,
    });
  }

  // Erreurs
  if (errorBreakdown.length === 0) {
    out.push({
      icon: <CheckCircle2 className="h-4 w-4 text-accent-ink" />,
      text: `Aucune erreur de validation — le fichier est prêt pour commit définitif au journal.`,
    });
  } else {
    const dominantErr = errorBreakdown[0]!;
    out.push({
      icon: <AlertTriangle className="h-4 w-4 text-critical-ink" />,
      text: `Erreur la plus fréquente : "${VALIDATION_ERROR_LABELS[dominantErr.code] ?? dominantErr.code}" sur ${fmtInt(dominantErr.count)} ligne(s) (${dominantErr.sharePercent.toFixed(1)}%).`,
    });
  }

  // Période
  if (kpis.periodStart !== null && kpis.periodEnd !== null) {
    out.push({
      icon: <TrendingDown className="h-4 w-4 text-ink-mute" />,
      text: `Période couverte : du ${kpis.periodStart} au ${kpis.periodEnd}.`,
    });
  }

  return out;
}

// ─────────────────────────────────────────────────────────────────────
// Formatters
// ─────────────────────────────────────────────────────────────────────

function fmtMoney(value: string | number, currency: string): string {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return '—';
  return `${n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

function fmtInt(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return value.toLocaleString('fr-FR');
}

function fmtShort(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(0)}k`;
  return `${value}`;
}
