'use client';

import { useQuery } from '@tanstack/react-query';
import {
  CheckCircle2,
  Clock,
  FileText,
  GitBranch,
  Loader2,
  Lock,
  Play,
  X,
} from 'lucide-react';
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

/* ─── Status meta ─────────────────────────────────────────────────── */

const STATUS_LABEL: Record<WorkflowStatus, string> = {
  draft: 'Brouillon',
  in_review: 'En revue',
  approved: 'Approuvé',
  locked: 'Verrouillé',
};

const STATUS_ICON: Record<WorkflowStatus, React.ComponentType<{ className?: string; strokeWidth?: number }>> = {
  draft: FileText,
  in_review: Clock,
  approved: CheckCircle2,
  locked: Lock,
};

function statusChip(status: WorkflowStatus): string {
  if (status === 'locked') return 'bg-critical-soft text-critical-ink';
  if (status === 'approved') return 'bg-accent-soft text-accent-ink';
  if (status === 'in_review') return 'bg-warn-soft text-warn-ink';
  return 'bg-sunk text-ink-soft';
}

function statusDot(status: WorkflowStatus): string {
  if (status === 'locked') return 'bg-critical';
  if (status === 'approved') return 'bg-accent';
  if (status === 'in_review') return 'bg-warn';
  return 'bg-line-strong';
}

/* ─── Reusable bits ───────────────────────────────────────────────── */

function EmptyState({
  icon: Icon,
  title,
  description,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  title: string;
  description: string;
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
    </div>
  );
}

function SkeletonRows({ n = 3 }: { n?: number }) {
  return (
    <div className="animate-pulse divide-y divide-line">
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-4">
          <div className="h-2 w-2 rounded-full bg-sunk" />
          <div className="h-3 w-32 rounded-xs bg-sunk" />
          <div className="h-3 flex-1 rounded-xs bg-sunk" />
          <div className="h-5 w-20 rounded-full bg-sunk" />
        </div>
      ))}
    </div>
  );
}

/* ─── Stage pipeline ──────────────────────────────────────────────── */

const STAGES: ReadonlyArray<WorkflowStatus> = ['draft', 'in_review', 'approved', 'locked'];

