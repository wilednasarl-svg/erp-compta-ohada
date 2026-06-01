'use client';

/**
 * Console « Diagnostic d'import » — pre-flight check d'une session d'import.
 *
 * Affiche la balance des comptes telle qu'elle résulterait du commit, les
 * anomalies classées par sévérité (bloquant / avertissement / info) et un
 * plan de normalisation actionnable. La lecture porte sur le STAGING — avant
 * le commit en comptabilité, jamais sur les journaux validés.
 *
 * Tous les chiffres (totaux, verdict, anomalies) proviennent du rapport
 * backend `report` et sont affichés tels quels : AUCUN recalcul côté client.
 *
 * Portage net-new du panneau legacy `ImportDiagnosticPanel`
 * (apps/frontend/src/app/reports/page.tsx). Différence avec le legacy :
 * l'export PDF utilisait un `void api.download(...)` qui avalait toute
 * erreur silencieusement. Ici, le téléchargement est `await` dans un
 * try/catch, avec un état d'erreur affiché et un état `downloading` qui
 * désactive le bouton et montre un spinner.
 */

import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  BookText,
  CheckCircle2,
  FileText,
  Info,
  Loader2,
  Stethoscope,
  XCircle,
} from 'lucide-react';
import { useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FormError } from '@/components/ui/form-error';
import { Label } from '@/components/ui/label';
import { ApiError, api } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import type {
  ImportAnomalyGroup,
  ImportDiagnosticReport,
  ImportSessionSummary,
} from '@/types/reports';

interface ImportSessionsEnvelope {
  readonly sessions: ReadonlyArray<ImportSessionSummary>;
}

interface ImportDiagnosticEnvelope {
  readonly report: ImportDiagnosticReport;
}

/**
 * Formate un montant DECIMAL string (`'1234.50'`) en notation fr-FR
 * (`'1 234,50'`). Renvoie la valeur brute si non finie. Aucun calcul
 * métier — simple présentation.
 */
