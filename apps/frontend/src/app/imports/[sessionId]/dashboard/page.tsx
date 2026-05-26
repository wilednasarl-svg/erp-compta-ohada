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
 *
 * Surface : 4 KPI cards, courbe journalière débit/crédit, histogramme
 * par journal, top 10 comptes, répartition par classe SYSCOHADA,
 * distribution des erreurs de validation.
 *
 * Donnée : `GET /organizations/:orgId/imports/sessions/:sessionId/analytics`.
 * Calculée à la volée côté backend depuis les staging entries — pas de
 * snapshot, donc toujours frais. Fonctionne avant ET après commit.
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
      <div className="space-y-6">
        <header className="flex items-start justify-between gap-4">
          <div>
            <Link
              href="/imports"
              className="mb-2 inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="mr-1 h-3.5 w-3.5" />
              Retour aux imports
            </Link>
            <h1 className="text-2xl font-semibold tracking-tight">
              Analyse de la session d&apos;import
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Vue analytique calculée à la volée à partir des lignes en staging — débit/crédit,
              journaux, comptes, classes SYSCOHADA, qualité du fichier.
            </p>
          </div>
          <Link
            href="/reports"
            className="inline-flex items-center gap-2 rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-emerald-700"
            title="Générer le dossier annuel SYSCOHADA à partir des écritures validées"
          >
            <Package className="h-4 w-4" />
            Générer les états financiers
          </Link>
        </header>

        {analyticsQuery.isLoading && (
          <Card>
            <CardContent className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Calcul de l&apos;analyse en cours…
            </CardContent>
          </Card>
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
          icon={<BookOpen className="h-4 w-4" />}
          label="Lignes importées"
          value={fmtInt(kpis.totalLines)}
          hint={`${kpis.distinctJournals} journaux · ${kpis.distinctAccounts} comptes`}
        />
        <KpiCard
          icon={<TrendingUp className="h-4 w-4 text-emerald-600" />}
          label="Total débit"
          value={fmtMoney(kpis.totalDebit, analytics.currency)}
          hint={`Crédit : ${fmtMoney(kpis.totalCredit, analytics.currency)}`}
        />
        <KpiCard
          icon={<Scale className={kpis.isBalanced ? 'h-4 w-4 text-emerald-600' : 'h-4 w-4 text-amber-600'} />}
          label="Équilibre D − C"
          value={fmtMoney(kpis.netBalance, analytics.currency)}
          hint={kpis.isBalanced ? 'Écritures équilibrées' : 'Déséquilibre détecté'}
          tone={kpis.isBalanced ? 'success' : 'warning'}
        />
        <KpiCard
          icon={
            kpis.errorLines === 0 ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            ) : (
              <AlertTriangle className="h-4 w-4 text-destructive" />
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
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Période couverte</CardDescription>
            <CardTitle className="text-base">
              {kpis.periodStart ?? '—'} → {kpis.periodEnd ?? '—'}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Tiers distincts</CardDescription>
            <CardTitle className="text-base">
              <Users className="mr-2 inline h-4 w-4 text-muted-foreground" />
              {fmtInt(kpis.distinctPartners)}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Devise</CardDescription>
            <CardTitle className="text-base">{analytics.currency}</CardTitle>
          </CardHeader>
        </Card>
      </section>

      {/* Évolution journalière */}
      <Card>
        <CardHeader>
          <CardTitle>Évolution journalière débit / crédit</CardTitle>
          <CardDescription>
            Somme des débits et crédits par jour ouvré présent dans le fichier importé.
          </CardDescription>
        </CardHeader>
        <CardContent>
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
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => fmtShort(v)} />
                  <Tooltip formatter={(v) => fmtMoney(Number(v), analytics.currency)} />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="debit"
                    stroke="#16a34a"
                    strokeWidth={2}
                    dot={false}
                    name="Débit"
                  />
                  <Line
                    type="monotone"
                    dataKey="credit"
                    stroke="#dc2626"
                    strokeWidth={2}
                    dot={false}
                    name="Crédit"
                  />
                  <Line
                    type="monotone"
                    dataKey="net"
                    stroke="#2563eb"
                    strokeDasharray="5 5"
                    dot={false}
                    name="Net"
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Histogramme par journal + Classes SYSCOHADA */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Répartition par journal</CardTitle>
            <CardDescription>
              Volume débit + crédit par journal ({byJournal.length} journaux).
            </CardDescription>
          </CardHeader>
          <CardContent>
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
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="journal" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => fmtShort(v)} />
                    <Tooltip formatter={(v) => fmtMoney(Number(v), analytics.currency)} />
                    <Legend />
                    <Bar dataKey="Débit" fill="#16a34a" />
                    <Bar dataKey="Crédit" fill="#dc2626" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              <PieIcon className="mr-2 inline h-4 w-4" />
              Classes SYSCOHADA
            </CardTitle>
            <CardDescription>Distribution des lignes par 1er digit du compte.</CardDescription>
          </CardHeader>
          <CardContent>
            <ClassPie data={byAccountClass} />
          </CardContent>
        </Card>
      </section>

      {/* Top comptes */}
      <Card>
        <CardHeader>
          <CardTitle>Top 10 comptes par mouvement</CardTitle>
          <CardDescription>
            Comptes avec le plus grand écart |débit − crédit|.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {topAccounts.length === 0 ? (
            <EmptyHint icon={<CircleSlash className="h-4 w-4" />}>
              Aucun compte renseigné dans le fichier.
            </EmptyHint>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">#</th>
                    <th className="px-3 py-2 text-left">Compte</th>
                    <th className="px-3 py-2 text-right">Débit</th>
                    <th className="px-3 py-2 text-right">Crédit</th>
                    <th className="px-3 py-2 text-right">Mouvement</th>
                    <th className="px-3 py-2 text-right">Lignes</th>
                  </tr>
                </thead>
                <tbody>
                  {topAccounts.map((a, i) => (
                    <tr key={a.account} className="border-t">
                      <td className="px-3 py-2 text-muted-foreground">{i + 1}</td>
                      <td className="px-3 py-2 font-mono">{a.account}</td>
                      <td className="px-3 py-2 text-right text-emerald-700">
                        {fmtMoney(a.debit, analytics.currency)}
                      </td>
                      <td className="px-3 py-2 text-right text-red-700">
                        {fmtMoney(a.credit, analytics.currency)}
                      </td>
                      <td className="px-3 py-2 text-right font-semibold">
                        {fmtMoney(a.movement, analytics.currency)}
                      </td>
                      <td className="px-3 py-2 text-right text-muted-foreground">{a.lines}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Qualité — erreurs */}
      <Card>
        <CardHeader>
          <CardTitle>
            <FileWarning className="mr-2 inline h-4 w-4" />
            Qualité du fichier
          </CardTitle>
          <CardDescription>Codes d&apos;erreurs détectés par la validation.</CardDescription>
        </CardHeader>
        <CardContent>
          {errorBreakdown.length === 0 ? (
            <p className="flex items-center gap-2 text-sm text-emerald-700">
              <CheckCircle2 className="h-4 w-4" />
              Aucune erreur de validation détectée. Le fichier est prêt pour commit.
            </p>
          ) : (
            <div className="space-y-2">
              {errorBreakdown.map((e) => (
                <div key={e.code} className="flex items-center gap-3">
                  <div className="w-56 text-sm">
                    {VALIDATION_ERROR_LABELS[e.code] ?? e.code}
                  </div>
                  <div className="relative h-5 flex-1 overflow-hidden rounded bg-muted">
                    <div
                      className="absolute inset-y-0 left-0 bg-destructive/80"
                      style={{ width: `${Math.min(100, e.sharePercent * 4)}%` }}
                    />
                  </div>
                  <div className="w-24 text-right text-sm tabular-nums">
                    {fmtInt(e.count)}{' '}
                    <span className="text-muted-foreground">({e.sharePercent.toFixed(1)}%)</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Insights synthétique */}
      <Card>
        <CardHeader>
          <CardTitle>Analyse de synthèse</CardTitle>
          <CardDescription>Lecture rapide automatique du fichier importé.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2 text-sm">
            {buildInsights(analytics).map((insight, idx) => (
              <li key={idx} className="flex items-start gap-2">
                <span className="mt-0.5">{insight.icon}</span>
                <span>{insight.text}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
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
  const toneRing =
    tone === 'success'
      ? 'ring-1 ring-emerald-100'
      : tone === 'warning'
        ? 'ring-1 ring-amber-100'
        : '';
  return (
    <Card className={toneRing}>
      <CardHeader className="pb-2">
        <CardDescription className="flex items-center gap-1.5">
          {icon}
          {label}
        </CardDescription>
        <CardTitle className="text-2xl tabular-nums">{value}</CardTitle>
      </CardHeader>
      {hint !== undefined && (
        <CardContent className="pt-0">
          <p className="text-xs text-muted-foreground">{hint}</p>
        </CardContent>
      )}
    </Card>
  );
}

const CLASS_COLORS = [
  '#2563eb', // blue
  '#16a34a', // green
  '#f59e0b', // amber
  '#dc2626', // red
  '#7c3aed', // violet
  '#0ea5e9', // sky
  '#ec4899', // pink
  '#65a30d', // lime
  '#94a3b8', // slate (autre)
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
    <div className="flex items-center gap-2 rounded-md border border-dashed bg-muted/30 px-4 py-6 text-sm text-muted-foreground">
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
    icon: <BookOpen className="h-4 w-4 text-muted-foreground" />,
    text: `${fmtInt(kpis.totalLines)} ligne(s) projetée(s) sur ${kpis.distinctJournals} journal/journaux et ${kpis.distinctAccounts} compte(s).`,
  });

  // Équilibre
  if (kpis.isBalanced) {
    out.push({
      icon: <CheckCircle2 className="h-4 w-4 text-emerald-600" />,
      text: `Le fichier est équilibré (débit = crédit = ${fmtMoney(kpis.totalDebit, a.currency)}).`,
    });
  } else {
    out.push({
      icon: <Scale className="h-4 w-4 text-amber-600" />,
      text: `Déséquilibre de ${fmtMoney(kpis.netBalance, a.currency)} entre débit et crédit — l'écriture comptable ne sera pas acceptée telle quelle.`,
    });
  }

  // Journal dominant
  if (byJournal.length > 0) {
    const top = byJournal[0]!;
    out.push({
      icon: <TrendingUp className="h-4 w-4 text-blue-600" />,
      text: `Journal le plus actif : "${top.journal}" (${fmtInt(top.lines)} ligne(s), ${fmtMoney(top.total, a.currency)} de volume).`,
    });
  }

  // Compte dominant
  if (topAccounts.length > 0) {
    const top = topAccounts[0]!;
    out.push({
      icon: <TrendingUp className="h-4 w-4 text-blue-600" />,
      text: `Compte avec le mouvement le plus fort : ${top.account} → ${fmtMoney(top.movement, a.currency)}.`,
    });
  }

  // Classe dominante
  const dominantClass = [...byAccountClass].sort((x, y) => y.lines - x.lines)[0];
  if (dominantClass !== undefined && dominantClass.lines > 0) {
    out.push({
      icon: <PieIcon className="h-4 w-4 text-violet-600" />,
      text: `${dominantClass.classLabel} concentre ${fmtInt(dominantClass.lines)} ligne(s).`,
    });
  }

  // Erreurs
  if (errorBreakdown.length === 0) {
    out.push({
      icon: <CheckCircle2 className="h-4 w-4 text-emerald-600" />,
      text: `Aucune erreur de validation — le fichier est prêt pour commit définitif au journal.`,
    });
  } else {
    const dominantErr = errorBreakdown[0]!;
    out.push({
      icon: <AlertTriangle className="h-4 w-4 text-destructive" />,
      text: `Erreur la plus fréquente : "${VALIDATION_ERROR_LABELS[dominantErr.code] ?? dominantErr.code}" sur ${fmtInt(dominantErr.count)} ligne(s) (${dominantErr.sharePercent.toFixed(1)}%).`,
    });
  }

  // Période
  if (kpis.periodStart !== null && kpis.periodEnd !== null) {
    out.push({
      icon: <TrendingDown className="h-4 w-4 text-muted-foreground" />,
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
