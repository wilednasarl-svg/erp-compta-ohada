'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRight,
  BarChart3,
  CheckCircle2,
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
import { ApiError, api, getAuthToken } from '@/lib/api-client';
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

import { DeleteSessionConfirm } from './_components/delete-confirm';
import { PipelineStepper } from './_components/pipeline-stepper';

/**
 * Libellés FR courts pour la phrase « Ce fichier ressemble plutôt à
 * une {libellé} ». Distincts de `DOCUMENT_TYPE_LABELS` (formels) :
 * ici on veut une formulation contextuelle et concise.
 */
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

/**
 * `/imports` — pipeline d'import comptable Module 3.
 *
 * Surface en une page, articulée autour de 4 phases visibles via
 * <PipelineStepper /> dans le panneau détail :
 *
 *   1. Préparer    — création de session (top form)
 *   2. Réception   — upload + parsing du fichier source
 *   3. Vérification — mapping colonnes + contrôle ligne par ligne
 *   4. Au journal  — commit définitif vers le grand livre
 *
 * Visibilité : pas de gating client. Le backend renvoie
 * FORBIDDEN_PERMISSION sur write/commit pour les rôles auditeur /
 * client_readonly, et l'erreur remonte inline. Cacher les boutons
 * créerait un trou de découverte (un auditeur doit comprendre
 * pourquoi il n'a pas le droit, pas voir l'action disparaître).
 */
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

  // ─── Création de session ────────────────────────────────────────────
  const [createSourceType, setCreateSourceType] = useState<ImportSourceType>('csv');
  const [createDocumentType, setCreateDocumentType] = useState<DocumentType>('entries');
  const [createLabel, setCreateLabel] = useState('');

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
        setSelectedSessionId(session.id);
        void queryClient.invalidateQueries({ queryKey: ['imports', 'sessions', orgId] });
      },
    },
  );

  // ─── Sélection + détail ─────────────────────────────────────────────
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const selectedSession = sessionsQuery.data?.find((s) => s.id === selectedSessionId) ?? null;

  // ─── Suppression de session (Module 3 wave 3) ───────────────────────
  // Mutation partagée entre la liste et le panneau détail : déclenchée
  // depuis l'icône poubelle sur chaque ligne. On garde l'ID en flight
  // pour disabled-only-this-row pendant que les autres restent cliquables.
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

  return (
    <AppShell>
      <div className="space-y-6">
        <header className="border-b border-line pb-5">
          <p className="text-2xs uppercase tracking-wider text-ink-mute">
            Saisie · Imports comptables
          </p>
          <h1 className="mt-1 font-display text-3xl font-medium tracking-tight text-ink">
            Importer des écritures
          </h1>
          <p className="mt-2 max-w-[68ch] text-sm leading-relaxed text-ink-soft">
            Ingérer un fichier comptable (CSV, Excel, PDF natif, export Sage). Chaque fichier
            passe par quatre étapes&nbsp;:{' '}
            <span className="font-medium text-ink">préparation</span>,{' '}
            <span className="font-medium text-ink">réception</span>,{' '}
            <span className="font-medium text-ink">vérification</span>,{' '}
            <span className="font-medium text-ink">passage au journal</span>. Les écritures
            n&apos;atteignent le grand livre qu&apos;à la dernière étape.
          </p>
        </header>

        {/* Création de session */}
        <Card className="border-line bg-paper shadow-none">
          <CardHeader className="border-b border-line">
            <p className="text-2xs uppercase tracking-wider text-accent-ink">
              Étape 1 · Préparer
            </p>
            <CardTitle className="mt-1 font-display text-2xl font-medium tracking-tight">
              Nouvelle session d&apos;import
            </CardTitle>
            <CardDescription className="text-ink-soft">
              Indiquer le type de document attendu et le format du fichier source. La session
              reste vide tant qu&apos;aucun fichier n&apos;est téléversé&nbsp;: vous pouvez la
              créer maintenant et envoyer le fichier plus tard.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-6">
            <form
              className="space-y-5"
              onSubmit={(e) => {
                e.preventDefault();
                createSession.mutate(undefined);
              }}
            >
              <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label
                    htmlFor="documentType"
                    className="text-2xs uppercase tracking-wider text-ink-soft"
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
                </div>
                <div className="space-y-1.5">
                  <Label
                    htmlFor="sourceType"
                    className="text-2xs uppercase tracking-wider text-ink-soft"
                  >
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
                    Format d&apos;export attendu pour le fichier source. Sage TXT correspond
                    aux exports natifs Sage Saari.
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_auto] md:items-end">
                <div className="space-y-1.5">
                  <Label
                    htmlFor="label"
                    className="text-2xs uppercase tracking-wider text-ink-soft"
                  >
                    Libellé{' '}
                    <span className="font-normal text-ink-mute lowercase tracking-normal">
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
                <Button type="submit" disabled={createSession.isPending}>
                  {createSession.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="mr-2 h-4 w-4" />
                  )}
                  Créer la session
                </Button>
              </div>
            </form>
            <FormError error={createSession.error} className="mt-4" />
          </CardContent>
        </Card>

        {/* Liste des sessions */}
        <Card className="border-line bg-paper shadow-none">
          <CardHeader className="border-b border-line">
            <div className="flex items-end justify-between gap-3">
              <div>
                <CardTitle className="font-display text-2xl font-medium tracking-tight">
                  Sessions récentes
                </CardTitle>
                <CardDescription className="mt-1 text-ink-soft">
                  Sélectionner une session pour reprendre où vous en étiez.
                </CardDescription>
              </div>
              {sessionsQuery.data && sessionsQuery.data.length > 0 && (
                <p className="text-2xs uppercase tracking-wider text-ink-mute">
                  <span className="font-mono tabular-nums text-ink">
                    {sessionsQuery.data.length}
                  </span>{' '}
                  session{sessionsQuery.data.length > 1 ? 's' : ''}
                </p>
              )}
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {sessionsQuery.isLoading ? (
              <div className="flex items-center gap-2 px-6 py-8 text-sm text-ink-mute">
                <Loader2 className="h-4 w-4 animate-spin" />
                Chargement des sessions…
              </div>
            ) : sessionsQuery.data?.length === 0 ? (
              <SessionsEmptyState />
            ) : (
              <ul className="divide-y divide-line">
                {(sessionsQuery.data ?? []).map((s) => {
                  const isSelected = s.id === selectedSessionId;
                  const canAnalyze = s.totalLines > 0;
                  const isPendingDelete =
                    deleteSession.isPending && deletingSessionId === s.id;
                  const labelOrId = s.label ?? `Session ${s.id.slice(0, 8)}`;
                  return (
                    <li
                      key={s.id}
                      className={cn(
                        'group flex items-center gap-3 px-5 py-3 transition-colors',
                        isSelected
                          ? 'bg-accent-soft/60'
                          : 'hover:bg-sunk',
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => setSelectedSessionId(s.id)}
                        className="flex min-w-0 flex-1 items-center gap-4 text-left"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
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
                            <SessionStatusBadge status={s.status} />
                          </div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-ink-mute">
                            {s.documentType !== null && (
                              <span>{DOCUMENT_TYPE_LABELS[s.documentType]}</span>
                            )}
                            <span className="font-mono text-2xs uppercase tracking-wider">
                              {s.sourceType}
                            </span>
                            <span>
                              <span className="font-mono tabular-nums text-ink-soft">
                                {s.totalLines.toLocaleString('fr-FR')}
                              </span>{' '}
                              lignes
                            </span>
                            {s.errorLines > 0 && (
                              <span className="text-critical">
                                <span className="font-mono tabular-nums">
                                  {s.errorLines.toLocaleString('fr-FR')}
                                </span>{' '}
                                en erreur
                              </span>
                            )}
                            <span className="font-mono tabular-nums">
                              {new Date(s.createdAt).toLocaleDateString('fr-FR', {
                                day: '2-digit',
                                month: 'short',
                                year: 'numeric',
                              })}
                            </span>
                          </div>
                        </div>
                      </button>
                      <div className="flex shrink-0 items-center gap-2">
                        {canAnalyze && (
                          <Link
                            href={`/imports/${s.id}/dashboard`}
                            className="inline-flex items-center gap-1.5 rounded-md border border-line-strong bg-paper px-2.5 py-1.5 text-xs font-medium text-ink-soft transition-colors hover:border-ink hover:text-ink"
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
          </CardContent>
        </Card>

        {/* Panneau détail */}
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

// ─────────────────────────────────────────────────────────────────────
// Status badge — color-coded variant per session status.
//
// Chaque catégorie a une teinte propre pour scanner une liste de 50
// sessions en diagonale :
//   - draft              → neutre (en attente d'action)
//   - parsing/parsed     → info bleu encre (en cours technique)
//   - validated/ready    → accent vert pâle (prêt, mais pas figé)
//   - completed          → accent vert plein (terminé, immuable)
//   - failed             → critical rouge (terminal d'erreur)
// ─────────────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<SessionSummary['status'], string> = {
  draft: 'Brouillon',
  parsing: 'Parsing…',
  parsed: 'Parsé',
  validated: 'Validé',
  ready_for_import: 'Prêt à committer',
  completed: 'Committé',
  failed: 'Échec',
};

const STATUS_CLASSES: Record<SessionSummary['status'], string> = {
  draft: 'bg-sunk text-ink-soft border-line-strong',
  parsing: 'bg-info-soft text-info-ink border-info/30',
  parsed: 'bg-info-soft text-info-ink border-info/30',
  validated: 'bg-accent-soft text-accent-ink border-accent/30',
  ready_for_import: 'bg-accent-soft text-accent-ink border-accent/30',
  completed: 'bg-accent text-paper border-accent',
  failed: 'bg-critical-soft text-critical-ink border-critical/30',
};

function SessionStatusBadge({ status }: { status: SessionSummary['status'] }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-xs border px-1.5 py-0.5 text-2xs font-medium uppercase tracking-wider',
        STATUS_CLASSES[status],
      )}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Empty state — onboarding pédagogique. Pas un personnage générique qui
// cherche : une mini-fresque texte qui enseigne le pipeline en 4 étapes
// et renvoie vers le formulaire au-dessus.
// ─────────────────────────────────────────────────────────────────────

function SessionsEmptyState() {
  const steps: ReadonlyArray<{ icon: React.ReactNode; title: string; body: string }> = [
    {
      icon: <Plus className="h-4 w-4" strokeWidth={1.5} />,
      title: 'Créer une session',
      body: 'Indiquer le type de document (écritures, balance, grand livre…) et le format du fichier source.',
    },
    {
      icon: <Upload className="h-4 w-4" strokeWidth={1.5} />,
      title: 'Téléverser le fichier',
      body: 'CSV, Excel, PDF natif ou export Sage TXT. Les lignes sont parsées et placées en staging.',
    },
    {
      icon: <Sparkles className="h-4 w-4" strokeWidth={1.5} />,
      title: 'Vérifier le mapping',
      body: 'Associer chaque colonne du fichier à un champ canonique. Corriger les erreurs de format.',
    },
    {
      icon: <CheckCircle2 className="h-4 w-4" strokeWidth={1.5} />,
      title: 'Committer au journal',
      body: 'Les écritures rejoignent le grand livre. Toute correction passe ensuite par contre-passation.',
    },
  ];
  return (
    <div className="px-6 py-10">
      <div className="mx-auto max-w-2xl">
        <p className="text-2xs uppercase tracking-wider text-ink-mute">Aucune session</p>
        <h3 className="mt-1 font-display text-xl font-medium tracking-tight text-ink">
          Démarrer un premier import
        </h3>
        <p className="mt-2 max-w-[60ch] text-sm leading-relaxed text-ink-soft">
          Le pipeline d&apos;import sépare le fichier source des écritures réelles&nbsp;: rien
          n&apos;atteint le grand livre avant la dernière étape. Vous pouvez revenir en arrière
          ou supprimer la session tant qu&apos;elle n&apos;est pas committée.
        </p>
        <ol className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {steps.map((step, i) => (
            <li
              key={step.title}
              className="flex gap-3 rounded-md border border-line bg-canvas px-3 py-2.5"
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sunk text-ink-soft">
                {step.icon}
              </span>
              <div className="min-w-0">
                <p className="text-2xs uppercase tracking-wider text-ink-mute">
                  Étape <span className="font-mono tabular-nums">{i + 1}</span>
                </p>
                <p className="text-sm font-medium text-ink">{step.title}</p>
                <p className="mt-0.5 text-xs leading-snug text-ink-soft">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
        <p className="mt-6 flex items-center gap-2 text-sm text-ink-soft">
          <ArrowRight className="h-4 w-4 text-accent" />
          Utiliser le formulaire&nbsp;
          <span className="font-medium text-ink">Nouvelle session d&apos;import</span>
          &nbsp;ci-dessus pour commencer.
        </p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Section heading — titre de phase numéroté avec hint contextuel.
// État `active=false` grise l'ensemble pour signaler que l'étape n'est
// pas encore atteignable ou qu'elle est déjà franchie.
// ─────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────
// Suggestion bandeau : « Ce fichier ressemble plutôt à une {libellé}. »
//
// Ton ambré informatif. Pas un toast volatil — le signal reste visible
// pour qu'un opérateur puisse y revenir après inspection de la preview.
// ─────────────────────────────────────────────────────────────────────

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
    <div className="flex flex-col gap-2 rounded-md border border-warn/30 bg-warn-soft px-3 py-2.5 text-sm text-warn-ink sm:flex-row sm:items-center sm:justify-between">
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
          className="border-warn/40 bg-paper text-warn-ink hover:bg-warn-soft"
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

// ─────────────────────────────────────────────────────────────────────
// Detail panel — actions contextuelles selon le statut
// ─────────────────────────────────────────────────────────────────────

interface DetailProps {
  readonly orgId: string;
  readonly session: SessionSummary;
  readonly onMutated: () => void;
}

function SessionDetailPanel({ orgId, session, onMutated }: DetailProps) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [commitDone, setCommitDone] = useState<CommitResult | null>(null);

  // ─── Renommage inline ───────────────────────────────────────────────
  // Label informationnel — autorisé sur TOUS les statuts (y compris
  // `completed`) puisqu'il n'est pas propagé dans les écritures réelles.
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

  // Upload — multipart, on contourne le client JSON pour passer FormData.
  const upload = useApiMutation(
    async () => {
      if (!file) {
        throw new ApiError(422, {
          code: 'IMPORT_UNSUPPORTED_FORMAT',
          message: 'Sélectionner un fichier avant de cliquer sur Téléverser.',
        });
      }
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

  // Preview — re-déclenche le mapping + validation + persist (idempotent).
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

  // Bascule de DocumentType — injecte la sentinelle `__documentType`
  // dans le `mappingOverride` existant pour préserver les overrides
  // de colonnes déjà choisis par l'utilisateur. Le backend re-applique
  // le mapping + revalide la staging, et repasse la session en `parsed`.
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

  // Commit — passe staging → journal_entries via EntriesService.
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
  }, [session.id]);

  // Auto-trigger preview on mount (and on session swap) when the session
  // is already in a state where preview is meaningful. Guards prevent
  // an infinite retry loop on a persistent failure.
  useEffect(() => {
    if (!canPreview) return;
    if (preview !== null) return;
    if (previewMutation.isPending) return;
    if (previewMutation.error !== null) return;
    previewMutation.mutate(undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id, canPreview, preview, previewMutation.isPending, previewMutation.error]);

  return (
    <Card className="border-line bg-paper shadow-none">
      <CardHeader className="border-b border-line">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-2xs uppercase tracking-wider text-ink-mute">
              Détail · session sélectionnée
            </p>
            {isRenaming ? (
              <form
                className="mt-2 flex flex-wrap items-center gap-2"
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
                <Button type="submit" size="sm" disabled={renameSession.isPending}>
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
              <CardTitle className="mt-1 flex items-center gap-2 font-display text-2xl font-medium tracking-tight">
                <span className="truncate text-ink">
                  {session.label ?? `Session ${session.id.slice(0, 8)}`}
                </span>
                <SessionStatusBadge status={session.status} />
              </CardTitle>
            )}
            {!isRenaming && (
              <CardDescription className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-mute">
                <button
                  type="button"
                  onClick={() => {
                    setLabelDraft(session.label ?? '');
                    setIsRenaming(true);
                  }}
                  className="inline-flex items-center gap-1 rounded-sm px-1 py-0.5 text-ink-soft transition-colors hover:bg-sunk hover:text-ink"
                  title="Renommer la session"
                >
                  <Pencil className="h-3 w-3" />
                  Renommer
                </button>
                <span className="text-line-strong" aria-hidden>
                  ·
                </span>
                <span>
                  <span className="font-mono tabular-nums text-ink-soft">
                    {session.totalLines.toLocaleString('fr-FR')}
                  </span>{' '}
                  lignes en staging
                </span>
                {session.errorLines > 0 && (
                  <>
                    <span className="text-line-strong" aria-hidden>
                      ·
                    </span>
                    <span className="text-critical">
                      <span className="font-mono tabular-nums">
                        {session.errorLines.toLocaleString('fr-FR')}
                      </span>{' '}
                      en erreur
                    </span>
                  </>
                )}
                {session.documentType !== null && (
                  <>
                    <span className="text-line-strong" aria-hidden>
                      ·
                    </span>
                    <span>{DOCUMENT_TYPE_LABELS[session.documentType]}</span>
                  </>
                )}
              </CardDescription>
            )}
          </div>
          {session.totalLines > 0 && (
            <Link
              href={`/imports/${session.id}/dashboard`}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-line-strong bg-paper px-3 py-1.5 text-sm font-medium text-ink-soft transition-colors hover:border-ink hover:text-ink"
            >
              <BarChart3 className="h-4 w-4" />
              Voir l&apos;analyse
            </Link>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-8 pt-6">
        {/* Pipeline stepper — visualisation pédagogique du parcours en 4
            phases. Remplace l'orientation purement textuelle qu'imposait
            la liste « 1. Upload / 2. Preview / 3. Commit » des sections
            ci-dessous. Le statut technique reste dans le badge du header,
            le stepper donne la trajectoire métier. */}
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
            <div className="flex flex-col gap-3 rounded-md border border-line bg-sunk/40 p-4 sm:flex-row sm:items-end">
              <div className="flex-1">
                <Label
                  htmlFor="file-upload"
                  className="mb-1 block text-2xs uppercase tracking-wider text-ink-soft"
                >
                  Fichier
                </Label>
                <Input
                  id="file-upload"
                  type="file"
                  accept=".csv,.xlsx,.xls,.txt,.pdf"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  className="cursor-pointer file:mr-3 file:rounded-sm file:border file:border-line-strong file:bg-paper file:px-3 file:py-1 file:text-sm file:text-ink-soft hover:file:bg-sunk"
                />
                {file && (
                  <p className="mt-1.5 text-xs text-ink-mute">
                    Sélectionné&nbsp;:{' '}
                    <span className="font-mono text-ink-soft">{file.name}</span>{' '}
                    <span className="tabular-nums">
                      (
                      {(file.size / 1024).toLocaleString('fr-FR', {
                        maximumFractionDigits: 1,
                      })}{' '}
                      Ko)
                    </span>
                  </p>
                )}
              </div>
              <Button
                type="button"
                disabled={!file || upload.isPending}
                onClick={() => upload.mutate(undefined)}
              >
                {upload.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="mr-2 h-4 w-4" />
                )}
                Téléverser et analyser
              </Button>
            </div>
          ) : (
            <p className="rounded-md border border-line bg-sunk/40 px-4 py-3 text-xs text-ink-soft">
              <CheckCircle2 className="mr-1.5 inline h-3.5 w-3.5 text-accent" />
              Le fichier a déjà été reçu (statut «&nbsp;{STATUS_LABEL[session.status]}&nbsp;»).
              Passer à l&apos;étape de vérification ci-dessous.
            </p>
          )}
          <FormError error={upload.error} />
          {upload.data && (
            <div className="rounded-md border border-accent/20 bg-accent-soft/40 px-3 py-2.5 text-sm text-accent-ink">
              <p className="font-medium">
                <CheckCircle2 className="mr-1.5 inline h-4 w-4" />
                Analyse réussie ·{' '}
                <span className="font-mono tabular-nums">
                  {upload.data.parsed.rowsParsed.toLocaleString('fr-FR')}
                </span>{' '}
                lignes lues
              </p>
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
                ? "Associer chaque colonne du fichier à un champ canonique (Compte, Journal, Date, Débit, Crédit…). La validation des règles OHADA s'exécute en direct."
                : session.status === 'draft'
                  ? "Téléverser un fichier à l'étape précédente pour activer la vérification."
                  : 'Étape déjà franchie pour cette session.'
            }
          />
          <Button
            type="button"
            variant="secondary"
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
              onSaved={() => {
                previewMutation.mutate(undefined);
                onMutated();
              }}
            />
          )}

          {preview && (
            <div className="space-y-4">
              {/* Bandeau de totaux — 3 indicateurs en grille pleine
                  largeur. Le bloc « En erreur » bascule en critical-soft
                  quand des erreurs existent, accent-soft sinon, pour
                  qu'on voie l'état en un coup d'œil. */}
              <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-line bg-line sm:grid-cols-3">
                <div className="bg-paper px-4 py-2.5">
                  <p className="text-2xs uppercase tracking-wider text-ink-mute">
                    Lignes en staging
                  </p>
                  <p className="mt-0.5 font-mono text-xl font-medium tabular-nums text-ink">
                    {preview.totals.total.toLocaleString('fr-FR')}
                  </p>
                </div>
                <div
                  className={cn(
                    'px-4 py-2.5',
                    preview.totals.withErrors > 0
                      ? 'bg-critical-soft'
                      : 'bg-accent-soft/60',
                  )}
                >
                  <p
                    className={cn(
                      'text-2xs uppercase tracking-wider',
                      preview.totals.withErrors > 0
                        ? 'text-critical-ink'
                        : 'text-accent-ink',
                    )}
                  >
                    {preview.totals.withErrors > 0 ? 'En erreur' : 'Toutes validées'}
                  </p>
                  <p
                    className={cn(
                      'mt-0.5 font-mono text-xl font-medium tabular-nums',
                      preview.totals.withErrors > 0
                        ? 'text-critical-ink'
                        : 'text-accent-ink',
                    )}
                  >
                    {preview.totals.withErrors.toLocaleString('fr-FR')}
                  </p>
                </div>
                <div className="col-span-2 bg-paper px-4 py-2.5 sm:col-span-1">
                  <p className="text-2xs uppercase tracking-wider text-ink-mute">
                    Colonnes non mappées
                  </p>
                  <p className="mt-0.5 text-sm leading-snug text-ink">
                    {preview.unmappedTargets.length > 0 ? (
                      <span className="font-mono text-xs">
                        {preview.unmappedTargets.join(', ')}
                      </span>
                    ) : (
                      <span className="text-ink-mute">— aucune</span>
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

              {/* Table preview — règles DESIGN.md :
                    header sunk + uppercase + tracking,
                    montants mono + tabular,
                    erreurs en critical-soft (pas destructive/5),
                    pas de zebra stripes (Excel-ism daté). */}
              <div className="overflow-x-auto rounded-md border border-line">
                <table className="w-full text-sm">
                  <thead className="bg-sunk text-2xs uppercase tracking-wider text-ink-mute">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">Ligne</th>
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
                          <td className="px-3 py-2 font-mono text-xs text-ink">
                            {e.mappedValues.account ?? (
                              <span className="text-ink-mute">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2 font-mono text-xs uppercase tracking-wider text-ink-soft">
                            {e.mappedValues.journal ?? (
                              <span className="text-ink-mute normal-case tracking-normal">—</span>
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
                              <span className="inline-flex items-center gap-1 text-critical">
                                <XCircle className="h-3.5 w-3.5" />
                                <span className="font-mono">
                                  {e.errors.map((x) => x.code).join(', ')}
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
                    : 'Vérifier les lignes à l\'étape précédente pour débloquer le passage.'
            }
          />
          <div className="rounded-md border border-line bg-sunk/40 p-4">
            <p className="text-xs leading-relaxed text-ink-soft">
              <span className="font-medium text-ink">Action irréversible.</span> Cette opération
              crée les écritures comptables réelles à partir des lignes en staging. Pour annuler
              une écriture committée, utiliser la contre-passation depuis la page&nbsp;
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
            <div className="rounded-md border border-accent/30 bg-accent-soft/60 px-3 py-2.5 text-sm text-accent-ink">
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
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Mapping override panel — wave 2 (projet-ferme-3wy)
//
// Pour chaque header détecté dans le fichier source, propose un dropdown
// vers une `TargetField` canonique (ou "(ignorer)").
//
// Contrainte backend (MappingService) : un même TargetField ne peut être
// mappé qu'à UN header — on désactive en grisé les options déjà prises
// par un autre header pour éviter une erreur 422 côté serveur.
// ─────────────────────────────────────────────────────────────────────

const TARGET_LABEL: Record<TargetField, string> = {
  account: 'Compte',
  journal: 'Journal',
  date: 'Date',
  debit: 'Débit',
  credit: 'Crédit',
  label: 'Libellé',
  partner: 'Tiers',
  currency: 'Devise',
};

const ALL_TARGETS: ReadonlyArray<TargetField> = [
  'account',
  'journal',
  'date',
  'debit',
  'credit',
  'label',
  'partner',
  'currency',
];

const REQUIRED_TARGETS: ReadonlySet<TargetField> = new Set<TargetField>([
  'account',
  'journal',
  'date',
  'label',
]);

interface MappingOverridePanelProps {
  readonly orgId: string;
  readonly sessionId: string;
  readonly headers: ReadonlyArray<string>;
  readonly currentMapping: Readonly<Record<string, TargetField>>;
  readonly unmappedTargets: ReadonlyArray<TargetField>;
  readonly onSaved: () => void;
}

function MappingOverridePanel({
  orgId,
  sessionId,
  headers,
  currentMapping,
  unmappedTargets,
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
    <div className="rounded-md border border-line bg-canvas p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h4 className="text-sm font-semibold text-ink">Mapping des colonnes</h4>
          <p className="mt-0.5 text-xs leading-snug text-ink-soft">
            Associer chaque colonne du fichier source à un champ canonique. Les modifications
            relancent automatiquement la vérification pour recalculer les erreurs.
          </p>
        </div>
        {unmappedTargets.length > 0 && (
          <Badge variant="destructive" className="rounded-xs">
            {unmappedTargets.length} champ(s) non mappé(s)&nbsp;:{' '}
            {unmappedTargets.map((t) => TARGET_LABEL[t]).join(', ')}
          </Badge>
        )}
      </div>

      <div className="overflow-x-auto rounded-md border border-line bg-paper">
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

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
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
        {missingRequired.length > 0 && (
          <span className="text-xs text-critical">
            Champs requis manquants&nbsp;:{' '}
            {missingRequired.map((t) => TARGET_LABEL[t]).join(', ')}
          </span>
        )}
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
