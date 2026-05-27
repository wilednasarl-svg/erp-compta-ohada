'use client';

import { useQuery } from '@tanstack/react-query';
import { Loader2, Play } from 'lucide-react';
import { useState } from 'react';

import { AppShell } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
import { FormError } from '@/components/ui/form-error';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useApiMutation } from '@/hooks/use-api-mutation';
import { ApiError, api } from '@/lib/api-client';
import { useCurrentOrg } from '@/stores/auth-store';

type WorkflowStatus = 'draft' | 'in_review' | 'approved' | 'locked';

interface WorkflowInstance {
  readonly id: string;
  readonly targetType: string;
  readonly targetId: string;
  readonly status: WorkflowStatus;
}
interface HistoryEntry {
  readonly id: string;
  readonly fromStatus: WorkflowStatus | null;
  readonly toStatus: WorkflowStatus;
  readonly comment: string | null;
  readonly actorUserId: string;
  readonly createdAt: string;
}

/**
 * `/workflows` — instances de validation multi-niveaux (Module 6).
 *
 * Surface MVP : démarrer une instance sur un import_session (saisie
 * UUID cible), puis transitionner draft → in_review → approved →
 * locked avec commentaire optionnel. Historique affiché chronologique.
 */
export default function WorkflowsPage() {
  const currentOrg = useCurrentOrg();
  const orgId = currentOrg?.id ?? '';

  // ─── Start ──────────────────────────────────────────────────────────
  const [targetId, setTargetId] = useState('');
  const [startedInstance, setStartedInstance] = useState<WorkflowInstance | null>(null);

  const start = useApiMutation(
    async () => {
      const data = await api.post<{ instance: WorkflowInstance } | WorkflowInstance>(
        `/workflows/start`,
        { targetType: 'import_session', targetId: targetId.trim() },
      );
      const instance =
        'instance' in (data as { instance?: unknown })
          ? (data as { instance: WorkflowInstance }).instance
          : (data as WorkflowInstance);
      setStartedInstance(instance);
      return instance;
    },
  );

  return (
    <AppShell>
      <div className="animate-page-in space-y-8">
        <header>
          <p className="eyebrow mb-2">Validation</p>
          <h1 className="font-display text-4xl font-medium tracking-tight text-ink">
            Workflows de validation
          </h1>
          <p className="mt-2 text-sm text-ink-mute">
            Pipeline d&apos;approbation multi-niveaux : draft → in_review → approved →
            locked. Cible vague 1 : import_session.
          </p>
        </header>

        <section className="space-y-4">
          <div className="border-b border-line pb-3">
            <h2 className="font-display text-xl font-medium text-ink">Démarrer une instance</h2>
            <p className="mt-1 text-sm text-ink-mute">
              Saisir l&apos;UUID d&apos;un import_session (visible dans /imports). L&apos;instance
              démarre au statut <code>draft</code>.
            </p>
          </div>
          <div className="space-y-3">
            <form
              className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_auto] md:items-end"
              onSubmit={(e) => {
                e.preventDefault();
                start.mutate(undefined);
              }}
            >
              <div className="space-y-1">
                <Label htmlFor="target">UUID Import Session</Label>
                <Input
                  id="target"
                  value={targetId}
                  onChange={(e) => setTargetId(e.target.value)}
                  placeholder="00000000-0000-0000-0000-000000000000"
                  required
                />
              </div>
              <Button
                type="submit"
                className="press"
                disabled={start.isPending || targetId.trim() === ''}
              >
                {start.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Play className="mr-2 h-4 w-4" />
                )}
                Démarrer
              </Button>
            </form>
            <FormError error={start.error} className="mt-2" />
          </div>
        </section>

        {startedInstance && (
          <InstancePanel
            orgIdHint={orgId}
            instanceId={startedInstance.id}
            onClosed={() => setStartedInstance(null)}
          />
        )}
      </div>
    </AppShell>
  );
}

