'use client';

import { useQuery } from '@tanstack/react-query';
import { Loader2, Play } from 'lucide-react';
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
      <div className="space-y-6">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">Workflows de validation</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Pipeline d&apos;approbation multi-niveaux : draft → in_review → approved →
            locked. Cible vague 1 : import_session.
          </p>
        </header>

        <Card>
          <CardHeader>
            <CardTitle>Démarrer une instance</CardTitle>
            <CardDescription>
              Saisir l&apos;UUID d&apos;un import_session (visible dans /imports). L&apos;instance
              démarre au statut <code>draft</code>.
            </CardDescription>
          </CardHeader>
          <CardContent>
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
              <Button type="submit" disabled={start.isPending || targetId.trim() === ''}>
                {start.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Play className="mr-2 h-4 w-4" />
                )}
                Démarrer
              </Button>
            </form>
            <FormError error={start.error} className="mt-2" />
          </CardContent>
        </Card>

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

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              Instance {instanceId.slice(0, 8)}…
              {current && (
                <Badge
                  variant={
                    current.toStatus === 'locked'
                      ? 'destructive'
                      : current.toStatus === 'approved'
                        ? 'default'
                        : 'muted'
                  }
                >
                  {current.toStatus}
                </Badge>
              )}
            </CardTitle>
            <CardDescription>Polling histoire toutes les 5 s.</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={onClosed}>
            Fermer
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
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
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
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
          <Button type="submit" disabled={transition.isPending}>
            {transition.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : null}
            Transitionner
          </Button>
        </form>
        <FormError error={transition.error} />

        <div>
          <h3 className="mb-2 text-sm font-medium">Historique</h3>
          {historyQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Chargement…</p>
          ) : (historyQuery.data?.history ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucune transition.</p>
          ) : (
            <ol className="space-y-2 border-l-2 border-muted pl-3">
              {(historyQuery.data?.history ?? []).map((h) => (
                <li key={h.id} className="text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    {h.fromStatus && (
                      <span className="text-xs text-muted-foreground">{h.fromStatus} →</span>
                    )}
                    <Badge variant="outline">{h.toStatus}</Badge>
                    <span className="text-xs text-muted-foreground">
                      {new Date(h.createdAt).toLocaleString('fr-FR')} · user{' '}
                      {h.actorUserId.slice(0, 8)}
                    </span>
                  </div>
                  {h.comment && <div className="mt-0.5 text-xs">{h.comment}</div>}
                </li>
              ))}
            </ol>
          )}
          <FormError error={historyQuery.error} className="mt-2" />
        </div>
      </CardContent>
    </Card>
  );
}
