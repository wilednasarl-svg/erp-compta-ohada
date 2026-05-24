'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, FileUp, Loader2, Plus, Upload, XCircle } from 'lucide-react';
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
import { ApiError, api, getAuthToken } from '@/lib/api-client';
import { useCurrentOrg } from '@/stores/auth-store';
import type {
  CommitResult,
  ImportSourceType,
  PreviewResult,
  SessionSummary,
} from '@/types/imports';

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
  const [createLabel, setCreateLabel] = useState('');

  const createSession = useApiMutation(
    async () => {
      const data = await api.post<SessionResponse>(
        `/organizations/${orgId}/imports/sessions`,
        {
          sourceType: createSourceType,
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
            Importer des écritures depuis un fichier comptable (CSV, Excel, export Sage). Les
            lignes passent par une étape de staging avant écriture définitive au journal.
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
              className="grid grid-cols-1 gap-4 md:grid-cols-[160px_1fr_auto] md:items-end"
              onSubmit={(e) => {
                e.preventDefault();
                createSession.mutate(undefined);
              }}
            >
              <div className="space-y-1">
                <Label htmlFor="sourceType">Format source</Label>
                <select
                  id="sourceType"
                  value={createSourceType}
                  onChange={(e) => setCreateSourceType(e.target.value as ImportSourceType)}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="csv">CSV</option>
                  <option value="excel">Excel</option>
                  <option value="sage">Sage TXT</option>
                  <option value="txt">Texte</option>
                </select>
              </div>
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
                  return (
                    <li key={s.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedSessionId(s.id)}
                        className={`flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm hover:bg-muted/60 ${
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
                            {s.sourceType.toUpperCase()} · {s.totalLines} lignes ·{' '}
                            {s.errorLines > 0
                              ? `${s.errorLines} en erreur`
                              : 'aucune erreur'}{' '}
                            · {new Date(s.createdAt).toLocaleString('fr-FR')}
                          </div>
                        </div>
                      </button>
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
        <CardTitle className="flex items-center gap-2">
          Détail session
          <SessionStatusBadge status={session.status} />
        </CardTitle>
        <CardDescription>
          {session.label ?? `Session ${session.id.slice(0, 8)}`} · {session.totalLines} lignes
          {session.errorLines > 0 ? ` · ${session.errorLines} en erreur` : ''}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Upload */}
        <section className="space-y-3">
          <h3 className="text-sm font-medium">1. Upload du fichier</h3>
          {canUpload ? (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <Input
                type="file"
                accept=".csv,.xlsx,.xls,.txt"
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
