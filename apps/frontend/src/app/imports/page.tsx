'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BarChart3, CheckCircle2, FileUp, Loader2, Plus, RotateCcw, Save, Upload, XCircle } from 'lucide-react';
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
import { useCurrentOrg } from '@/stores/auth-store';
import {
  DOCUMENT_TYPE_DESCRIPTIONS,
  DOCUMENT_TYPE_LABELS,
  type CommitResult,
  type DocumentType,
  type ImportSourceType,
  type PreviewResult,
  type SessionSummary,
  type TargetField,
} from '@/types/imports';

const DOCUMENT_TYPE_ORDER: readonly DocumentType[] = [
  'entries',
  'general_ledger',
  'trial_balance',
  'bank_statement',
  'auxiliary_ledger',
  'sales_purchases',
];

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
 * Surface MVP en une page :
 *   1. Création de session (top form) — sourceType + label optionnel.
 *   2. Liste des sessions de l'org (ordre antéchronologique).
 *   3. Sélection d'une session → panneau détail avec actions
 *      contextuelles selon le statut :
 *        - `draft`      → upload de fichier (CSV/XLSX/Sage TXT).
 *        - `parsed`     → bouton "Générer preview".
 *        - `validated`  → tableau preview + bouton "Commit" (si 0 erreur).
 *        - `completed`  → message read-only avec le compte de lignes
 *          écrites dans le journal comptable.
 *        - `failed`     → message d'échec.
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

  return (
    <AppShell>
      <div className="space-y-6">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">Imports</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Importer des écritures depuis un fichier comptable (CSV, Excel, PDF natif, export
            Sage). Les lignes passent par une étape de staging avant écriture définitive au
            journal.
          </p>
        </header>

        {/* Création de session */}
        <Card>
          <CardHeader>
            <CardTitle>Nouvelle session</CardTitle>
            <CardDescription>
              Une session regroupe un fichier source, son parsing, sa validation et son éventuel
              commit vers le journal comptable.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                createSession.mutate(undefined);
              }}
            >
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="documentType">Type de document</Label>
                  <select
                    id="documentType"
                    value={createDocumentType}
                    onChange={(e) => setCreateDocumentType(e.target.value as DocumentType)}
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    {DOCUMENT_TYPE_ORDER.map((d) => (
                      <option key={d} value={d}>
                        {DOCUMENT_TYPE_LABELS[d]}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-muted-foreground">
                    {DOCUMENT_TYPE_DESCRIPTIONS[createDocumentType]}
                  </p>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="sourceType">Format de fichier</Label>
                  <select
                    id="sourceType"
                    value={createSourceType}
                    onChange={(e) => setCreateSourceType(e.target.value as ImportSourceType)}
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <option value="csv">CSV</option>
                    <option value="excel">Excel (.xlsx / .xls)</option>
                    <option value="pdf">PDF (tableau natif)</option>
                    <option value="sage">Sage TXT</option>
                    <option value="txt">Texte</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_auto] md:items-end">
                <div className="space-y-1">
                  <Label htmlFor="label">Libellé (optionnel)</Label>
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
                  Créer
                </Button>
              </div>
            </form>
            <FormError error={createSession.error} className="mt-3" />
          </CardContent>
        </Card>

        {/* Liste des sessions */}
        <Card>
          <CardHeader>
            <CardTitle>Sessions récentes</CardTitle>
            <CardDescription>Sélectionner une session pour voir le détail.</CardDescription>
          </CardHeader>
          <CardContent>
            {sessionsQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">Chargement…</p>
            ) : sessionsQuery.data?.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Aucune session pour le moment. Créer une session ci-dessus pour démarrer.
              </p>
            ) : (
              <ul className="divide-y rounded-md border">
                {(sessionsQuery.data ?? []).map((s) => {
                  const isSelected = s.id === selectedSessionId;
                  const canAnalyze = s.totalLines > 0;
                  return (
                    <li key={s.id} className="flex items-center">
                      <button
                        type="button"
                        onClick={() => setSelectedSessionId(s.id)}
                        className={`flex flex-1 items-center justify-between gap-3 px-4 py-3 text-left text-sm hover:bg-muted/60 ${
                          isSelected ? 'bg-muted/60' : ''
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">
                              {s.label ?? `Session ${s.id.slice(0, 8)}`}
                            </span>
                            <SessionStatusBadge status={s.status} />
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {s.documentType !== null
                              ? `${DOCUMENT_TYPE_LABELS[s.documentType]} · `
                              : ''}
                            {s.sourceType.toUpperCase()} · {s.totalLines} lignes ·{' '}
                            {s.errorLines > 0
                              ? `${s.errorLines} en erreur`
                              : 'aucune erreur'}{' '}
                            · {new Date(s.createdAt).toLocaleString('fr-FR')}
                          </div>
                        </div>
                      </button>
                      {canAnalyze && (
                        <Link
                          href={`/imports/${s.id}/dashboard`}
                          className="mr-3 inline-flex items-center gap-1 rounded-md border border-input bg-background px-3 py-1.5 text-xs font-medium hover:bg-accent"
                          title="Voir l'analyse de cette session"
                        >
                          <BarChart3 className="h-3.5 w-3.5" />
                          Analyse
                        </Link>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {sessionsQuery.error && (
              <FormError error={sessionsQuery.error} className="mt-3" />
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
// Status badge — color-coded variant per session status. Centralised
// here so the list and the detail panel render the same chip.
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

const STATUS_VARIANT: Record<
  SessionSummary['status'],
  'default' | 'secondary' | 'outline' | 'muted' | 'destructive'
> = {
  draft: 'muted',
  parsing: 'secondary',
  parsed: 'secondary',
  validated: 'default',
  ready_for_import: 'default',
  completed: 'default',
  failed: 'destructive',
};

function SessionStatusBadge({ status }: { status: SessionSummary['status'] }) {
  return <Badge variant={STATUS_VARIANT[status]}>{STATUS_LABEL[status]}</Badge>;
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

  // Upload — multipart, on contourne le client JSON pour passer FormData.
  const upload = useApiMutation(
    async () => {
      if (!file) {
        throw new ApiError(422, {
          code: 'IMPORT_UNSUPPORTED_FORMAT',
          message: 'Sélectionner un fichier avant de cliquer sur Uploader.',
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

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              Détail session
              <SessionStatusBadge status={session.status} />
            </CardTitle>
            <CardDescription>
              {session.label ?? `Session ${session.id.slice(0, 8)}`} · {session.totalLines} lignes
              {session.errorLines > 0 ? ` · ${session.errorLines} en erreur` : ''}
            </CardDescription>
          </div>
          {session.totalLines > 0 && (
            <Link
              href={`/imports/${session.id}/dashboard`}
              className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium hover:bg-accent"
            >
              <BarChart3 className="h-4 w-4" />
              Voir l&apos;analyse
            </Link>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Upload */}
        <section className="space-y-3">
          <h3 className="text-sm font-medium">1. Upload du fichier</h3>
          {canUpload ? (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <Input
                type="file"
                accept=".csv,.xlsx,.xls,.txt,.pdf"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="cursor-pointer file:mr-3 file:rounded-md file:border file:border-input file:bg-background file:px-3 file:py-1 file:text-sm"
              />
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
                Uploader & parser
              </Button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Upload non disponible — le statut « {STATUS_LABEL[session.status]} » indique que
              le fichier a déjà été reçu.
            </p>
          )}
          <FormError error={upload.error} />
          {upload.data && (
            <p className="text-sm text-emerald-600">
              <CheckCircle2 className="mr-1 inline h-4 w-4" />
              Parsing OK : {upload.data.parsed.rowsParsed} lignes, en-têtes :{' '}
              {upload.data.parsed.headers.join(', ')}
            </p>
          )}
        </section>

        {/* Preview */}
        <section className="space-y-3">
          <h3 className="text-sm font-medium">2. Génération de la preview</h3>
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
            Générer la preview
          </Button>
          <FormError error={previewMutation.error} />

          {/* Mapping override panel — wave 2 (projet-ferme-3wy).
              Affiché dès qu'on a une preview pour permettre de corriger
              les colonnes que l'auto-mapping n'a pas reconnues (ex.
              "N°DE COMPTE" → account). Sauvegarde via PATCH ; la
              session repasse en `parsed` côté backend, donc on
              re-déclenche immédiatement la preview pour re-projeter
              et re-valider les staging rows. */}
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
            <div className="space-y-3">
              <div className="flex flex-wrap gap-3 text-sm">
                <span>Total : {preview.totals.total}</span>
                <span>
                  En erreur :{' '}
                  <span
                    className={
                      preview.totals.withErrors > 0
                        ? 'font-semibold text-destructive'
                        : 'font-semibold text-emerald-600'
                    }
                  >
                    {preview.totals.withErrors}
                  </span>
                </span>
                {preview.unmappedTargets.length > 0 && (
                  <span className="text-muted-foreground">
                    Colonnes non mappées : {preview.unmappedTargets.join(', ')}
                  </span>
                )}
              </div>
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left">#</th>
                      <th className="px-3 py-2 text-left">Compte</th>
                      <th className="px-3 py-2 text-left">Journal</th>
                      <th className="px-3 py-2 text-left">Date</th>
                      <th className="px-3 py-2 text-right">Débit</th>
                      <th className="px-3 py-2 text-right">Crédit</th>
                      <th className="px-3 py-2 text-left">Libellé</th>
                      <th className="px-3 py-2 text-left">Erreurs</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.entries.map((e) => {
                      const hasErr = e.errors.length > 0;
                      return (
                        <tr
                          key={e.rowNumber}
                          className={hasErr ? 'bg-destructive/5' : 'border-t'}
                        >
                          <td className="px-3 py-2 text-muted-foreground">{e.rowNumber}</td>
                          <td className="px-3 py-2">{e.mappedValues.account ?? '—'}</td>
                          <td className="px-3 py-2">{e.mappedValues.journal ?? '—'}</td>
                          <td className="px-3 py-2">{e.mappedValues.date ?? '—'}</td>
                          <td className="px-3 py-2 text-right">
                            {e.mappedValues.debit ?? '—'}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {e.mappedValues.credit ?? '—'}
                          </td>
                          <td className="px-3 py-2">{e.mappedValues.label ?? '—'}</td>
                          <td className="px-3 py-2 text-xs">
                            {hasErr ? (
                              <span className="text-destructive">
                                {e.errors.map((x) => x.code).join(', ')}
                              </span>
                            ) : (
                              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
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
        {/* (le panneau Commit suit ; voir plus bas) */}
        <section className="space-y-3">
          <h3 className="text-sm font-medium">3. Commit définitif vers le journal</h3>
          <p className="text-xs text-muted-foreground">
            Cette action crée les écritures comptables réelles à partir du staging.
            Irréversible — utilisez la contre-passation depuis la page Journaux pour annuler
            une écriture committée.
          </p>
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
            Committer vers le journal
          </Button>
          {!canCommit && session.errorLines > 0 && (
            <p className="text-xs text-muted-foreground">
              <XCircle className="mr-1 inline h-3 w-3" />
              Commit bloqué : {session.errorLines} ligne(s) en erreur. Corrigez le fichier
              source et re-créez une session.
            </p>
          )}
          <FormError error={commitMutation.error} />
          {commitDone && (
            <p className="text-sm text-emerald-600">
              <CheckCircle2 className="mr-1 inline h-4 w-4" />
              Commit réussi : {commitDone.committedRows} ligne(s) écrites au journal.
            </p>
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
// vers une `TargetField` canonique (ou "(ignorer)"). L'état local est
// initialisé sur le `currentMapping` reçu de la dernière preview.
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
  // Etat local : header → TargetField ou '' (ignoré). Initialisé sur
  // currentMapping ; resynchronisé à chaque changement de preview pour
  // que l'utilisateur voie immédiatement l'effet d'un Save côté backend.
  const [draft, setDraft] = useState<Record<string, TargetField | ''>>(() =>
    buildDraft(headers, currentMapping),
  );

  useEffect(() => {
    setDraft(buildDraft(headers, currentMapping));
  }, [headers, currentMapping]);

  // Pour chaque header, lister les targets DÉJÀ pris par un autre header
  // dans le draft — on les désactive en option pour éviter de proposer
  // un mapping qui crasherait au save.
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
    {
      onSuccess: () => onSaved(),
    },
  );

  const reset = useApiMutation(
    async () => {
      await api.patch(
        `/organizations/${orgId}/imports/sessions/${sessionId}/mapping`,
        { mappingOverride: {} },
      );
    },
    {
      onSuccess: () => onSaved(),
    },
  );

  // Champs requis encore non mappés dans le draft courant.
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
    <div className="rounded-md border bg-muted/20 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="text-sm font-medium">Mapping des colonnes</h4>
          <p className="text-xs text-muted-foreground">
            Associer chaque colonne du fichier source à un champ canonique. Les modifications
            relancent automatiquement la preview pour recalculer les erreurs.
          </p>
        </div>
        {unmappedTargets.length > 0 && (
          <Badge variant="destructive">
            {unmappedTargets.length} champ(s) canonique(s) non mappé(s) :{' '}
            {unmappedTargets.map((t) => TARGET_LABEL[t]).join(', ')}
          </Badge>
        )}
      </div>

      <div className="overflow-x-auto rounded-md border bg-background">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Colonne source</th>
              <th className="px-3 py-2 text-left">Mappé vers</th>
            </tr>
          </thead>
          <tbody>
            {headers.map((h) => {
              const value = draft[h] ?? '';
              const taken = takenByOtherHeader[h] ?? new Set<TargetField>();
              return (
                <tr key={h} className="border-t">
                  <td className="px-3 py-1.5 font-mono text-xs">{h}</td>
                  <td className="px-3 py-1.5">
                    <select
                      value={value}
                      onChange={(e) =>
                        setDraft((prev) => ({
                          ...prev,
                          [h]: e.target.value as TargetField | '',
                        }))
                      }
                      className="h-8 w-full max-w-[240px] rounded-md border border-input bg-background px-2 py-0 text-sm"
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
          <span className="text-xs text-destructive">
            Champs requis manquants : {missingRequired.map((t) => TARGET_LABEL[t]).join(', ')}
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
