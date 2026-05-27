'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, CheckCircle2, History, Loader2, PenLine, Send, ShieldCheck, X } from 'lucide-react';
import { useState } from 'react';

import { AppShell } from '@/components/app-shell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FormError } from '@/components/ui/form-error';
import { Input } from '@/components/ui/input';
import { useApiMutation } from '@/hooks/use-api-mutation';
import { ApiError, api } from '@/lib/api-client';
import { useCurrentOrg } from '@/stores/auth-store';
import type { EntryView } from '@/types/journals';

/* ─── Types ──────────────────────────────────────────────────── */

type WorkflowStatus = 'draft' | 'in_review' | 'approved' | 'locked';
type SignerRole = 'chef_mission' | 'expert_comptable';

interface WorkflowInstance {
  readonly id: string;
  readonly currentStatus: WorkflowStatus;
  readonly startedAt: string;
  readonly completedAt: string | null;
}

interface WorkflowEvent {
  readonly id: string;
  readonly fromStatus: WorkflowStatus | null;
  readonly toStatus: WorkflowStatus;
  readonly actorId: string | null;
  readonly comment: string | null;
  readonly occurredAt: string;
}

interface SignatureView {
  readonly id: string;
  readonly signerId: string;
  readonly signerRole: SignerRole;
  readonly signatureHash: string;
  readonly comment: string | null;
  readonly signedAt: string;
}

interface HistoryView {
  readonly entryId: string;
  readonly entryStatus: string;
  readonly workflow: WorkflowInstance | null;
  readonly events: ReadonlyArray<WorkflowEvent>;
  readonly signatures: ReadonlyArray<SignatureView>;
}

/* ─── Constants ──────────────────────────────────────────────── */

const STATUS_LABEL: Record<WorkflowStatus, string> = {
  draft: 'Brouillon',
  in_review: 'En revue',
  approved: 'Approuvée',
  locked: 'Verrouillée',
};

/* Token-aligned status classes (no hardcoded Tailwind colors) */
const STATUS_CLASS: Record<WorkflowStatus, string> = {
  draft: 'bg-sunk text-ink-mute',
  in_review: 'bg-info-soft text-info-ink',
  approved: 'bg-warn-soft text-warn-ink',
  locked: 'bg-accent-soft text-accent-ink',
};

/* ─── Page ───────────────────────────────────────────────────── */