function StagePipeline({ current }: { current: WorkflowStatus }) {
  const currentIdx = STAGES.indexOf(current);
  return (
    <ol className="flex flex-wrap items-center gap-1.5 text-xs">
      {STAGES.map((s, idx) => {
        const Icon = STATUS_ICON[s];
        const done = idx <= currentIdx;
        const active = idx === currentIdx;
        return (
          <li key={s} className="flex items-center gap-1.5">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium transition-colors duration-fast ${
                active
                  ? statusChip(s)
                  : done
                    ? 'bg-sunk text-ink-soft'
                    : 'border border-dashed border-line bg-paper text-ink-mute'
              }`}
            >
              <Icon className="h-3 w-3" strokeWidth={1.75} />
              {STATUS_LABEL[s]}
            </span>
            {idx < STAGES.length - 1 && (
              <span
                className={`h-px w-4 ${idx < currentIdx ? 'bg-line-strong' : 'bg-line'}`}
                aria-hidden
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

/* ─── Page ────────────────────────────────────────────────────────── */

export default function WorkflowsPage() {
  const currentOrg = useCurrentOrg();
  const orgId = currentOrg?.id ?? '';

  const [targetId, setTargetId] = useState('');
  const [startedInstance, setStartedInstance] = useState<WorkflowInstance | null>(null);

  const start = useApiMutation(async () => {
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
  });

  return (
    <AppShell>
      <div className="mx-auto max-w-[960px] animate-page-in space-y-10">
        {/* ─── Header ─────────────────────────────────────── */}
        <header>
          <p className="eyebrow mb-2">Analyse &amp; IA · Workflows</p>
          <h1 className="font-display text-4xl font-medium tracking-tight text-ink">
            Workflows automatisés
          </h1>
          <p className="mt-3 max-w-[64ch] text-sm leading-relaxed text-ink-soft">
            Séquences d&apos;actions déclenchées automatiquement sur événements
            comptables. Pipeline d&apos;approbation multi-niveaux : brouillon → revue →
            approuvé → verrouillé.
          </p>
        </header>

        {/* ─── Start instance ─────────────────────────────── */}
        <section className="rounded-sm border border-line bg-paper">
          <div className="flex items-start gap-3 border-b border-line px-5 py-4">
            <span className="mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-sm bg-sunk">
              <Play className="h-4 w-4 text-ink" strokeWidth={1.75} />
            </span>
            <div>
              <h2 className="font-display text-xl font-medium text-ink">
                Démarrer une instance
              </h2>
              <p className="mt-1 text-xs text-ink-mute">
                Saisir l&apos;UUID d&apos;un <code className="font-mono text-[11px] text-ink-soft">import_session</code>{' '}
                (visible dans /imports). L&apos;instance démarre au statut{' '}
                <span className="inline-flex items-center rounded-full bg-sunk px-2 py-0.5 font-mono text-[11px] text-ink-soft">
                  brouillon
                </span>
                .
              </p>
            </div>
          </div>
          <div className="space-y-3 px-5 py-5">
            <form
              className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_auto] md:items-end"
              onSubmit={(e) => {
                e.preventDefault();
                start.mutate(undefined);
              }}
            >
              <div className="space-y-1.5">
                <Label htmlFor="target">UUID Import Session</Label>
                <Input
                  id="target"
                  value={targetId}
                  onChange={(e) => setTargetId(e.target.value)}
                  placeholder="00000000-0000-0000-0000-000000000000"
                  className="font-mono text-xs"
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
            <FormError error={start.error} />
          </div>
        </section>

        {/* ─── Instance panel or empty ────────────────────── */}
        {startedInstance ? (
          <InstancePanel
            orgIdHint={orgId}
            instance={startedInstance}
            onClosed={() => setStartedInstance(null)}
          />
        ) : (
          <section className="rounded-sm border border-dashed border-line bg-paper">
            <EmptyState
              icon={GitBranch}
              title="Aucun workflow configuré"
              description="Automatisez les tâches récurrentes en démarrant une instance ci-dessus."
            />
          </section>
        )}
      </div>
    </AppShell>
  );
}

/* ─── InstancePanel ───────────────────────────────────────────────── */

function InstancePanel({
  instance,
  onClosed,
}: {
  orgIdHint: string;
  instance: WorkflowInstance;
  onClosed: () => void;
}) {
  const instanceId = instance.id;

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

  const historyList = historyQuery.data?.history ?? [];
  const last = historyList.at(-1);
  const currentStatus: WorkflowStatus = last?.toStatus ?? instance.status;
  const CurrentIcon = STATUS_ICON[currentStatus];

  return (
    <section className="rounded-sm border border-line bg-paper">
      {/* Header */}
      <div className="border-b border-line px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span
              className={`mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-sm ${statusChip(currentStatus)}`}
            >
              <CurrentIcon className="h-4 w-4" strokeWidth={1.75} />
            </span>
            <div className="min-w-0">
              <p className="eyebrow mb-1">Instance</p>
              <h2 className="font-display text-xl font-medium text-ink">
                <span className="font-mono text-base text-ink-soft">
                  {instanceId.slice(0, 8)}…{instanceId.slice(-4)}
                </span>
              </h2>
              <p className="mt-1 flex items-center gap-2 text-xs text-ink-mute">
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-medium ${statusChip(currentStatus)}`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${statusDot(currentStatus)}`} />
                  {STATUS_LABEL[currentStatus]}
                </span>
                <span>·</span>
                <span>Cible : {instance.targetType}</span>
                <span>·</span>
                <span>Polling 5 s</span>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClosed}
            className="press inline-flex items-center gap-1 rounded-sm border border-line bg-paper px-2.5 py-1 text-xs text-ink-soft transition-colors duration-fast hover:border-line-strong hover:text-ink"
            aria-label="Fermer l'instance"
          >
            <X className="h-3.5 w-3.5" strokeWidth={1.75} />
            Fermer
          </button>
        </div>

        {/* Pipeline stages */}
        <div className="mt-4">
          <StagePipeline current={currentStatus} />
        </div>
      </div>

      {/* Transition form */}
      <div className="border-b border-line px-5 py-5">
        <form
          className="grid grid-cols-1 gap-3 md:grid-cols-[200px_1fr_auto] md:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            transition.mutate(undefined);
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="to">Transition vers</Label>
            <select
              id="to"
              value={toStatus}
              onChange={(e) => setToStatus(e.target.value as WorkflowStatus)}
              className="flex h-9 w-full rounded-sm border border-line-strong bg-paper px-3 py-1 text-sm text-ink transition-colors duration-fast focus:border-accent focus:outline-none"
            >
              {STAGES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cmt">Commentaire (optionnel)</Label>
            <Input
              id="cmt"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Motif de la transition…"
            />
          </div>
          <Button type="submit" className="press" disabled={transition.isPending}>
            {transition.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <GitBranch className="mr-2 h-4 w-4" />
            )}
            Transitionner
          </Button>
        </form>
        <FormError error={transition.error} className="mt-3" />
      </div>

      {/* History */}
      <div className="px-5 py-5">
        <div className="mb-3 flex items-baseline justify-between">
          <h3 className="font-display text-sm font-medium text-ink">Historique</h3>
          <span className="font-mono text-[11px] uppercase tracking-wider text-ink-mute">
            {historyList.length} transition{historyList.length > 1 ? 's' : ''}
          </span>
        </div>

        {historyQuery.isLoading ? (
          <SkeletonRows n={3} />
        ) : historyList.length === 0 ? (
          <EmptyState
            icon={Clock}
            title="Aucune transition"
            description="L'historique apparaîtra dès la première transition d'état."
          />
        ) : (
          <ol className="relative space-y-3 pl-6">
            <span
              className="absolute left-[7px] top-1 h-[calc(100%-0.5rem)] w-px bg-line"
              aria-hidden
            />
            {historyList.map((h) => {
              const Icon = STATUS_ICON[h.toStatus];
              return (
                <li key={h.id} className="relative">
                  <span
                    className={`absolute -left-6 top-1 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full ring-2 ring-paper ${statusDot(h.toStatus)}`}
                    aria-hidden
                  />
                  <div className="space-y-1 rounded-sm border border-line bg-sunk/30 px-3 py-2.5">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      {h.fromStatus && (
                        <>
                          <span className="inline-flex items-center gap-1 rounded-full bg-paper px-2 py-0.5 font-medium text-ink-mute">
                            {STATUS_LABEL[h.fromStatus]}
                          </span>
                          <span className="text-ink-mute">→</span>
                        </>
                      )}
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ${statusChip(h.toStatus)}`}
                      >
                        <Icon className="h-3 w-3" strokeWidth={1.75} />
                        {STATUS_LABEL[h.toStatus]}
                      </span>
                      <span className="ml-auto font-mono tabular-nums text-ink-mute">
                        {new Date(h.createdAt).toLocaleString('fr-FR')}
                      </span>
                    </div>
                    <p className="font-mono text-[11px] text-ink-mute">
                      user {h.actorUserId.slice(0, 8)}
                    </p>
                    {h.comment && (
                      <p className="mt-1 border-l-2 border-line-strong pl-2 text-xs text-ink-soft">
                        {h.comment}
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
        <FormError error={historyQuery.error} className="mt-2" />
      </div>
    </section>
  );
}
