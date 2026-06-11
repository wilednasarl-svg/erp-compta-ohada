'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRight,
  BarChart3,
  CheckCircle2,
  Download,
  FileUp,
  Loader2,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  Sparkles,
  Upload,
  X,
  XCircle,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import { AppShell } from '@/components/app-shell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FormError } from '@/components/ui/form-error';
import { Hint } from '@/components/ui/hint';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useApiMutation } from '@/hooks/use-api-mutation';
import { ApiError, api, getAuthToken } from '@/lib/api-client';
import { detectImportFormat } from '@/lib/import-format-detect';
import { downloadImportTemplate } from '@/lib/import-templates';
import { cn } from '@/lib/utils';
import { useCurrentOrg } from '@/stores/auth-store';
import {
  DOCUMENT_TYPE_DESCRIPTIONS,
  DOCUMENT_TYPE_LABELS,
  DOCUMENT_TYPE_OVERRIDE_KEY,
  type CommitResult,
  type DocumentType,
  type ImportSourceType,
  type PreviewResult,
  type SessionSummary,
  type TargetField,
} from '@/types/imports';
import type { JournalView } from '@/types/journals';

import { DeleteSessionConfirm } from './_components/delete-confirm';
import { PeriodCoverageGate } from './_components/period-coverage-gate';
import { PipelineStepper } from './_components/pipeline-stepper';

const DOCUMENT_TYPE_SUGGESTION_LABEL: Record<DocumentType, string> = {
  entries: 'liste d’écritures',
  general_ledger: 'grand livre',
  trial_balance: 'balance',
  bank_statement: 'relevé bancaire',
  auxiliary_ledger: 'grand livre auxiliaire',
  sales_purchases: 'journal de ventes / achats',
};

const DOCUMENT_TYPE_ORDER: readonly DocumentType[] = [
  'entries',
  'general_ledger',
  'trial_balance',
  'bank_statement',
  'auxiliary_ledger',
  'sales_purchases',
];

/**
 * Ce que chaque type d'import débloque une fois committé — rend explicite que
 * l'app s'alimente des imports. Un import détaillé (écritures / grand livre)
 * alimente le grand livre et donc TOUTES les fonctions ; une balance ne donne
 * que les états dérivables des soldes (pas le détail ligne-à-ligne).
 */
const DOCUMENT_TYPE_UNLOCKS: Record<DocumentType, readonly string[]> = {
  entries: ['Tous les états', 'Lettrage', 'Échéancier', 'Conformité', 'Fiscal (TVA/IS)'],
  general_ledger: ['Tous les états', 'Lettrage', 'Échéancier', 'Conformité', 'Fiscal (TVA/IS)'],
  trial_balance: ['Bilan', 'Compte de résultat', 'SIG', 'Ratios', 'Annexe (partielle)'],
  bank_statement: ['Rapprochement bancaire'],
  auxiliary_ledger: ['Comptes de tiers', 'Lettrage', 'Échéancier'],
  sales_purchases: ['Journaux ventes/achats', 'TVA'],
};

const SOURCE_TYPE_LABEL: Record<ImportSourceType, string> = {
  csv: 'CSV',
  excel: 'Excel (.xlsx / .xls)',
  pdf: 'PDF (tableau natif)',
  sage: 'Sage TXT',
  txt: 'Texte brut',
};

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';

interface SessionsResponse {
  readonly sessions: ReadonlyArray<SessionSummary>;
}
interface SessionResponse {
  readonly session: SessionSummary;
}
interface UploadResponse {
  readonly fileId: string;
  readonly parsed: { rowsParsed: number; headers: ReadonlyArray<string> };
}
interface CommitResponse {
  readonly result: CommitResult;
}

/* ─── Status mapping ─────────────────────────────────────────── */

const STATUS_LABEL: Record<SessionSummary['status'], string> = {
  draft: 'Brouillon',
  parsing: 'Parsing…',
  parsed: 'Parsé',
  validated: 'Validé',
  ready_for_import: 'Prêt à committer',
  completed: 'Committé',
  failed: 'Échec',
};

const STATUS_CHIP_CLASS: Record<SessionSummary['status'], string> = {
  draft: 'bg-sunk text-ink-soft',
  parsing: 'bg-info-soft text-info-ink',
  parsed: 'bg-info-soft text-info-ink',
  validated: 'bg-accent-soft text-accent-ink',
  ready_for_import: 'bg-accent-soft text-accent-ink',
  completed: 'bg-accent text-canvas',
  failed: 'bg-critical-soft text-critical-ink',
};

function SessionStatusChip({ status }: { status: SessionSummary['status'] }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
        STATUS_CHIP_CLASS[status],
      )}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

/* ─── Skeleton + empty state ─────────────────────────────────── */

function SkeletonRows({ n = 5 }: { n?: number }) {
  return (
    <div className="animate-pulse divide-y divide-line">
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-5 py-4">
          <div className="h-3 w-32 rounded-xs bg-sunk" />
          <div className="h-3 w-20 rounded-xs bg-sunk" />
          <div className="h-3 flex-1 rounded-xs bg-sunk" />
          <div className="h-5 w-20 rounded-full bg-sunk" />
        </div>
      ))}
    </div>
  );
}

function EmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
      <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-sunk">
        <Icon className="h-5 w-5 text-ink-mute" strokeWidth={1.5} />
      </span>
      <div>
        <p className="text-sm font-medium text-ink">{title}</p>
        <p className="mt-1 max-w-[44ch] text-xs text-ink-mute">{description}</p>
      </div>
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="press inline-flex items-center gap-1.5 rounded-sm bg-accent-soft px-3 py-1.5 text-xs font-medium text-accent-ink transition-colors duration-fast hover:bg-accent hover:text-canvas"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
          {actionLabel}
        </button>
      )}
    </div>
  );
}

/* ─── Page ───────────────────────────────────────────────────── */