export default function EntryWorkflowPage() {
  const currentOrg = useCurrentOrg();
  const orgId = currentOrg?.id ?? '';
  const [activeEntryId, setActiveEntryId] = useState<string | null>(null);

  const entriesQuery = useQuery<ReadonlyArray<EntryView>, ApiError>({
    queryKey: ['entries-draft', orgId],
    queryFn: async () => {
      const data = await api.get<{ entries: ReadonlyArray<EntryView>; total: number }>(
        `/organizations/${orgId}/entries?status=draft&pageSize=100`,
      );
      return data.entries;
    },
    enabled: orgId !== '',
  });

  return (
    <AppShell>
      <div className="mx-auto max-w-[1200px] animate-page-in space-y-10">
        {/* ─── Header ─────────────────────────────────────── */}
        <header>
          <p className="eyebrow mb-2">Validation</p>
          <h1 className="font-display text-4xl font-medium tracking-tight text-ink">
            Workflow d'approbation
          </h1>
          <p className="mt-3 max-w-[64ch] text-sm leading-relaxed text-ink-soft">
            Cycle d'approbation des écritures : brouillon → revue → approbation chef de
            mission → signature expert-comptable (verrouillage définitif).
          </p>
        </header>

        {/* ─── Two-panel layout ────────────────────────────── */}
        <div className="grid gap-6 md:grid-cols-[2fr_3fr]">
          {/* Left — Draft entry list */}
          <div className="rounded-sm border border-line bg-paper">
            <div className="border-b border-line px-4 py-3">
              <p className="eyebrow mb-0.5">Écritures brouillon</p>
              <p className="text-xs text-ink-mute">
                {entriesQuery.data?.length ?? 0} écriture
                {(entriesQuery.data?.length ?? 0) !== 1 ? 's' : ''} à traiter
              </p>
            </div>
            <div className="max-h-[560px] overflow-y-auto divide-y divide-line">
              {entriesQuery.isLoading ? (
                <div className="flex items-center gap-2 px-4 py-6 text-sm text-ink-mute">
                  <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.5} />
                  Chargement…
                </div>
              ) : (entriesQuery.data?.length ?? 0) === 0 ? (
                <div className="px-4 py-10 text-center text-sm text-ink-mute">
                  Aucune écriture en brouillon.
                </div>
              ) : (
                entriesQuery.data?.map((e) => (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => setActiveEntryId(e.id)}
                    className={`press w-full px-4 py-3 text-left transition-colors duration-fast hover:bg-sunk/50 ${
                      activeEntryId === e.id ? 'bg-accent-soft' : ''
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 text-sm font-medium text-ink">
                          <span className="font-mono text-xs text-ink-soft">
                            {e.journalCode}/{e.entryNumber}
                          </span>
                          <span className="truncate">{e.description}</span>
                        </div>
                        <div className="mt-0.5 font-mono text-xs text-ink-mute">
                          {e.entryDate}
                        </div>
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Right — Workflow detail */}
          {activeEntryId ? (
            <EntryWorkflowDetail orgId={orgId} entryId={activeEntryId} />
          ) : (
            <div className="flex flex-col items-center justify-center rounded-sm border border-line bg-paper py-16 text-center">
              <History
                className="h-10 w-10 text-ink-mute opacity-20"
                strokeWidth={1}
              />
              <p className="mt-3 text-sm text-ink-mute">
                Sélectionnez une écriture pour voir son workflow.
              </p>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}

/* ─── Workflow detail panel ──────────────────────────────────── */

function EntryWorkflowDetail({ orgId, entryId }: { orgId: string; entryId: string }) {
  const qc = useQueryClient();
  const [comment, setComment] = useState('');
  const [reason, setReason] = useState('');

  const histQuery = useQuery<HistoryView, ApiError>({
    queryKey: ['entry-workflow', entryId],
    queryFn: async () => {
      const data = await api.get<{ status: HistoryView }>(
        `/organizations/${orgId}/entries/${entryId}/history`,
      );
      return data.status;
    },
  });

  const submitMut = useApiMutation(async () =>
    api.post(`/organizations/${orgId}/entries/${entryId}/submit-for-review`, { comment }),
  );
  const approveMut = useApiMutation(async () =>
    api.post(`/organizations/${orgId}/entries/${entryId}/approve`, { comment }),
  );
  const rejectMut = useApiMutation(async () =>
    api.post(`/organizations/${orgId}/entries/${entryId}/reject`, { reason }),
  );
  const signMut = useApiMutation(async () =>
    api.post(`/organizations/${orgId}/entries/${entryId}/sign`, { comment }),
  );

  function invalidate(): void {
    void qc.invalidateQueries({ queryKey: ['entry-workflow', entryId] });
    void qc.invalidateQueries({ queryKey: ['entries-draft'] });
  }

  if (histQuery.isLoading) {
    return (
      <div className="flex items-center justify-center rounded-sm border border-line bg-paper py-16">
        <Loader2 className="h-5 w-5 animate-spin text-ink-mute" strokeWidth={1.5} />
      </div>
    );
  }
  if (!histQuery.data) return null;

  const { workflow, events, signatures, entryStatus } = histQuery.data;
  const wfStatus = workflow?.currentStatus;

  return (
    <div className="space-y-6 rounded-sm border border-line bg-paper p-5">
      {/* Detail header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
        <p className="eyebrow">Détail du workflow</p>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">
            Écriture : {entryStatus}
          </Badge>
          {wfStatus && (
            <span
              className={`inline-block rounded-xs px-2 py-0.5 text-[11px] font-medium ${STATUS_CLASS[wfStatus]}`}
            >
              WF : {STATUS_LABEL[wfStatus]}
            </span>
          )}
        </div>
      </div>

      {/* Action boxes */}
      <div className="space-y-3">
        {wfStatus === undefined && (
          <ActionBox
            icon={<Send className="h-4 w-4" strokeWidth={1.5} />}
            title="Soumettre pour revue (chef de mission)"
          >
            <Input
              placeholder="Commentaire (optionnel)"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
            {submitMut.isError && <FormError error={submitMut.error} />}
            <Button
              className="press"
              onClick={() => void submitMut.mutateAsync(undefined).then(invalidate)}
              disabled={submitMut.isPending}
            >
              {submitMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Soumettre
            </Button>
          </ActionBox>
        )}

        {wfStatus === 'in_review' && (
          <>
            <ActionBox
              icon={<CheckCircle2 className="h-4 w-4" strokeWidth={1.5} />}
              title="Approuver (chef de mission)"
              tone="accent"
            >
              <Input
                placeholder="Commentaire (optionnel)"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
              />
              {approveMut.isError && <FormError error={approveMut.error} />}
              <Button
                className="press"
                onClick={() => void approveMut.mutateAsync(undefined).then(invalidate)}
                disabled={approveMut.isPending}
              >
                {approveMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Approuver
              </Button>
            </ActionBox>
            <ActionBox
              icon={<X className="h-4 w-4" strokeWidth={1.5} />}
              title="Rejeter — retour en brouillon"
              tone="critical"
            >
              <Input
                placeholder="Motif obligatoire"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
              {rejectMut.isError && <FormError error={rejectMut.error} />}
              <Button
                variant="outline"
                className="press"
                onClick={() => void rejectMut.mutateAsync(undefined).then(invalidate)}
                disabled={rejectMut.isPending || reason.trim().length < 3}
              >
                {rejectMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Rejeter
              </Button>
            </ActionBox>
          </>
        )}

        {wfStatus === 'approved' && (
          <>
            <ActionBox
              icon={<ShieldCheck className="h-4 w-4" strokeWidth={1.5} />}
              title="Signature finale (expert-comptable) + verrouillage"
              tone="accent"
            >
              <Input
                placeholder="Commentaire (optionnel)"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
              />
              {signMut.isError && <FormError error={signMut.error} />}
              <Button
                className="press"
                onClick={() => void signMut.mutateAsync(undefined).then(invalidate)}
                disabled={signMut.isPending}
              >
                {signMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Signer & verrouiller
              </Button>
            </ActionBox>
            <ActionBox
              icon={<X className="h-4 w-4" strokeWidth={1.5} />}
              title="Retour pour rework (expert-comptable)"
              tone="critical"
            >
              <Input
                placeholder="Motif obligatoire"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
              <Button
                variant="outline"
                className="press"
                onClick={() => void rejectMut.mutateAsync(undefined).then(invalidate)}
                disabled={rejectMut.isPending || reason.trim().length < 3}
              >
                {rejectMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Renvoyer
              </Button>
            </ActionBox>
          </>
        )}

        {wfStatus === 'locked' && (
          <div className="flex items-start gap-3 rounded-sm bg-accent-soft px-4 py-3 text-sm text-accent-ink">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.5} />
            <span>
              Écriture définitivement verrouillée et validée. Toute modification passe
              désormais par contre-passation.
            </span>
          </div>
        )}
      </div>

      {/* Signatures */}
      <div className="space-y-3 border-t border-line pt-5">
        <p className="eyebrow">Signatures ({signatures.length})</p>
        {signatures.length === 0 ? (
          <p className="text-xs text-ink-mute">Aucune signature.</p>
        ) : (
          <ul className="space-y-2">
            {signatures.map((s) => (
              <li
                key={s.id}
                className="rounded-xs bg-sunk/50 px-3 py-2 font-mono text-xs"
              >
                <div className="flex items-center gap-2 text-ink">
                  <PenLine className="h-3 w-3 shrink-0 text-ink-mute" strokeWidth={1.5} />
                  <span className="font-medium">{s.signerRole}</span>
                  <span className="text-ink-mute">
                    — {new Date(s.signedAt).toLocaleString('fr-FR')}
                  </span>
                </div>
                <div className="mt-1 truncate text-ink-mute">
                  SHA-256 : {s.signatureHash.slice(0, 32)}…
                </div>
                {s.comment && (
                  <div className="mt-1 not-italic text-ink-soft">"{s.comment}"</div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Event timeline */}
      <div className="space-y-3 border-t border-line pt-5">
        <p className="eyebrow">Historique ({events.length})</p>
        <ol className="relative space-y-2">
          {events.length > 0 && (
            <span
              aria-hidden
              className="absolute bottom-[8px] left-[5px] top-[8px] w-px bg-line"
            />
          )}
          {events.map((e) => (
            <li key={e.id} className="relative flex items-center gap-3 pl-5 text-xs">
              <span
                aria-hidden
                className="absolute left-0 top-[7px] h-[11px] w-[11px] rounded-full border-2 border-[oklch(var(--canvas))] bg-line-strong"
              />
              <span className="shrink-0 text-ink-mute">
                {new Date(e.occurredAt).toLocaleString('fr-FR')}
              </span>
              {e.fromStatus && (
                <>
                  <span
                    className={`shrink-0 rounded-xs px-1.5 py-0.5 font-medium ${STATUS_CLASS[e.fromStatus]}`}
                  >
                    {STATUS_LABEL[e.fromStatus]}
                  </span>
                  <ArrowRight className="h-3 w-3 shrink-0 text-ink-mute" strokeWidth={1.5} />
                </>
              )}
              <span
                className={`shrink-0 rounded-xs px-1.5 py-0.5 font-medium ${STATUS_CLASS[e.toStatus]}`}
              >
                {STATUS_LABEL[e.toStatus]}
              </span>
              {e.comment && (
                <span className="min-w-0 truncate italic text-ink-mute">"{e.comment}"</span>
              )}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

/* ─── Action box ─────────────────────────────────────────────── */

function ActionBox({
  icon,
  title,
  tone,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  tone?: 'accent' | 'critical';
  children: React.ReactNode;
}) {
  const borderClass =
    tone === 'accent'
      ? 'border-accent/30 bg-accent-soft/30'
      : tone === 'critical'
        ? 'border-critical/30 bg-critical-soft/30'
        : 'border-line bg-paper';

  return (
    <div className={`space-y-2.5 rounded-sm border p-4 ${borderClass}`}>
      <div className="flex items-center gap-2 text-sm font-medium text-ink">
        <span className="text-ink-mute">{icon}</span>
        {title}
      </div>
      {children}
    </div>
  );
}
