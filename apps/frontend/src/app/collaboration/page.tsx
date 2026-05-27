'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Handshake, Loader2, MessageSquare, Plus, Send } from 'lucide-react';
import { useState } from 'react';

import { AppShell } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
import { FormError } from '@/components/ui/form-error';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useApiMutation } from '@/hooks/use-api-mutation';
import { ApiError, api } from '@/lib/api-client';
import { useCurrentOrg } from '@/stores/auth-store';

type CollaborationStatus = 'open' | 'in_progress' | 'completed' | 'cancelled';

interface RequestView {
  readonly id: string;
  readonly organizationId: string;
  readonly requesterId: string;
  readonly assigneeId: string | null;
  readonly status: CollaborationStatus;
  readonly title: string;
  readonly description: string | null;
  readonly dueAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly linkedEntryId: string | null;
  readonly linkedDocumentId: string | null;
}

interface CommentView {
  readonly id: string;
  readonly requestId: string;
  readonly authorId: string;
  readonly body: string;
  readonly createdAt: string;
}

interface ListResponse {
  readonly rows: ReadonlyArray<RequestView>;
  readonly total: number;
}

const STATUS_LABEL: Record<CollaborationStatus, string> = {
  open: 'Ouverte',
  in_progress: 'En cours',
  completed: 'Résolue',
  cancelled: 'Annulée',
};

const STATUS_TONE: Record<CollaborationStatus, string> = {
  open: 'bg-info-soft text-info-ink',
  in_progress: 'bg-warn-soft text-warn-ink',
  completed: 'bg-accent-soft text-accent-ink',
  cancelled: 'bg-sunk text-ink-mute',
};

const TEXTAREA_CLS =
  'w-full min-h-[80px] rounded-sm border border-line-strong bg-paper px-3 py-2 text-sm text-ink transition-colors focus:border-accent focus:outline-none';

function Avatar({ name, email, size = 'md' }: { name?: string; email?: string; size?: 'sm' | 'md' }) {
  const initials = (name ?? email ?? '?')
    .split(/[ @.]/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? '')
    .join('');
  const sz = size === 'sm' ? 'h-7 w-7 text-2xs' : 'h-8 w-8 text-xs';
  return (
    <span className={`inline-flex items-center justify-center rounded-full bg-accent-soft font-medium uppercase tracking-wider text-accent-ink ${sz}`}>
      {initials || '?'}
    </span>
  );
}

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
        <p className="mt-1 max-w-[40ch] text-xs text-ink-mute">{description}</p>
      </div>
    </div>
  );
}

function SkeletonRows({ n = 4 }: { n?: number }) {
  return (
    <div className="animate-pulse divide-y divide-line">
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3">
          <div className="h-8 w-8 rounded-full bg-sunk" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3 w-32 rounded-xs bg-sunk" />
            <div className="h-2.5 w-48 rounded-xs bg-sunk" />
          </div>
          <div className="h-5 w-16 rounded-full bg-sunk" />
        </div>
      ))}
    </div>
  );
}