export default function ImportsPage() {
  const currentOrg = useCurrentOrg();
  const orgId = currentOrg?.id ?? '';
  const queryClient = useQueryClient();

  const sessionsQuery = useQuery<ReadonlyArray<SessionSummary>, ApiError>({
    queryKey: ['imports', 'sessions', orgId],
    queryFn: async () => {
      const data = await api.get<SessionsResponse>(`/organizations/${orgId}/imports/sessions`);
      return data.sessions;
    },
    enabled: orgId !== '',
  });

  // ─── Create session form state ──────────────────────────────────────
  const [createSourceType, setCreateSourceType] = useState<ImportSourceType>('csv');
  const [createDocumentType, setCreateDocumentType] = useState<DocumentType>('entries');
  const [createLabel, setCreateLabel] = useState('');
  const [showCreateForm, setShowCreateForm] = useState(false);

  const createSession = useApiMutation(
    async () => {
      const data = await api.post<SessionResponse>(
        `/organizations/${orgId}/imports/sessions`,
        {
          sourceType: createSourceType,
          documentType: createDocumentType,
          ...(createLabel.trim() === '' ? {} : { label: createLabel.trim() }),
        },
      );
      return data.session;
    },
    {
      onSuccess: (session) => {
        setCreateLabel('');
        setShowCreateForm(false);
        setSelectedSessionId(session.id);
        void queryClient.invalidateQueries({ queryKey: ['imports', 'sessions', orgId] });
      },
    },
  );

  // ─── Selection + detail ─────────────────────────────────────────────
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const selectedSession = sessionsQuery.data?.find((s) => s.id === selectedSessionId) ?? null;

  // ─── Delete (per-row mutation tracking) ────────────────────────────
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null);
  const deleteSession = useApiMutation(
    async (sessionId: string) => {
      await api.delete(`/organizations/${orgId}/imports/sessions/${sessionId}`);
      return sessionId;
    },
    {
      onMutate: (sessionId) => setDeletingSessionId(sessionId),
      onSettled: () => setDeletingSessionId(null),
      onSuccess: (sessionId) => {
        if (selectedSessionId === sessionId) {
          setSelectedSessionId(null);
        }
        void queryClient.invalidateQueries({ queryKey: ['imports', 'sessions', orgId] });
      },
    },
  );

  const sessions = useMemo(() => sessionsQuery.data ?? [], [sessionsQuery.data]);

  // Pré-sélection via `?session=<id>` (dépôt depuis l'accueil → saute à la
  // vérification). On lit la query une fois, dès que la session ciblée
  // apparaît dans la liste, sans écraser une sélection manuelle ultérieure.
  useEffect(() => {
    if (selectedSessionId !== null) return;
    if (typeof window === 'undefined') return;
    const wanted = new URLSearchParams(window.location.search).get('session');
    if (wanted !== null && sessions.some((s) => s.id === wanted)) {
      setSelectedSessionId(wanted);
    }
  }, [sessions, selectedSessionId]);

  // Stats summary by status family. We collapse the technical states
  // (parsing/parsed/validated/ready_for_import) into "in progress" so
  // the bar reads at a glance for a non-technical operator.
  const stats = useMemo(() => {
    let inProgress = 0;
    let completed = 0;
    let failed = 0;
    let draft = 0;
    for (const s of sessions) {
      if (s.status === 'completed') completed += 1;
      else if (s.status === 'failed') failed += 1;
      else if (s.status === 'draft') draft += 1;
      else inProgress += 1;
    }
    return { total: sessions.length, inProgress, completed, failed, draft };
  }, [sessions]);

  return (
    <AppShell>
      <div className="w-full animate-page-in space-y-8">
        {/* ─── Header ──────────────────────────────────────── */}
        <header className="space-y-3">
          <p className="eyebrow">Saisie · Imports</p>
          <h1 className="font-display text-3xl font-medium tracking-tight text-ink">
            Imports
          </h1>
          <p className="max-w-[68ch] text-sm leading-relaxed text-ink-soft">
            Importer un fichier comptable produit par un autre logiciel —{' '}
            <span className="font-medium text-ink">
              compatible Sage, Ciel, EBP, Odoo, Excel
            </span>{' '}
            et le <span className="font-medium text-ink">FEC</span> (Fichier des Écritures
            Comptables, le format d&apos;échange standard). Aucune ressaisie&nbsp;: vous sortez
            vos données du logiciel tiers, l&apos;app les reprend telles quelles. Pipeline en
            quatre étapes&nbsp;: <span className="font-medium text-ink">préparation</span>,{' '}
            <span className="font-medium text-ink">réception</span>,{' '}
            <span className="font-medium text-ink">vérification</span>,{' '}
            <span className="font-medium text-ink">passage au journal</span>. Les écritures
            n&apos;atteignent le grand livre qu&apos;à la dernière étape.
          </p>
        </header>

        <Hint id="imports-intro" title="Comment fonctionne un import">
          Déposez un FEC, un export Sage Saari, un CSV, un fichier Excel ou un PDF natif. Le
          mapping des colonnes est assisté : l&apos;outil reconnaît automatiquement les colonnes
          standard (Compte, Journal, Date, Débit, Crédit) — y compris les en-têtes FEC
          (<span className="font-mono">JournalCode</span>,{' '}
          <span className="font-mono">CompteNum</span>,{' '}
          <span className="font-mono">EcritureDate</span>…) — et vous corrigez les associations
          si besoin avant le passage au journal. Pour un FEC, gardez l&apos;extension{' '}
          <span className="font-mono">.fec</span> ou choisissez le format «&nbsp;CSV&nbsp;» /
          «&nbsp;Texte brut&nbsp;».
        </Hint>

        {/* ─── Stats summary bar ──────────────────────────── */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-y border-line bg-paper px-4 py-3 text-xs">
          <span className="text-ink-soft">
            <span className="font-mono text-sm font-medium tabular-nums text-ink">
              {stats.total}
            </span>{' '}
            session{stats.total > 1 ? 's' : ''}
          </span>
          <span aria-hidden className="text-line-strong">·</span>
          <span className="flex items-center gap-1.5 text-ink-soft">
            <span className="h-1.5 w-1.5 rounded-full bg-info" />
            <span className="font-mono tabular-nums text-ink">{stats.inProgress}</span> en
            cours
          </span>
          <span className="flex items-center gap-1.5 text-ink-soft">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" />
            <span className="font-mono tabular-nums text-ink">{stats.completed}</span>{' '}
            committée{stats.completed > 1 ? 's' : ''}
          </span>
          <span className="flex items-center gap-1.5 text-ink-soft">
            <span className="h-1.5 w-1.5 rounded-full bg-sunk" />
            <span className="font-mono tabular-nums text-ink">{stats.draft}</span>{' '}
            brouillon{stats.draft > 1 ? 's' : ''}
          </span>
          {stats.failed > 0 && (
            <span className="flex items-center gap-1.5 text-critical-ink">
              <span className="h-1.5 w-1.5 rounded-full bg-critical" />
              <span className="font-mono tabular-nums">{stats.failed}</span> en échec
            </span>
          )}
          <span className="ml-auto">
            <button
              type="button"
              onClick={() => setShowCreateForm((v) => !v)}
              className="press inline-flex items-center gap-1.5 rounded-sm bg-ink px-3 py-1.5 text-xs font-medium text-canvas transition-colors duration-fast hover:bg-ink-soft"
            >
              {showCreateForm ? (
                <>
                  <X className="h-3.5 w-3.5" strokeWidth={1.75} />
                  Annuler
                </>
              ) : (
                <>
                  <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
                  Nouvel import
                </>
              )}
            </button>
          </span>
        </div>

        {/* ─── Create form (collapsible) ─────────────────── */}
        {showCreateForm && (
          <section className="rounded-sm border border-line bg-paper">
            <div className="border-b border-line px-5 py-4">
              <p className="eyebrow mb-1">Étape 1 · Préparer</p>
              <h2 className="font-display text-xl font-medium tracking-tight text-ink">
                Nouvelle session d&apos;import
              </h2>
              <p className="mt-1.5 max-w-[60ch] text-xs leading-relaxed text-ink-soft">
                Préciser le type de document attendu et le format du fichier source. Vous
                pourrez téléverser le fichier dans un second temps.
              </p>
            </div>
            <form
              className="space-y-5 p-5"
              onSubmit={(e) => {
                e.preventDefault();
                createSession.mutate(undefined);
              }}
            >
              <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label
                    htmlFor="documentType"
                    className="eyebrow"
                  >
                    Type de document
                  </Label>
                  <select
                    id="documentType"
                    value={createDocumentType}
                    onChange={(e) => setCreateDocumentType(e.target.value as DocumentType)}
                    className="flex h-9 w-full rounded-sm border border-line-strong bg-paper px-3 py-1 text-sm text-ink transition-colors focus-visible:border-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/40"
                  >
                    {DOCUMENT_TYPE_ORDER.map((d) => (
                      <option key={d} value={d}>
                        {DOCUMENT_TYPE_LABELS[d]}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs leading-snug text-ink-mute">
                    {DOCUMENT_TYPE_DESCRIPTIONS[createDocumentType]}
                  </p>
                  <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                    <span className="text-2xs uppercase tracking-wider text-ink-mute">Débloque</span>
                    {DOCUMENT_TYPE_UNLOCKS[createDocumentType].map((feature) => (
                      <span
                        key={feature}
                        className="rounded-xs bg-accent-soft px-1.5 py-0.5 text-2xs font-medium text-accent-ink"
                      >
                        {feature}
                      </span>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => downloadImportTemplate(createDocumentType)}
                    className="press mt-1 inline-flex items-center gap-1.5 rounded-xs border border-line-strong bg-paper px-2.5 py-1.5 text-xs font-medium text-ink-soft transition-colors duration-fast hover:border-ink hover:text-ink"
                    title={`Télécharger un modèle ${DOCUMENT_TYPE_LABELS[createDocumentType]} prêt à remplir`}
                  >
                    <Download className="h-3.5 w-3.5" strokeWidth={1.75} />
                    Télécharger un modèle
                  </button>
                  <p className="text-2xs leading-snug text-ink-mute">
                    Fichier d&apos;exemple au bon format (séparateur «&nbsp;;&nbsp;», colonnes
                    reconnues) — remplissez vos lignes et réimportez.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="sourceType" className="eyebrow">
                    Format de fichier
                  </Label>
                  <select
                    id="sourceType"
                    value={createSourceType}
                    onChange={(e) => setCreateSourceType(e.target.value as ImportSourceType)}
                    className="flex h-9 w-full rounded-sm border border-line-strong bg-paper px-3 py-1 text-sm text-ink transition-colors focus-visible:border-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/40"
                  >
                    {(Object.keys(SOURCE_TYPE_LABEL) as ImportSourceType[]).map((t) => (
                      <option key={t} value={t}>
                        {SOURCE_TYPE_LABEL[t]}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs leading-snug text-ink-mute">
                    Sage TXT correspond aux exports natifs Sage Saari.
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_auto] md:items-end">
                <div className="space-y-1.5">
                  <Label htmlFor="label" className="eyebrow">
                    Libellé{' '}
                    <span className="font-normal lowercase tracking-normal text-ink-mute">
                      (optionnel)
                    </span>
                  </Label>
                  <Input
                    id="label"
                    value={createLabel}
                    onChange={(e) => setCreateLabel(e.target.value)}
                    placeholder="Ex. Achats mars 2026"
                    maxLength={200}
                  />
                </div>
                <Button type="submit" disabled={createSession.isPending} className="press">
                  {createSession.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="mr-2 h-4 w-4" />
                  )}
                  Créer la session
                </Button>
              </div>
              <FormError error={createSession.error} />
            </form>
          </section>
        )}

        {/* ─── Sessions list ──────────────────────────────── */}
        <section className="overflow-hidden rounded-sm border border-line bg-paper">
          <div className="flex items-baseline justify-between border-b border-line px-5 py-4">
            <div>
              <p className="eyebrow mb-1">Sessions récentes</p>
              <p className="text-xs text-ink-mute">
                Sélectionner une session pour reprendre où vous en étiez.
              </p>
            </div>
            {sessions.length > 0 && (
              <p className="text-xs text-ink-mute">
                <span className="font-mono tabular-nums text-ink">{sessions.length}</span>{' '}
                session{sessions.length > 1 ? 's' : ''}
              </p>
            )}
          </div>
          {sessionsQuery.isLoading ? (
            <SkeletonRows n={4} />
          ) : sessions.length === 0 ? (
            <EmptyState
              icon={FileUp}
              title="Aucun import récent"
              description="Importez vos écritures depuis Sage Saari, CSV, Excel ou PDF. Le pipeline en quatre étapes garantit qu’aucune ligne n’atteint le journal sans vérification."
              actionLabel="Nouvel import"
              onAction={() => setShowCreateForm(true)}
            />
          ) : (
            <ul className="divide-y divide-line">
              {sessions.map((s) => {
                const isSelected = s.id === selectedSessionId;
                const canAnalyze = s.totalLines > 0;
                const isPendingDelete =
                  deleteSession.isPending && deletingSessionId === s.id;
                const labelOrId = s.label ?? `Session ${s.id.slice(0, 8)}`;
                return (
                  <li
                    key={s.id}
                    className={cn(
                      'card-lift group flex items-center gap-3 px-5 py-3.5 transition-colors duration-fast',
                      isSelected
                        ? 'bg-accent-soft/60 ring-1 ring-inset ring-accent/30'
                        : 'hover:bg-sunk/60',
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => setSelectedSessionId(s.id)}
                      className="press flex min-w-0 flex-1 items-center gap-4 text-left"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={cn(
                              'truncate text-sm',
                              isSelected
                                ? 'font-semibold text-ink'
                                : 'font-medium text-ink',
                            )}
                          >
                            {labelOrId}
                          </span>
                          <SessionStatusChip status={s.status} />
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-ink-mute">
                          {s.documentType !== null && (
                            <MetaChip>{DOCUMENT_TYPE_LABELS[s.documentType]}</MetaChip>
                          )}
                          <MetaChip mono>{s.sourceType.toUpperCase()}</MetaChip>
                          <MetaChip mono>
                            {s.totalLines.toLocaleString('fr-FR')} lignes
                          </MetaChip>
                          {s.errorLines > 0 && (
                            <MetaChip tone="critical" mono>
                              {s.errorLines.toLocaleString('fr-FR')} en erreur
                            </MetaChip>
                          )}
                          <MetaChip mono>
                            {new Date(s.createdAt).toLocaleDateString('fr-FR', {
                              day: '2-digit',
                              month: 'short',
                              year: 'numeric',
                            })}
                          </MetaChip>
                        </div>
                      </div>
                    </button>
                    <div className="flex shrink-0 items-center gap-2">
                      {canAnalyze && (
                        <Link
                          href={`/imports/${s.id}/dashboard`}
                          className="press inline-flex items-center gap-1.5 rounded-sm border border-line-strong bg-paper px-2.5 py-1.5 text-xs font-medium text-ink-soft transition-colors duration-fast hover:border-ink hover:text-ink"
                          title="Voir l'analyse de cette session"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <BarChart3 className="h-3.5 w-3.5" />
                          Analyse
                        </Link>
                      )}
                      <DeleteSessionConfirm
                        label={labelOrId}
                        disabled={s.status === 'completed'}
                        disabledReason="Session committée — utiliser la contre-passation depuis Journaux"
                        isPending={isPendingDelete}
                        onConfirm={() => deleteSession.mutate(s.id)}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {(deleteSession.error || sessionsQuery.error) && (
            <div className="border-t border-line px-5 py-3">
              {deleteSession.error && <FormError error={deleteSession.error} />}
              {sessionsQuery.error && (
                <FormError error={sessionsQuery.error} className="mt-2" />
              )}
            </div>
          )}
        </section>

        {/* Detail panel */}
        {selectedSession && (
          <SessionDetailPanel
            orgId={orgId}
            session={selectedSession}
            onMutated={() => {
              void queryClient.invalidateQueries({
                queryKey: ['imports', 'sessions', orgId],
              });
            }}
          />
        )}
      </div>
    </AppShell>
  );
}

/* ─── Meta chip used in session row metadata ─────────────────── */

function MetaChip({
  children,
  mono = false,
  tone,
}: {
  children: React.ReactNode;
  mono?: boolean;
  tone?: 'critical';
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-xs border px-1.5 py-0.5 text-2xs leading-none',
        mono && 'font-mono tabular-nums',
        tone === 'critical'
          ? 'border-critical/30 bg-critical-soft text-critical-ink'
          : 'border-line bg-sunk/50 text-ink-soft',
      )}
    >
      {children}
    </span>
  );
}

/* ─── Section heading ────────────────────────────────────────── */

interface SectionHeadingProps {
  readonly phase: number;
  readonly title: string;
  readonly active: boolean;
  readonly hint: string;
}

function SectionHeading({ phase, title, active, hint }: SectionHeadingProps) {
  return (
    <div className="flex items-start gap-3">
      <span
        className={cn(
          'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border font-mono text-xs tabular-nums',
          active
            ? 'border-accent bg-accent-soft text-accent-ink'
            : 'border-line-strong bg-sunk text-ink-mute',
        )}
      >
        {phase}
      </span>
      <div className="min-w-0 flex-1">
        <h3
          className={cn(
            'font-display text-lg font-medium leading-tight tracking-tight',
            active ? 'text-ink' : 'text-ink-soft',
          )}
        >
          {title}
        </h3>
        <p className="mt-0.5 text-xs leading-snug text-ink-mute">{hint}</p>
      </div>
    </div>
  );
}

/* ─── Suggested type banner ──────────────────────────────────── */

interface SuggestedDocumentTypeBannerProps {
  readonly suggested: DocumentType;
  readonly isPending: boolean;
  readonly success: DocumentType | null;
  readonly error: ApiError | null;
  readonly onSwitch: () => void;
}

function SuggestedDocumentTypeBanner({
  suggested,
  isPending,
  success,
  error,
  onSwitch,
}: SuggestedDocumentTypeBannerProps) {
  return (
    <div className="flex flex-col gap-2 rounded-sm border border-warn/30 bg-warn-soft px-3 py-2.5 text-sm text-warn-ink sm:flex-row sm:items-center sm:justify-between">
      <p className="leading-snug">
        <Sparkles className="mr-1.5 inline h-3.5 w-3.5" strokeWidth={1.5} />
        Ce fichier ressemble plutôt à une{' '}
        <span className="font-semibold">{DOCUMENT_TYPE_SUGGESTION_LABEL[suggested]}</span> —
        basculer&nbsp;?
      </p>
      <div className="flex flex-col items-start gap-1 sm:items-end">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="press border-warn/40 bg-paper text-warn-ink hover:bg-warn-soft"
          disabled={isPending}
          onClick={onSwitch}
        >
          {isPending ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
          Basculer en {DOCUMENT_TYPE_LABELS[suggested].toLowerCase()}
        </Button>
        {success !== null && (
          <span className="text-xs text-accent-ink">
            <CheckCircle2 className="mr-1 inline h-3 w-3" />
            Type basculé en {DOCUMENT_TYPE_SUGGESTION_LABEL[success]}. Vérification relancée.
          </span>
        )}
      </div>
      {error !== null && (
        <div className="basis-full">
          <FormError error={error} className="mt-1" />
        </div>
      )}
    </div>
  );
}

/* ─── Detail panel ───────────────────────────────────────────── */

interface DetailProps {
  readonly orgId: string;
  readonly session: SessionSummary;
  readonly onMutated: () => void;
}

function SessionDetailPanel({ orgId, session, onMutated }: DetailProps) {
  const [file, setFile] = useState<File | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [commitDone, setCommitDone] = useState<CommitResult | null>(null);
  // Nom du dernier fichier téléversé — conservé après que `file` soit
  // remis à null, pour afficher le format détecté dans le bloc de succès.
  const [uploadedName, setUploadedName] = useState<string | null>(null);

  // Inline rename — label is informational, allowed on every status.
  const [isRenaming, setIsRenaming] = useState(false);
  const [labelDraft, setLabelDraft] = useState(session.label ?? '');
  useEffect(() => {
    setLabelDraft(session.label ?? '');
    setIsRenaming(false);
  }, [session.id, session.label]);

  const renameSession = useApiMutation(
    async (nextLabel: string | null) => {
      await api.patch(
        `/organizations/${orgId}/imports/sessions/${session.id}`,
        { label: nextLabel },
      );
      return nextLabel;
    },
    {
      onSuccess: () => {
        setIsRenaming(false);
        onMutated();
      },
    },
  );

  // Multipart upload — bypasses JSON api client.
  const upload = useApiMutation(
    async () => {
      if (!file) {
        throw new ApiError(422, {
          code: 'IMPORT_UNSUPPORTED_FORMAT',
          message: 'Sélectionner un fichier avant de cliquer sur Téléverser.',
        });
      }
      setUploadedName(file.name);
      const fd = new FormData();
      fd.append('file', file);
      const token = getAuthToken();
      const res = await fetch(
        `${API_BASE}/organizations/${orgId}/imports/sessions/${session.id}/files`,
        {
          method: 'POST',
          headers: token === null ? {} : { Authorization: `Bearer ${token}` },
          body: fd,
        },
      );
      const text = await res.text();
      let envelope: { data?: UploadResponse; error?: { code: string; message: string } } = {};
      try {
        envelope = text === '' ? {} : JSON.parse(text);
      } catch {
        throw new ApiError(res.status, {
          code: 'NETWORK_ERROR',
          message: `Réponse non-JSON du serveur (HTTP ${res.status}).`,
        });
      }
      if (!res.ok || envelope.error) {
        throw new ApiError(res.status, {
          code: envelope.error?.code ?? 'NETWORK_ERROR',
          message: envelope.error?.message ?? `HTTP ${res.status}`,
        });
      }
      return envelope.data as UploadResponse;
    },
    {
      onSuccess: () => {
        setFile(null);
        onMutated();
      },
    },
  );

  // Preview — re-runs mapping + validation + persist (idempotent).
  const previewMutation = useApiMutation(
    async () => {
      const data = await api.post<PreviewResult>(
        `/organizations/${orgId}/imports/sessions/${session.id}/preview`,
        {},
      );
      return data;
    },
    {
      onSuccess: (data) => {
        setPreview(data);
        onMutated();
      },
    },
  );

  const switchDocumentType = useApiMutation(
    async (target: DocumentType) => {
      const overrideOnly = preview
        ? Object.fromEntries(
            Object.entries(preview.headerMapping).map(([h, t]) => [h, t as string]),
          )
        : {};
      const payload: Record<string, string> = {
        ...overrideOnly,
        [DOCUMENT_TYPE_OVERRIDE_KEY]: target,
      };
      await api.patch(
        `/organizations/${orgId}/imports/sessions/${session.id}/mapping`,
        { mappingOverride: payload },
      );
      return target;
    },
    {
      onSuccess: () => {
        setPreview(null);
        onMutated();
      },
    },
  );

  const commitMutation = useApiMutation(
    async () => {
      const data = await api.post<CommitResponse>(
        `/organizations/${orgId}/imports/sessions/${session.id}/commit`,
        {},
      );
      return data.result;
    },
    {
      onSuccess: (result) => {
        setCommitDone(result);
        onMutated();
      },
    },
  );

  const canUpload = session.status === 'draft';
  const canPreview = session.status === 'parsed' || session.status === 'validated';
  const canCommit =
    (session.status === 'validated' || session.status === 'ready_for_import') &&
    session.errorLines === 0 &&
    session.totalLines > 0;

  useEffect(() => {
    setPreview(null);
    setCommitDone(null);
    setUploadedName(null);
  }, [session.id]);

  useEffect(() => {
    if (!canPreview) return;
    if (preview !== null) return;
    if (previewMutation.isPending) return;
    if (previewMutation.error !== null) return;
    previewMutation.mutate(undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id, canPreview, preview, previewMutation.isPending, previewMutation.error]);

  return (
    <section className="rounded-sm border border-line bg-paper">
      <header className="border-b border-line p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="eyebrow mb-1">Détail · session sélectionnée</p>
            {isRenaming ? (
              <form
                className="mt-1 flex flex-wrap items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const trimmed = labelDraft.trim();
                  renameSession.mutate(trimmed === '' ? null : trimmed);
                }}
              >
                <Input
                  value={labelDraft}
                  onChange={(e) => setLabelDraft(e.target.value)}
                  placeholder={`Session ${session.id.slice(0, 8)}`}
                  maxLength={200}
                  autoFocus
                  className="h-9 w-72 font-display text-xl"
                />
                <Button
                  type="submit"
                  size="sm"
                  disabled={renameSession.isPending}
                  className="press"
                >
                  {renameSession.isPending ? (
                    <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Save className="mr-1 h-3.5 w-3.5" />
                  )}
                  Enregistrer
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={renameSession.isPending}
                  className="press"
                  onClick={() => {
                    setLabelDraft(session.label ?? '');
                    setIsRenaming(false);
                  }}
                >
                  <X className="mr-1 h-3.5 w-3.5" />
                  Annuler
                </Button>
                <FormError error={renameSession.error} className="basis-full" />
              </form>
            ) : (
              <h2 className="flex flex-wrap items-center gap-2 font-display text-xl font-medium tracking-tight">
                <span className="truncate text-ink">
                  {session.label ?? `Session ${session.id.slice(0, 8)}`}
                </span>
                <SessionStatusChip status={session.status} />
              </h2>
            )}
            {!isRenaming && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-ink-mute">
                <button
                  type="button"
                  onClick={() => {
                    setLabelDraft(session.label ?? '');
                    setIsRenaming(true);
                  }}
                  className="press inline-flex items-center gap-1 rounded-xs px-1.5 py-0.5 text-ink-soft transition-colors duration-fast hover:bg-sunk hover:text-ink"
                  title="Renommer la session"
                >
                  <Pencil className="h-3 w-3" />
                  Renommer
                </button>
                <MetaChip mono>
                  {session.totalLines.toLocaleString('fr-FR')} lignes
                </MetaChip>
                {session.errorLines > 0 && (
                  <MetaChip tone="critical" mono>
                    {session.errorLines.toLocaleString('fr-FR')} en erreur
                  </MetaChip>
                )}
                {session.documentType !== null && (
                  <MetaChip>{DOCUMENT_TYPE_LABELS[session.documentType]}</MetaChip>
                )}
                <MetaChip mono>{session.sourceType.toUpperCase()}</MetaChip>
              </div>
            )}
          </div>
          {session.totalLines > 0 && (
            <Link
              href={`/imports/${session.id}/dashboard`}
              className="press inline-flex shrink-0 items-center gap-1.5 rounded-sm border border-line-strong bg-paper px-3 py-1.5 text-sm font-medium text-ink-soft transition-colors duration-fast hover:border-ink hover:text-ink"
            >
              <BarChart3 className="h-4 w-4" />
              Voir l&apos;analyse
            </Link>
          )}
        </div>
      </header>

      <div className="space-y-8 p-5">
        <PipelineStepper status={session.status} errorLines={session.errorLines} />

        {/* Upload */}
        <section className="space-y-3">
          <SectionHeading
            phase={2}
            title="Téléverser le fichier source"
            active={canUpload}
            hint={
              canUpload
                ? "Choisir un fichier CSV, Excel, PDF natif ou export Sage. Les lignes sont parsées et placées en staging — rien n'atteint encore le journal comptable."
                : 'Le fichier a déjà été reçu pour cette session.'
            }
          />
          {canUpload ? (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragOver(true);
              }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragOver(false);
                const dropped = e.dataTransfer.files?.[0];
                if (dropped) setFile(dropped);
              }}
              className={cn(
                'rounded-sm border-2 border-dashed bg-sunk/50 px-5 py-6 transition-colors duration-fast',
                isDragOver
                  ? 'border-accent bg-accent-soft/40'
                  : 'border-line-strong hover:border-accent',
              )}
            >
              <div className="flex flex-col items-center gap-3 text-center">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-paper text-ink-soft">
                  <Upload className="h-4 w-4" strokeWidth={1.5} />
                </span>
                <div>
                  <p className="text-sm font-medium text-ink">
                    Glisser un fichier ici, ou
                  </p>
                  <Label
                    htmlFor="file-upload"
                    className="press mt-1 inline-flex cursor-pointer items-center gap-1.5 rounded-xs px-2 py-1 text-xs font-medium text-accent-ink underline-offset-2 hover:underline"
                  >
                    parcourir vos fichiers
                  </Label>
                  <Input
                    id="file-upload"
                    type="file"
                    accept=".csv,.xlsx,.xls,.txt,.pdf,.fec"
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                    className="sr-only"
                  />
                </div>
                <p className="text-xs text-ink-mute">
                  Formats acceptés&nbsp;:{' '}
                  <span className="font-mono">.csv, .xlsx, .xls, .txt, .pdf, .fec</span>
                </p>
                {file && (
                  <div className="mt-2 flex flex-wrap items-center justify-center gap-1.5">
                    <MetaChip mono>{file.name}</MetaChip>
                    <MetaChip mono>
                      {(file.size / 1024).toLocaleString('fr-FR', {
                        maximumFractionDigits: 1,
                      })}{' '}
                      Ko
                    </MetaChip>
                    <button
                      type="button"
                      onClick={() => setFile(null)}
                      className="press inline-flex items-center gap-1 rounded-xs px-1.5 py-0.5 text-2xs text-ink-mute hover:bg-sunk hover:text-ink"
                    >
                      <X className="h-3 w-3" />
                      Retirer
                    </button>
                  </div>
                )}
                <Button
                  type="button"
                  disabled={!file || upload.isPending}
                  onClick={() => upload.mutate(undefined)}
                  className="press mt-2"
                >
                  {upload.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Upload className="mr-2 h-4 w-4" />
                  )}
                  Téléverser et analyser
                </Button>
              </div>
            </div>
          ) : (
            <p className="rounded-sm border border-line bg-sunk/40 px-4 py-3 text-xs text-ink-soft">
              <CheckCircle2 className="mr-1.5 inline h-3.5 w-3.5 text-accent" />
              Le fichier a déjà été reçu (statut «&nbsp;{STATUS_LABEL[session.status]}&nbsp;»).
              Passer à l&apos;étape de vérification ci-dessous.
            </p>
          )}
          <FormError error={upload.error} />
          {upload.data && (
            <div className="rounded-sm border border-accent/20 bg-accent-soft/40 px-3 py-2.5 text-sm text-accent-ink">
              <p className="font-medium">
                <CheckCircle2 className="mr-1.5 inline h-4 w-4" />
                Analyse réussie ·{' '}
                <span className="font-mono tabular-nums">
                  {upload.data.parsed.rowsParsed.toLocaleString('fr-FR')}
                </span>{' '}
                lignes lues
              </p>
              {(() => {
                const detected = detectImportFormat({
                  fileName: uploadedName ?? '',
                  headers: upload.data.parsed.headers,
                });
                return detected === null ? null : (
                  <p className="mt-1 text-xs font-medium text-accent-ink">
                    <CheckCircle2 className="mr-1 inline h-3.5 w-3.5" />
                    Format détecté&nbsp;: {detected}
                  </p>
                );
              })()}
              <p className="mt-1 text-xs text-accent-ink/80">
                Colonnes détectées&nbsp;:{' '}
                <span className="font-mono">{upload.data.parsed.headers.join(', ')}</span>
              </p>
            </div>
          )}
        </section>

        {/* Preview */}
        <section className="space-y-3">
          <SectionHeading
            phase={3}
            title="Vérifier les colonnes et les écritures"
            active={canPreview}
            hint={
              canPreview
                ? "Associer chaque colonne du fichier à un champ canonique (Compte, Journal, Date, Débit, Crédit…). La validation OHADA s'exécute en direct."
                : session.status === 'draft'
                  ? "Téléverser un fichier à l'étape précédente pour activer la vérification."
                  : 'Étape déjà franchie pour cette session.'
            }
          />
          <Button
            type="button"
            variant="secondary"
            className="press"
            disabled={!canPreview || previewMutation.isPending}
            onClick={() => previewMutation.mutate(undefined)}
          >
            {previewMutation.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <FileUp className="mr-2 h-4 w-4" />
            )}
            Régénérer la prévisualisation
          </Button>
          <FormError error={previewMutation.error} />

          {preview && (
            <MappingOverridePanel
              orgId={orgId}
              sessionId={session.id}
              headers={preview.headers}
              currentMapping={preview.headerMapping}
              unmappedTargets={preview.unmappedTargets}
              currentDefaultJournalCode={session.defaultJournalCode}
              onSaved={() => {
                previewMutation.mutate(undefined);
                onMutated();
              }}
            />
          )}

          {preview && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-px overflow-hidden rounded-sm border border-line bg-line sm:grid-cols-3">
                <div className="bg-paper px-4 py-3">
                  <p className="eyebrow mb-0">Lignes en staging</p>
                  <p className="mt-1 font-mono text-xl font-medium tabular-nums text-ink">
                    {preview.totals.total.toLocaleString('fr-FR')}
                  </p>
                </div>
                <div
                  className={cn(
                    'px-4 py-3',
                    preview.totals.withErrors > 0
                      ? 'bg-critical-soft'
                      : 'bg-accent-soft/60',
                  )}
                >
                  <p
                    className={cn(
                      'text-2xs font-medium uppercase tracking-wider',
                      preview.totals.withErrors > 0 ? 'text-critical-ink' : 'text-accent-ink',
                    )}
                  >
                    {preview.totals.withErrors > 0 ? 'En erreur' : 'Toutes validées'}
                  </p>
                  <p
                    className={cn(
                      'mt-1 font-mono text-xl font-medium tabular-nums',
                      preview.totals.withErrors > 0 ? 'text-critical-ink' : 'text-accent-ink',
                    )}
                  >
                    {preview.totals.withErrors.toLocaleString('fr-FR')}
                  </p>
                </div>
                <div className="col-span-2 bg-paper px-4 py-3 sm:col-span-1">
                  <p className="eyebrow mb-0">Champs requis non mappés</p>
                  <p className="mt-1 text-sm leading-snug text-ink">
                    {actionableUnmapped(preview.unmappedTargets, {
                      hasDefaultJournal: session.defaultJournalCode !== null,
                    }).length > 0 ? (
                      <span className="font-mono text-xs">
                        {actionableUnmapped(preview.unmappedTargets, {
                          hasDefaultJournal: session.defaultJournalCode !== null,
                        })
                          .map(targetLabel)
                          .join(', ')}
                      </span>
                    ) : (
                      <span className="text-ink-mute">— aucun</span>
                    )}
                  </p>
                </div>
              </div>

              {preview.suggestedDocumentType !== null &&
                preview.suggestedDocumentType !== session.documentType && (
                  <SuggestedDocumentTypeBanner
                    suggested={preview.suggestedDocumentType}
                    isPending={switchDocumentType.isPending}
                    success={switchDocumentType.data ?? null}
                    error={switchDocumentType.error}
                    onSwitch={() =>
                      switchDocumentType.mutate(preview.suggestedDocumentType as DocumentType)
                    }
                  />
                )}

              <div className="overflow-x-auto rounded-sm border border-line">
                <table className="w-full text-sm">
                  <thead className="bg-sunk text-2xs uppercase tracking-wider text-ink-mute">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">Ligne</th>
                      <th className="px-3 py-2 text-left font-medium">Pièce</th>
                      <th className="px-3 py-2 text-left font-medium">Compte</th>
                      <th className="px-3 py-2 text-left font-medium">Journal</th>
                      <th className="px-3 py-2 text-left font-medium">Date</th>
                      <th className="px-3 py-2 text-right font-medium">Débit</th>
                      <th className="px-3 py-2 text-right font-medium">Crédit</th>
                      <th className="px-3 py-2 text-left font-medium">Libellé</th>
                      <th className="px-3 py-2 text-left font-medium">Contrôle</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.entries.map((e) => {
                      const hasErr = e.errors.length > 0;
                      return (
                        <tr
                          key={e.rowNumber}
                          className={cn(
                            'border-t border-line',
                            hasErr ? 'bg-critical-soft/40' : 'bg-paper',
                          )}
                        >
                          <td className="px-3 py-2 font-mono text-xs tabular-nums text-ink-mute">
                            {e.rowNumber}
                          </td>
                          <td className="px-3 py-2 font-mono text-xs tabular-nums text-ink-soft">
                            {e.mappedValues.pieceNumber ?? (
                              <span className="text-ink-mute">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2 font-mono text-xs text-ink">
                            {e.mappedValues.account ?? (
                              <span className="text-ink-mute">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2 font-mono text-xs uppercase tracking-wider text-ink-soft">
                            {e.mappedValues.journal ?? (
                              <span className="normal-case tracking-normal text-ink-mute">
                                —
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 font-mono text-xs tabular-nums text-ink-soft">
                            {e.mappedValues.date ?? (
                              <span className="text-ink-mute">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-sm tabular-nums text-ink">
                            {e.mappedValues.debit ?? (
                              <span className="text-ink-mute">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-sm tabular-nums text-ink">
                            {e.mappedValues.credit ?? (
                              <span className="text-ink-mute">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-ink-soft">
                            {e.mappedValues.label ?? (
                              <span className="text-ink-mute">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-xs">
                            {hasErr ? (
                              <span
                                className="inline-flex items-start gap-1 text-critical"
                                title={e.errors.map((x) => x.message).join('\n')}
                              >
                                <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                                {/* Message humain (pas le code technique) : il dit QUOI
                                    corriger — ex. « Journal manquant — choisissez un
                                    journal par défaut ci-dessus ». */}
                                <span className="max-w-[36ch] leading-snug">
                                  {e.errors[0]?.message}
                                  {e.errors.length > 1 && (
                                    <span className="text-ink-mute"> (+{e.errors.length - 1})</span>
                                  )}
                                </span>
                              </span>
                            ) : (
                              <CheckCircle2 className="h-4 w-4 text-accent" />
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>

        {/* Commit */}
        <section className="space-y-3">
          <SectionHeading
            phase={4}
            title="Passer les écritures au journal"
            active={canCommit}
            hint={
              canCommit
                ? "Validation finale. Les écritures sont passées au journal comptable et deviennent immuables — toute correction passera ensuite par une contre-passation."
                : session.errorLines > 0
                  ? `Action bloquée : ${session.errorLines} ligne(s) en erreur à corriger d'abord.`
                  : session.status === 'completed'
                    ? 'Étape déjà franchie. Les écritures sont au journal.'
                    : "Vérifier les lignes à l'étape précédente pour débloquer le passage."
            }
          />
          {preview && <PeriodCoverageGate orgId={orgId} preview={preview} />}
          <div className="rounded-sm border border-line bg-sunk/40 p-4">
            <p className="text-xs leading-relaxed text-ink-soft">
              <span className="font-medium text-ink">Action irréversible.</span> Cette
              opération crée les écritures comptables réelles à partir des lignes en staging.
              Pour annuler une écriture committée, utiliser la contre-passation depuis la
              page&nbsp;
              <Link
                href={`/journals`}
                className="text-accent-ink underline-offset-2 hover:underline"
              >
                Journaux
              </Link>
              .
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Button
                type="button"
                className="press"
                disabled={!canCommit || commitMutation.isPending}
                onClick={() => commitMutation.mutate(undefined)}
              >
                {commitMutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                )}
                Passer au journal
              </Button>
              {!canCommit && session.errorLines > 0 && (
                <span className="text-xs text-critical">
                  <XCircle className="mr-1 inline h-3 w-3" />
                  <span className="font-mono tabular-nums">{session.errorLines}</span>{' '}
                  ligne(s) en erreur — corriger ou réimporter le fichier
                </span>
              )}
            </div>
          </div>
          <FormError error={commitMutation.error} />
          {commitDone && (
            <div className="rounded-sm border border-accent/30 bg-accent-soft/60 px-3 py-2.5 text-sm text-accent-ink">
              <p className="font-medium">
                <CheckCircle2 className="mr-1.5 inline h-4 w-4" />
                Passage réussi
              </p>
              <p className="mt-0.5 text-xs text-accent-ink/80">
                <span className="font-mono tabular-nums">
                  {commitDone.committedRows.toLocaleString('fr-FR')}
                </span>{' '}
                écriture(s) ajoutée(s) au journal comptable.
              </p>
            </div>
          )}
        </section>
      </div>
    </section>
  );
}

/* ─── Mapping override panel ─────────────────────────────────── */

// `Record<string, string>` (et non `Record<TargetField, string>`) :
// le backend peut renvoyer des cibles non couvertes par le type front
// (axes analytiques) dans `unmappedTargets` — on évite ainsi un libellé
// vide (« champs non mappés : Journal, Devise, , »).
const TARGET_LABEL: Record<string, string> = {
  account: 'Compte',
  journal: 'Journal',
  date: 'Date',
  debit: 'Débit',
  credit: 'Crédit',
  label: 'Libellé',
  partner: 'Tiers',
  currency: 'Devise',
  pieceNumber: 'N° pièce',
  invoiceNumber: 'N° facture',
  reference: 'Référence',
  taxCode: 'Code taxe',
  dueDate: 'Date échéance',
  analyticAxisType: 'Axe analytique (type)',
  analyticAxisCode: 'Axe analytique (code)',
};

/** Libellé d'une cible, avec repli sur la clé brute si inconnue. */
function targetLabel(t: string): string {
  return TARGET_LABEL[t] ?? t;
}

/**
 * Cibles optionnelles dont l'absence n'est JAMAIS un problème : la devise
 * a un défaut (XOF/FCFA) et les axes analytiques relèvent d'une compta
 * analytique avancée. On les exclut de l'avertissement « champs non
 * mappés » pour ne pas alarmer l'utilisateur sur des champs facultatifs
 * (seul un champ requis non couvert, ex. Journal, mérite une action).
 */
const OPTIONAL_UNMAPPED_HIDDEN = new Set<string>([
  'currency',
  'analyticAxisType',
  'analyticAxisCode',
]);

/** Cibles non mappées qui demandent réellement une action (hors optionnelles). */
function actionableUnmapped(
  targets: ReadonlyArray<string>,
  options?: { readonly hasDefaultJournal?: boolean },
): string[] {
  return targets.filter((t) => {
    if (OPTIONAL_UNMAPPED_HIDDEN.has(t)) return false;
    // Un journal par défaut couvre le champ « Journal » : inutile d'alarmer
    // sur une colonne absente que le défaut remplit déjà ligne par ligne.
    if (t === 'journal' && options?.hasDefaultJournal === true) return false;
    return true;
  });
}

const ALL_TARGETS: ReadonlyArray<TargetField> = [
  'account',
  'journal',
  'date',
  'debit',
  'credit',
  'label',
  'partner',
  'currency',
  'pieceNumber',
  'invoiceNumber',
  'reference',
  'taxCode',
  'dueDate',
];

const REQUIRED_TARGETS: ReadonlySet<TargetField> = new Set<TargetField>([
  'account',
  'journal',
  'date',
  'label',
  'pieceNumber',
]);

/**
 * Journaux standards SYSCOHADA — permet de les créer en un clic depuis
 * l'import (sans quitter le flux) quand le dossier n'en a aucun et que le
 * fichier ne porte pas de colonne « Journal ». Miroir de la page Journaux.
 */
const STANDARD_JOURNAL_SEEDS: ReadonlyArray<{ code: string; label: string; kind: string }> = [
  { code: 'AC', label: 'Journal des Achats', kind: 'AC' },
  { code: 'VE', label: 'Journal des Ventes', kind: 'VE' },
  { code: 'BQ', label: 'Journal de Banque', kind: 'BQ' },
  { code: 'CA', label: 'Journal de Caisse', kind: 'CA' },
  { code: 'OD', label: 'Journal des Opérations Diverses', kind: 'OD' },
  { code: 'PA', label: 'Journal de Paie', kind: 'PA' },
];

interface MappingOverridePanelProps {
  readonly orgId: string;
  readonly sessionId: string;
  readonly headers: ReadonlyArray<string>;
  readonly currentMapping: Readonly<Record<string, TargetField>>;
  readonly unmappedTargets: ReadonlyArray<TargetField>;
  readonly currentDefaultJournalCode: string | null;
  readonly onSaved: () => void;
}

function MappingOverridePanel({
  orgId,
  sessionId,
  headers,
  currentMapping,
  unmappedTargets,
  currentDefaultJournalCode,
  onSaved,
}: MappingOverridePanelProps) {
  const [draft, setDraft] = useState<Record<string, TargetField | ''>>(() =>
    buildDraft(headers, currentMapping),
  );

  useEffect(() => {
    setDraft(buildDraft(headers, currentMapping));
  }, [headers, currentMapping]);

  const takenByOtherHeader = useMemo(() => {
    const taken: Record<string, ReadonlySet<TargetField>> = {};
    for (const h of headers) {
      const s = new Set<TargetField>();
      for (const [other, t] of Object.entries(draft)) {
        if (other !== h && t !== '') {
          s.add(t);
        }
      }
      taken[h] = s;
    }
    return taken;
  }, [headers, draft]);

  const save = useApiMutation(
    async () => {
      const payload: Record<string, string> = {};
      for (const [header, target] of Object.entries(draft)) {
        if (target !== '') {
          payload[header] = target;
        }
      }
      await api.patch(
        `/organizations/${orgId}/imports/sessions/${sessionId}/mapping`,
        { mappingOverride: payload },
      );
    },
    { onSuccess: () => onSaved() },
  );

  const reset = useApiMutation(
    async () => {
      await api.patch(
        `/organizations/${orgId}/imports/sessions/${sessionId}/mapping`,
        { mappingOverride: {} },
      );
    },
    { onSuccess: () => onSaved() },
  );

  // Journaux actifs — pour le sélecteur de journal par défaut quand le fichier
  // ne porte pas de colonne journal (export Sage mono-journal).
  const journalsQuery = useQuery<ReadonlyArray<JournalView>, ApiError>({
    queryKey: ['journals', orgId],
    queryFn: async () => {
      const data = await api.get<{ journals: ReadonlyArray<JournalView> }>(
        `/organizations/${orgId}/journals`,
      );
      return data.journals;
    },
    enabled: orgId !== '',
  });

  const setDefaultJournal = useApiMutation(
    async (code: string | null) => {
      await api.patch(`/organizations/${orgId}/imports/sessions/${sessionId}`, {
        defaultJournalCode: code,
      });
    },
    { onSuccess: () => onSaved() },
  );

  const journalsClient = useQueryClient();
  // Crée les journaux standards SYSCOHADA manquants sans quitter l'import.
  // Idempotent : un code déjà pris (JOURNAL_CODE_TAKEN) est ignoré.
  const seedStandardJournals = useApiMutation(
    async () => {
      const existing = new Set((journalsQuery.data ?? []).map((j) => j.code));
      for (const seed of STANDARD_JOURNAL_SEEDS) {
        if (existing.has(seed.code)) continue;
        try {
          await api.post(`/organizations/${orgId}/journals`, seed);
        } catch (e) {
          if (!(e instanceof ApiError && e.code === 'JOURNAL_CODE_TAKEN')) throw e;
        }
      }
    },
    {
      onSuccess: () => {
        void journalsClient.invalidateQueries({ queryKey: ['journals', orgId] });
      },
    },
  );

  const missingRequired = useMemo(() => {
    const used = new Set(Object.values(draft).filter((v) => v !== ''));
    return ALL_TARGETS.filter((t) => REQUIRED_TARGETS.has(t) && !used.has(t));
  }, [draft]);

  const hasChanges = useMemo(() => {
    for (const h of headers) {
      const current = currentMapping[h] ?? '';
      if ((draft[h] ?? '') !== current) {
        return true;
      }
    }
    return false;
  }, [headers, draft, currentMapping]);

  return (
    <div className="rounded-sm border border-line bg-canvas p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h4 className="text-sm font-semibold text-ink">Mapping des colonnes</h4>
          <p className="mt-0.5 text-xs leading-snug text-ink-soft">
            Associer chaque colonne du fichier source à un champ canonique. Les modifications
            relancent automatiquement la vérification pour recalculer les erreurs.
          </p>
        </div>
        {actionableUnmapped(unmappedTargets, {
          hasDefaultJournal: currentDefaultJournalCode !== null,
        }).length > 0 && (
          <Badge variant="destructive" className="rounded-full">
            {
              actionableUnmapped(unmappedTargets, {
                hasDefaultJournal: currentDefaultJournalCode !== null,
              }).length
            }{' '}
            champ(s) requis non mappé(s)&nbsp;:{' '}
            {actionableUnmapped(unmappedTargets, {
              hasDefaultJournal: currentDefaultJournalCode !== null,
            })
              .map(targetLabel)
              .join(', ')}
          </Badge>
        )}
      </div>

      <div className="overflow-x-auto rounded-sm border border-line bg-paper">
        <table className="w-full text-sm">
          <thead className="bg-sunk text-2xs uppercase tracking-wider text-ink-mute">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Colonne source</th>
              <th className="px-3 py-2 text-left font-medium">Mappé vers</th>
            </tr>
          </thead>
          <tbody>
            {headers.map((h) => {
              const value = draft[h] ?? '';
              const taken = takenByOtherHeader[h] ?? new Set<TargetField>();
              return (
                <tr key={h} className="border-t border-line">
                  <td className="px-3 py-1.5 font-mono text-xs text-ink">{h}</td>
                  <td className="px-3 py-1.5">
                    <select
                      value={value}
                      onChange={(e) =>
                        setDraft((prev) => ({
                          ...prev,
                          [h]: e.target.value as TargetField | '',
                        }))
                      }
                      className="h-8 w-full max-w-[240px] rounded-sm border border-line-strong bg-paper px-2 py-0 text-sm text-ink"
                    >
                      <option value="">— Ignorer —</option>
                      {ALL_TARGETS.map((t) => {
                        const isTakenElsewhere = taken.has(t);
                        return (
                          <option key={t} value={t} disabled={isTakenElsewhere}>
                            {TARGET_LABEL[t]}
                            {isTakenElsewhere ? ' (déjà utilisé)' : ''}
                            {REQUIRED_TARGETS.has(t) ? ' *' : ''}
                          </option>
                        );
                      })}
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {missingRequired.includes('journal') && (
        <div className="mt-3 rounded-sm border border-warn/50 bg-warn-soft/50 p-3">
          <label htmlFor="default-journal" className="text-xs font-semibold text-ink">
            Journal par défaut
          </label>
          <p className="mt-0.5 text-xs text-ink-soft">
            Votre fichier n&apos;a pas de colonne «&nbsp;Journal&nbsp;». Choisissez le journal
            appliqué à toutes les lignes de cet import (ex.&nbsp;Achats).
          </p>
          <div className="mt-2 flex items-center gap-2">
            <select
              id="default-journal"
              value={currentDefaultJournalCode ?? ''}
              disabled={setDefaultJournal.isPending}
              onChange={(e) =>
                setDefaultJournal.mutate(e.target.value === '' ? null : e.target.value)
              }
              className="rounded-sm border border-line-strong bg-paper px-3 py-1.5 text-sm text-ink focus:border-accent focus:outline-none"
            >
              <option value="">— Choisir un journal —</option>
              {(journalsQuery.data ?? [])
                .filter((j) => j.isActive)
                .map((j) => (
                  <option key={j.id} value={j.code}>
                    {j.code} — {j.label}
                  </option>
                ))}
            </select>
            {setDefaultJournal.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-ink-mute" />
            ) : (
              currentDefaultJournalCode !== null && (
                <span className="text-xs font-medium text-accent-ink">Appliqué</span>
              )
            )}
          </div>
          {!journalsQuery.isLoading &&
            (journalsQuery.data ?? []).filter((j) => j.isActive).length === 0 && (
              <div className="mt-2 space-y-2">
                <p className="text-xs text-critical-ink">
                  Aucun journal n&apos;est configuré pour ce dossier. Créez les journaux standards
                  SYSCOHADA en un clic, puis choisissez-en un ci-dessus.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    className="press"
                    disabled={seedStandardJournals.isPending}
                    onClick={() => seedStandardJournals.mutate(undefined)}
                  >
                    {seedStandardJournals.isPending ? (
                      <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Plus className="mr-2 h-3.5 w-3.5" />
                    )}
                    Créer les journaux standards (AC, VE, BQ, CA, OD, PA)
                  </Button>
                  <Link
                    href="/journals"
                    className="text-xs text-ink-mute underline-offset-2 hover:text-ink hover:underline"
                  >
                    Gérer les journaux
                  </Link>
                </div>
                <FormError error={seedStandardJournals.error} />
              </div>
            )}
          {setDefaultJournal.error !== null && (
            <FormError error={setDefaultJournal.error} className="mt-2" />
          )}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          className="press"
          disabled={!hasChanges || save.isPending}
          onClick={() => save.mutate(undefined)}
        >
          {save.isPending ? (
            <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Save className="mr-2 h-3.5 w-3.5" />
          )}
          Enregistrer le mapping
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="press"
          disabled={reset.isPending}
          onClick={() => reset.mutate(undefined)}
        >
          {reset.isPending ? (
            <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
          ) : (
            <RotateCcw className="mr-2 h-3.5 w-3.5" />
          )}
          Réinitialiser (auto-mapping)
        </Button>
        {(() => {
          // Le journal par défaut satisfait le champ requis « journal » même
          // sans colonne mappée → on le retire du message d'erreur.
          const stillMissing = missingRequired.filter(
            (t) => !(t === 'journal' && currentDefaultJournalCode !== null),
          );
          return stillMissing.length > 0 ? (
            <span className="text-xs text-critical">
              <ArrowRight className="mr-1 inline h-3 w-3" />
              Champs requis manquants&nbsp;:{' '}
              {stillMissing.map((t) => TARGET_LABEL[t]).join(', ')}
            </span>
          ) : null;
        })()}
      </div>
      <FormError error={save.error} className="mt-2" />
      <FormError error={reset.error} className="mt-2" />
    </div>
  );
}

function buildDraft(
  headers: ReadonlyArray<string>,
  currentMapping: Readonly<Record<string, TargetField>>,
): Record<string, TargetField | ''> {
  const out: Record<string, TargetField | ''> = {};
  for (const h of headers) {
    out[h] = currentMapping[h] ?? '';
  }
  return out;
}