function fmt(amount: string): string {
  const n = Number(amount);
  if (!Number.isFinite(n)) {
    return amount;
  }
  return n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatSessionLabel(s: ImportSessionSummary): string {
  const date = new Date(s.createdAt).toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  const docType = s.documentType !== null ? ` — ${s.documentType}` : '';
  const label = s.label !== null && s.label !== '' ? s.label : `Session ${s.id.slice(0, 8)}`;
  return `${date} · ${label}${docType} (${s.status}, ${s.totalLines} lignes)`;
}

export function ImportDiagnosticConsole({ orgId }: { readonly orgId: string }) {
  const [selectedSessionId, setSelectedSessionId] = useState<string>('');
  const [downloading, setDownloading] = useState<boolean>(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const sessionsQuery = useQuery<ImportSessionsEnvelope, ApiError>({
    queryKey: ['imports', 'sessions', orgId],
    queryFn: () => api.get<ImportSessionsEnvelope>(`/organizations/${orgId}/imports/sessions`),
    enabled: orgId !== '',
  });

  const eligibleSessions = useMemo(() => {
    const sessions = sessionsQuery.data?.sessions ?? [];
    return sessions.filter((s) =>
      ['parsed', 'validated', 'ready_for_import', 'completed'].includes(s.status),
    );
  }, [sessionsQuery.data]);

  // Auto-select the most recent eligible session (no useEffect needed —
  // derived state: explicit selection wins, otherwise fall back to head).
  const activeSessionId =
    selectedSessionId !== '' ? selectedSessionId : (eligibleSessions[0]?.id ?? '');

  const diagQuery = useQuery<ImportDiagnosticReport, ApiError>({
    queryKey: ['reports', 'import-diagnostic', orgId, activeSessionId],
    queryFn: async () => {
      const env = await api.get<ImportDiagnosticEnvelope>(
        `/organizations/${orgId}/reports/import-diagnostic/${activeSessionId}`,
      );
      return env.report;
    },
    enabled: orgId !== '' && activeSessionId !== '',
  });

  /**
   * Télécharge le PDF du diagnostic. Contrairement au legacy
   * (`void api.download(...)`), on attend la promesse et on capture toute
   * erreur pour l'afficher à l'utilisateur — pas de rejet silencieux.
   */
  async function handleDownloadPdf(): Promise<void> {
    if (activeSessionId === '') return;
    setDownloadError(null);
    setDownloading(true);
    try {
      await api.download(
        `/organizations/${orgId}/reports/import-diagnostic/${activeSessionId}.pdf`,
        `import-diagnostic-${activeSessionId}.pdf`,
      );
    } catch (error: unknown) {
      const message =
        error instanceof ApiError
          ? error.message
          : error instanceof Error
            ? error.message
            : 'Téléchargement du PDF impossible. Réessayez.';
      setDownloadError(message);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Stethoscope className="h-5 w-5" />
          Diagnostic d&apos;import
        </CardTitle>
        <CardDescription>
          Scan de santé d&apos;une session d&apos;import : balance prévisionnelle, points de vigilance,
          anomalies bloquantes et plan de normalisation pour rendre le fichier conforme OHADA.
          Cette analyse porte sur les lignes en staging — AVANT le commit en comptabilité.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Sélecteur de session */}
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[280px]">
            <Label htmlFor="diag-session">Session d&apos;import</Label>
            <select
              id="diag-session"
              className="mt-1 block w-full rounded-sm border border-line-strong bg-paper px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/40"
              value={activeSessionId}
              onChange={(e) => setSelectedSessionId(e.target.value)}
              disabled={sessionsQuery.isPending || eligibleSessions.length === 0}
            >
              {eligibleSessions.length === 0 && (
                <option value="">— aucune session éligible —</option>
              )}
              {eligibleSessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {formatSessionLabel(s)}
                </option>
              ))}
            </select>
          </div>
          {diagQuery.isFetching && (
            <Loader2 className="h-5 w-5 animate-spin text-ink-mute" aria-label="chargement" />
          )}
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              void handleDownloadPdf();
            }}
            disabled={activeSessionId === '' || diagQuery.data === undefined || downloading}
          >
            {downloading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <FileText className="mr-2 h-4 w-4" />
            )}
            Télécharger PDF
          </Button>
        </div>

        {downloadError !== null ? (
          <p role="alert" className="text-xs text-critical-ink">
            {downloadError}
          </p>
        ) : null}

        {sessionsQuery.isError ? <FormError error={sessionsQuery.error} /> : null}
        {diagQuery.isError ? <FormError error={diagQuery.error} /> : null}

        {sessionsQuery.isSuccess && eligibleSessions.length === 0 && (
          <div className="rounded border border-line bg-sunk p-4 text-sm text-ink-soft">
            Aucune session d&apos;import éligible. Charge un fichier dans l&apos;onglet{' '}
            <em>Imports</em> et lance la validation pour le voir apparaître ici.
          </div>
        )}

        {diagQuery.data !== undefined && (
          <>
            <VerdictBanner report={diagQuery.data} />
            <ImportTrialBalanceTable report={diagQuery.data} />
            <AnomalySection anomalies={diagQuery.data.anomalies} />
            {diagQuery.data.remediationPlan.length > 0 && (
              <RemediationPlanCard items={diagQuery.data.remediationPlan} />
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function VerdictBanner({ report }: { readonly report: ImportDiagnosticReport }) {
  const { verdict, totals } = report;

  // Mapping verdict → palette sémantique. « conforme » = accent (vert),
  // « à corriger » = warn (ambré), autre (rejeté) = critical (rouge).
  // Le verdict est l'élément le plus visible, ses tokens reflètent
  // l'urgence d'action.
  const palette =
    verdict.status === 'conforme'
      ? {
          headerBg: 'bg-accent-soft',
          headerText: 'text-accent-ink',
          icon: CheckCircle2,
          iconColor: 'text-accent',
        }
      : verdict.status === 'à corriger'
        ? {
            headerBg: 'bg-warn-soft',
            headerText: 'text-warn-ink',
            icon: AlertTriangle,
            iconColor: 'text-warn',
          }
        : {
            headerBg: 'bg-critical-soft',
            headerText: 'text-critical-ink',
            icon: XCircle,
            iconColor: 'text-critical',
          };
  const Icon = palette.icon;

  return (
    <section className="overflow-hidden rounded-md border border-line">
      {/* Bandeau verdict : statut + résumé textuel d'action. C'est le
          premier signal — vert/ambre/rouge selon canCommit. */}
      <header className={cn('flex items-start gap-3 px-5 py-4', palette.headerBg)}>
        <Icon className={cn('h-6 w-6 shrink-0', palette.iconColor)} strokeWidth={1.5} />
        <div className={cn('flex-1 min-w-0', palette.headerText)}>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
            <p className="font-display text-xl font-medium tracking-tight capitalize">
              {verdict.status}
            </p>
            <p className="text-xs">
              <span className="font-mono tabular-nums">{verdict.criticalCount}</span> critique
              {verdict.criticalCount > 1 ? 's' : ''} ·{' '}
              <span className="font-mono tabular-nums">{verdict.warningCount}</span>{' '}
              avertissement{verdict.warningCount > 1 ? 's' : ''} ·{' '}
              <span className="font-mono tabular-nums">{verdict.infoCount}</span> info
            </p>
          </div>
          <p className="mt-1.5 text-sm leading-snug">
            {verdict.canCommit
              ? 'Cette session peut être committée. Les avertissements méritent un coup d’œil mais ne bloquent pas.'
              : 'Cette session ne peut PAS être committée en l’état. Corriger les anomalies critiques ci-dessous avant de réessayer.'}
          </p>
        </div>
      </header>

      {/* Bande de totaux : Débit / Crédit / Écart (équilibre). Sépare
          par lignes pixel pour éviter d'imbriquer trop de cards. */}
      <div className="grid grid-cols-1 gap-px bg-line sm:grid-cols-3">
        <div className="bg-paper px-4 py-2.5">
          <p className="text-2xs uppercase tracking-wider text-ink-mute">∑ Débit</p>
          <p className="mt-0.5 font-mono text-lg font-medium tabular-nums text-ink">
            {fmt(totals.totalDebit)}{' '}
            <span className="text-xs font-normal text-ink-mute">FCFA</span>
          </p>
        </div>
        <div className="bg-paper px-4 py-2.5">
          <p className="text-2xs uppercase tracking-wider text-ink-mute">∑ Crédit</p>
          <p className="mt-0.5 font-mono text-lg font-medium tabular-nums text-ink">
            {fmt(totals.totalCredit)}{' '}
            <span className="text-xs font-normal text-ink-mute">FCFA</span>
          </p>
        </div>
        <div
          className={cn(
            'px-4 py-2.5',
            totals.isBalanced ? 'bg-accent-soft/60' : 'bg-critical-soft',
          )}
        >
          <p
            className={cn(
              'text-2xs uppercase tracking-wider',
              totals.isBalanced ? 'text-accent-ink' : 'text-critical-ink',
            )}
          >
            {totals.isBalanced ? 'Équilibré' : 'Écart D-C'}
          </p>
          <p
            className={cn(
              'mt-0.5 font-mono text-lg font-medium tabular-nums',
              totals.isBalanced ? 'text-accent-ink' : 'text-critical-ink',
            )}
          >
            {totals.isBalanced ? (
              <>
                <CheckCircle2 className="mr-1 inline h-4 w-4" />
                0,00
              </>
            ) : (
              <>
                {fmt(totals.balanceDelta)}{' '}
                <span className="text-xs font-normal">FCFA</span>
              </>
            )}
          </p>
        </div>
      </div>
    </section>
  );
}

function ImportTrialBalanceTable({ report }: { readonly report: ImportDiagnosticReport }) {
  if (report.trialBalance.length === 0) {
    return (
      <div className="rounded border border-line bg-sunk p-4 text-sm text-ink-soft">
        Aucune ligne de balance — la session ne contient pas d&apos;écritures parsables.
      </div>
    );
  }
  return (
    <div>
      <h3 className="mb-2 font-semibold">Balance des comptes (prévisionnelle)</h3>
      <div className="overflow-x-auto rounded border border-line">
        <table className="min-w-full divide-y divide-line text-sm">
          <thead className="bg-sunk">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Compte</th>
              <th className="px-3 py-2 text-left font-medium">Libellé</th>
              <th className="px-3 py-2 text-right font-medium">Lignes</th>
              <th className="px-3 py-2 text-right font-medium">Débit</th>
              <th className="px-3 py-2 text-right font-medium">Crédit</th>
              <th className="px-3 py-2 text-right font-medium">Solde</th>
              <th className="px-3 py-2 text-left font-medium">Statut</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line bg-paper">
            {report.trialBalance.map((row) => (
              <tr key={row.accountCode}>
                <td className="px-3 py-2 font-mono">{row.accountCode}</td>
                <td className="px-3 py-2">{row.accountLabel}</td>
                <td className="px-3 py-2 text-right">{row.lineCount}</td>
                <td className="px-3 py-2 text-right font-mono">{fmt(row.debit)}</td>
                <td className="px-3 py-2 text-right font-mono">{fmt(row.credit)}</td>
                <td className="px-3 py-2 text-right font-mono">
                  {fmt(row.balance)} {row.sign}
                </td>
                <td className="px-3 py-2">
                  {row.accountExists ? (
                    <Badge variant="outline" className="border-accent/40 text-accent-ink">
                      existant
                    </Badge>
                  ) : row.autoProvisionable ? (
                    <Badge variant="outline" className="border-warn/40 text-warn-ink">
                      auto-créé au commit
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="border-critical/40 text-critical-ink">
                      inconnu
                    </Badge>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-sunk font-semibold">
            <tr>
              <td colSpan={3} className="px-3 py-2 text-right">
                TOTAUX
              </td>
              <td className="px-3 py-2 text-right font-mono">{fmt(report.totals.totalDebit)}</td>
              <td className="px-3 py-2 text-right font-mono">{fmt(report.totals.totalCredit)}</td>
              <td className="px-3 py-2 text-right font-mono">
                {report.totals.isBalanced ? '— équilibré' : fmt(report.totals.balanceDelta)}
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function AnomalySection({
  anomalies,
}: {
  readonly anomalies: ImportDiagnosticReport['anomalies'];
}) {
  const total = anomalies.critical.length + anomalies.warnings.length + anomalies.info.length;
  if (total === 0) {
    return (
      <div className="rounded border border-accent/30 bg-accent-soft p-4 text-sm text-accent-ink">
        ✓ Aucune anomalie détectée — le fichier est techniquement conforme.
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <h3 className="font-semibold">Anomalies détectées</h3>
      {anomalies.critical.length > 0 && (
        <AnomalyGroupList
          title="Bloquants (à corriger impérativement avant commit)"
          severity="critical"
          groups={anomalies.critical}
        />
      )}
      {anomalies.warnings.length > 0 && (
        <AnomalyGroupList
          title="Avertissements (recommandé de vérifier)"
          severity="warning"
          groups={anomalies.warnings}
        />
      )}
      {anomalies.info.length > 0 && (
        <AnomalyGroupList title="Informations" severity="info" groups={anomalies.info} />
      )}
    </div>
  );
}

function AnomalyGroupList({
  title,
  severity,
  groups,
}: {
  readonly title: string;
  readonly severity: 'critical' | 'warning' | 'info';
  readonly groups: ReadonlyArray<ImportAnomalyGroup>;
}) {
  const palette =
    severity === 'critical'
      ? { border: 'border-critical/30', bg: 'bg-critical-soft', icon: XCircle, iconColor: 'text-critical' }
      : severity === 'warning'
        ? { border: 'border-warn/30', bg: 'bg-warn-soft', icon: AlertTriangle, iconColor: 'text-warn' }
        : { border: 'border-line', bg: 'bg-sunk', icon: Info, iconColor: 'text-ink-soft' };
  const Icon = palette.icon;
  return (
    <div>
      <h4 className="mb-2 text-sm font-medium text-ink">{title}</h4>
      <div className="space-y-2">
        {groups.map((g) => (
          <details key={g.code} className={`rounded border ${palette.border} ${palette.bg} p-3`}>
            <summary className="cursor-pointer text-sm">
              <span className="inline-flex items-center gap-2 align-middle">
                <Icon className={`h-4 w-4 ${palette.iconColor}`} />
                <span className="font-semibold">{g.title}</span>
                <Badge variant="outline">
                  {g.count} ligne{g.count > 1 ? 's' : ''}
                </Badge>
              </span>
            </summary>
            <div className="mt-2 text-sm text-ink">
              <p>{g.description}</p>
              {g.samples.length > 0 && (
                <div className="mt-2">
                  <span className="text-xs font-medium uppercase text-ink-mute">
                    Exemples ({g.samples.length} sur {g.count})
                  </span>
                  <ul className="mt-1 space-y-1 text-xs text-ink">
                    {g.samples.map((s, i) => (
                      <li key={`${g.code}-${i}`} className="font-mono">
                        Ligne {s.rowNumber}
                        {s.accountCode !== null ? ` · compte ${s.accountCode}` : ''}
                        {s.field !== undefined ? ` · champ ${s.field}` : ''} —{' '}
                        <span className="font-sans">{s.message}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}

function RemediationPlanCard({
  items,
}: {
  readonly items: ImportDiagnosticReport['remediationPlan'];
}) {
  return (
    <div className="rounded-lg border border-line bg-sunk p-4">
      <h3 className="mb-3 flex items-center gap-2 font-semibold">
        <BookText className="h-4 w-4" />
        Plan de normalisation — ce qu&apos;il faut faire
      </h3>
      <ol className="space-y-3 text-sm">
        {items.map((item, idx) => (
          <li key={`${item.title}-${idx}`} className="flex gap-3">
            <Badge
              variant="outline"
              className={
                item.priority === 1
                  ? 'border-critical/40 text-critical-ink'
                  : item.priority === 2
                    ? 'border-warn/40 text-warn-ink'
                    : 'border-line-strong text-ink'
              }
            >
              P{item.priority}
            </Badge>
            <div className="flex-1">
              <div className="font-medium">
                {item.title}{' '}
                <span className="text-xs font-normal text-ink-mute">
                  · {item.affectedCount} ligne{item.affectedCount > 1 ? 's' : ''}
                </span>
                {item.autoFixable && (
                  <Badge variant="outline" className="ml-2 border-accent/40 text-accent-ink">
                    auto-fix
                  </Badge>
                )}
              </div>
              <p className="text-ink-soft">{item.description}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