export default function CollaborationPage() {
  const currentOrg = useCurrentOrg();
  const qc = useQueryClient();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');

  const listQuery = useQuery<ReadonlyArray<RequestView>, ApiError>({
    queryKey: ['collaboration-requests'],
    queryFn: async () => {
      const data = await api.get<ListResponse>('/collaboration/requests?pageSize=100');
      return data.rows;
    },
    enabled: currentOrg !== null,
  });

  const createMut = useApiMutation(async (input: { title: string; description: string }) => {
    return api.post<{ request: RequestView }>('/collaboration/requests', {
      title: input.title,
      description: input.description.length > 0 ? input.description : undefined,
    });
  });

  async function handleCreate(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (title.trim().length === 0) return;
    await createMut.mutateAsync({ title, description });
    setTitle('');
    setDescription('');
    setCreating(false);
    void qc.invalidateQueries({ queryKey: ['collaboration-requests'] });
  }

  return (
    <AppShell>
      <div className="animate-page-in space-y-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="eyebrow mb-2">Organisation · Collaboration</p>
            <h1 className="font-display text-4xl font-medium tracking-tight text-ink">Collaboration</h1>
            <p className="mt-2 max-w-2xl text-sm text-ink-mute">
              Commentaires, tâches partagées et suivi des actions en équipe.
            </p>
          </div>
          <Button onClick={() => setCreating((c) => !c)} className="press">
            {creating ? 'Annuler' : <><Plus className="mr-2 h-4 w-4" /> Nouvelle demande</>}
          </Button>
        </div>

        {creating && (
          <section className="space-y-4">
            <div className="border-b border-line pb-3">
              <h2 className="font-display text-xl font-medium text-ink">Nouvelle demande</h2>
              <p className="mt-1 text-sm text-ink-mute">
                Le client recevra cette demande dans son fil collaboration.
              </p>
            </div>
            <div className="rounded-sm border border-line bg-paper p-5">
              <form onSubmit={handleCreate} className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="req-title">Titre</Label>
                  <Input
                    id="req-title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Ex. Facture EDF Décembre 2026"
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="req-desc">Description (optionnelle)</Label>
                  <textarea
                    id="req-desc"
                    className={TEXTAREA_CLS}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </div>
                {createMut.isError && <FormError error={createMut.error} />}
                <Button type="submit" disabled={createMut.isPending || title.trim().length === 0} className="press">
                  {createMut.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Créer la demande
                </Button>
              </form>
            </div>
          </section>
        )}

        <div className="grid gap-4 md:grid-cols-[2fr_3fr]">
          <div className="rounded-sm border border-line bg-paper">
            {listQuery.isLoading ? (
              <SkeletonRows n={5} />
            ) : listQuery.data?.length === 0 ? (
              <EmptyState
                icon={Handshake}
                title="Aucune activité"
                description="Les commentaires et tâches partagées apparaîtront ici."
              />
            ) : (
              <ul className="divide-y divide-line">
                {listQuery.data?.map((req) => {
                  const isActive = activeId === req.id;
                  return (
                    <li key={req.id}>
                      <button
                        onClick={() => setActiveId(req.id)}
                        className={`press flex w-full items-start gap-3 px-4 py-3 text-left transition-colors duration-fast hover:bg-sunk/50 ${
                          isActive ? 'bg-sunk/40' : ''
                        }`}
                      >
                        <Avatar email={req.requesterId} size="sm" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-sm font-medium text-ink">{req.title}</span>
                          </div>
                          <div className="mt-0.5 text-xs text-ink-mute">
                            {new Date(req.createdAt).toLocaleDateString('fr-FR', {
                              day: '2-digit',
                              month: 'short',
                              year: 'numeric',
                            })}
                          </div>
                        </div>
                        <span
                          className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_TONE[req.status]}`}
                        >
                          {STATUS_LABEL[req.status]}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div>
            {activeId ? (
              <RequestDetail requestId={activeId} />
            ) : (
              <div className="rounded-sm border border-line bg-paper">
                <EmptyState
                  icon={MessageSquare}
                  title="Sélectionnez une demande"
                  description="Choisissez une demande dans la liste pour consulter son fil de discussion."
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function RequestDetail({ requestId }: { requestId: string }) {
  const qc = useQueryClient();
  const [body, setBody] = useState('');

  const reqQuery = useQuery<RequestView, ApiError>({
    queryKey: ['collaboration-request', requestId],
    queryFn: async () => {
      const data = await api.get<{ request: RequestView }>(`/collaboration/requests/${requestId}`);
      return data.request;
    },
  });

  const commentsQuery = useQuery<ReadonlyArray<CommentView>, ApiError>({
    queryKey: ['collaboration-comments', requestId],
    queryFn: async () => {
      const data = await api.get<{ comments: ReadonlyArray<CommentView> }>(`/collaboration/requests/${requestId}/comments`);
      return data.comments;
    },
  });

  const commentMut = useApiMutation(async (b: string) => {
    return api.post(`/collaboration/requests/${requestId}/comments`, { body: b });
  });

  const statusMut = useApiMutation(async (status: CollaborationStatus) => {
    return api.patch(`/collaboration/requests/${requestId}/status`, { status });
  });

  async function handleComment(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (body.trim().length === 0) return;
    await commentMut.mutateAsync(body);
    setBody('');
    void qc.invalidateQueries({ queryKey: ['collaboration-comments', requestId] });
  }

  async function handleStatus(status: CollaborationStatus): Promise<void> {
    await statusMut.mutateAsync(status);
    void qc.invalidateQueries({ queryKey: ['collaboration-request', requestId] });
    void qc.invalidateQueries({ queryKey: ['collaboration-requests'] });
  }

  if (reqQuery.isLoading) {
    return (
      <div className="rounded-sm border border-line bg-paper py-8 text-center text-ink-mute">
        <Loader2 className="inline h-4 w-4 animate-spin" />
      </div>
    );
  }
  if (!reqQuery.data) return null;

  const req = reqQuery.data;
  const transitions: ReadonlyArray<CollaborationStatus> = {
    open: ['in_progress', 'cancelled'] as ReadonlyArray<CollaborationStatus>,
    in_progress: ['completed', 'open', 'cancelled'] as ReadonlyArray<CollaborationStatus>,
    completed: ['in_progress'] as ReadonlyArray<CollaborationStatus>,
    cancelled: [] as ReadonlyArray<CollaborationStatus>,
  }[req.status];

  return (
    <div className="rounded-sm border border-line bg-paper">
      <div className="flex items-start justify-between gap-3 border-b border-line p-5">
        <div className="min-w-0">
          <h2 className="font-display text-xl font-medium text-ink">{req.title}</h2>
          <p className="mt-1 text-xs text-ink-mute">
            Créée le {new Date(req.createdAt).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })}
          </p>
        </div>
        <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_TONE[req.status]}`}>
          {STATUS_LABEL[req.status]}
        </span>
      </div>
      <div className="space-y-5 p-5">
        {req.description && (
          <div className="whitespace-pre-wrap border-l-2 border-accent pl-3 text-sm text-ink-soft">
            {req.description}
          </div>
        )}

        {transitions.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {transitions.map((s) => (
              <Button
                key={s}
                size="sm"
                variant="outline"
                onClick={() => void handleStatus(s)}
                disabled={statusMut.isPending}
                className="press"
              >
                → {STATUS_LABEL[s]}
              </Button>
            ))}
          </div>
        )}

        <div className="space-y-3">
          <div className="eyebrow">Commentaires</div>
          {commentsQuery.data?.length === 0 ? (
            <p className="text-xs text-ink-mute">Aucun commentaire pour le moment.</p>
          ) : (
            <ul className="space-y-3">
              {commentsQuery.data?.map((c) => (
                <li key={c.id} className="flex items-start gap-3">
                  <Avatar email={c.authorId} size="sm" />
                  <div className="min-w-0 flex-1 rounded-sm border border-line bg-sunk/20 p-3">
                    <div className="flex items-baseline gap-2">
                      <span className="text-xs font-medium text-ink">{c.authorId.slice(0, 8)}</span>
                      <span className="text-2xs text-ink-mute" title={new Date(c.createdAt).toLocaleString('fr-FR')}>
                        {new Date(c.createdAt).toLocaleString('fr-FR', {
                          day: '2-digit',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                    <div className="mt-1 whitespace-pre-wrap text-sm text-ink">{c.body}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <form onSubmit={handleComment} className="flex gap-2 border-t border-line pt-4">
          <Input
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Ajouter un commentaire…"
          />
          <Button type="submit" size="sm" disabled={commentMut.isPending || body.trim().length === 0} className="press">
            {commentMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </form>
      </div>
    </div>
  );
}