function InstancePanel({
  instanceId,
  onClosed,
}: {
  orgIdHint: string;
  instanceId: string;
  onClosed: () => void;
}) {
  const historyQuery = useQuery<{ history: ReadonlyArray<HistoryEntry> }, ApiError>({
    queryKey: ['workflow-history', instanceId],
    queryFn: async () => api.get(`/workflows/${instanceId}/history`),
    refetchInterval: 5000,
  });

  const [toStatus, setToStatus] = useState<WorkflowStatus>('in_review');
  const [comment, setComment] = useState('');

  const transition = useApiMutation(
    async () =>
      api.post(`/workflows/${instanceId}/transition`, {
        toStatus,
        comment: comment.trim() === '' ? null : comment.trim(),
      }),
    {
      onSuccess: () => {
        setComment('');
        void historyQuery.refetch();
      },
    },
  );

  const current = historyQuery.data?.history?.at(-1);

  const statusBadgeClass =
    current?.toStatus === 'locked'
      ? 'bg-critical-soft text-critical-ink'
      : current?.toStatus === 'approved'
        ? 'bg-accent-soft text-accent-ink'
        : 'bg-sunk text-ink-mute';

  return (
    <section className="space-y-4">
      <div className="border-b border-line pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 font-display text-xl font-medium text-ink">
              Instance {instanceId.slice(0, 8)}…
              {current && (
                <span
                  className={`inline-block rounded-xs px-2 py-0.5 font-mono text-[11px] ${statusBadgeClass}`}
                >
                  {current.toStatus}
                </span>
              )}
            </h2>
            <p className="mt-1 text-sm text-ink-mute">Polling histoire toutes les 5 s.</p>
          </div>
          <Button variant="outline" size="sm" className="press" onClick={onClosed}>
            Fermer
          </Button>
        </div>
      </div>
      <div className="space-y-4">
        <form
          className="grid grid-cols-1 gap-3 md:grid-cols-[200px_1fr_auto] md:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            transition.mutate(undefined);
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="to">Transition vers</Label>
            <select
              id="to"
              value={toStatus}
              onChange={(e) => setToStatus(e.target.value as WorkflowStatus)}
              className="flex h-9 w-full rounded-sm border border-line-strong bg-paper px-3 py-1 text-sm text-ink transition-colors focus:border-accent focus:outline-none"
            >
              <option value="draft">draft</option>
              <option value="in_review">in_review</option>
              <option value="approved">approved</option>
              <option value="locked">locked</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="cmt">Commentaire (optionnel)</Label>
            <Input id="cmt" value={comment} onChange={(e) => setComment(e.target.value)} />
          </div>
          <Button type="submit" className="press" disabled={transition.isPending}>
            {transition.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Transitionner
          </Button>
        </form>
        <FormError error={transition.error} />

        <div>
          <h3 className="mb-2 text-sm font-medium text-ink">Historique</h3>
          {historyQuery.isLoading ? (
            <p className="text-sm text-ink-mute">Chargement…</p>
          ) : (historyQuery.data?.history ?? []).length === 0 ? (
            <p className="text-sm text-ink-mute">Aucune transition.</p>
          ) : (
            <ol className="space-y-2 border-l border-line pl-3">
              {(historyQuery.data?.history ?? []).map((h) => (
                <li key={h.id} className="text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    {h.fromStatus && (
                      <span className="text-xs text-ink-mute">{h.fromStatus} →</span>
                    )}
                    <span className="inline-block rounded-xs bg-sunk px-2 py-0.5 font-mono text-[11px] text-ink-mute">
                      {h.toStatus}
                    </span>
                    <span className="text-xs text-ink-mute">
                      {new Date(h.createdAt).toLocaleString('fr-FR')} · user{' '}
                      {h.actorUserId.slice(0, 8)}
                    </span>
                  </div>
                  {h.comment && <div className="mt-0.5 text-xs text-ink">{h.comment}</div>}
                </li>
              ))}
            </ol>
          )}
          <FormError error={historyQuery.error} className="mt-2" />
        </div>
      </div>
    </section>
  );
}
