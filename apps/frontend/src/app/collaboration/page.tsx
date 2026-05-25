'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, MessageSquare, Plus, Send } from 'lucide-react';
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

const STATUS_COLOR: Record<CollaborationStatus, string> = {
  open: 'bg-blue-100 text-blue-900',
  in_progress: 'bg-amber-100 text-amber-900',
  completed: 'bg-emerald-100 text-emerald-900',
  cancelled: 'bg-slate-200 text-slate-700',
};

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
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Collaboration</h1>
            <p className="text-sm text-muted-foreground">
              Demandes de justificatifs et échanges cabinet ↔ client.
            </p>
          </div>
          <Button onClick={() => setCreating((c) => !c)}>
            {creating ? 'Annuler' : <><Plus className="mr-2 h-4 w-4" /> Nouvelle demande</>}
          </Button>
        </div>

        {creating && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Nouvelle demande</CardTitle>
              <CardDescription>
                Le client recevra cette demande dans son fil collaboration.
              </CardDescription>
            </CardHeader>
            <CardContent>
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
                    className="w-full min-h-[80px] rounded-md border bg-background px-3 py-2 text-sm"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </div>
                {createMut.isError && <FormError error={createMut.error} />}
                <Button type="submit" disabled={createMut.isPending || title.trim().length === 0}>
                  {createMut.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Créer la demande
                </Button>
              </form>
            </CardContent>
          </Card>
        )}

        <div className="grid gap-4 md:grid-cols-[2fr_3fr]">
          <div className="space-y-2">
            {listQuery.isLoading ? (
              <Card><CardContent className="py-8 text-center text-muted-foreground"><Loader2 className="inline h-4 w-4 animate-spin" /></CardContent></Card>
            ) : listQuery.data?.length === 0 ? (
              <Card><CardContent className="py-8 text-center text-muted-foreground">Aucune demande pour le moment.</CardContent></Card>
            ) : (
              listQuery.data?.map((req) => (
                <button
                  key={req.id}
                  onClick={() => setActiveId(req.id)}
                  className={`w-full text-left p-3 rounded-md border transition-colors hover:bg-accent ${activeId === req.id ? 'border-primary bg-accent' : ''}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium text-sm truncate">{req.title}</div>
                      <div className="text-xs text-muted-foreground">{new Date(req.createdAt).toLocaleDateString('fr-FR')}</div>
                    </div>
                    <Badge className={STATUS_COLOR[req.status]}>{STATUS_LABEL[req.status]}</Badge>
                  </div>
                </button>
              ))
            )}
          </div>

          <div>
            {activeId ? (
              <RequestDetail requestId={activeId} />
            ) : (
              <Card><CardContent className="py-12 text-center text-muted-foreground">
                <MessageSquare className="inline h-8 w-8 mb-2 opacity-50" />
                <div className="text-sm">Sélectionnez une demande pour voir le fil.</div>
              </CardContent></Card>
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

  if (reqQuery.isLoading) return <Card><CardContent className="py-8 text-center"><Loader2 className="inline h-4 w-4 animate-spin" /></CardContent></Card>;
  if (!reqQuery.data) return null;

  const req = reqQuery.data;
  const transitions: ReadonlyArray<CollaborationStatus> = {
    open: ['in_progress', 'cancelled'] as ReadonlyArray<CollaborationStatus>,
    in_progress: ['completed', 'open', 'cancelled'] as ReadonlyArray<CollaborationStatus>,
    completed: ['in_progress'] as ReadonlyArray<CollaborationStatus>,
    cancelled: [] as ReadonlyArray<CollaborationStatus>,
  }[req.status];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="text-base">{req.title}</CardTitle>
            <CardDescription>Créée {new Date(req.createdAt).toLocaleDateString('fr-FR')}</CardDescription>
          </div>
          <Badge className={STATUS_COLOR[req.status]}>{STATUS_LABEL[req.status]}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {req.description && (
          <div className="text-sm whitespace-pre-wrap text-muted-foreground border-l-2 pl-3">
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
              >
                → {STATUS_LABEL[s]}
              </Button>
            ))}
          </div>
        )}

        <div className="space-y-2">
          <div className="text-sm font-medium">Commentaires</div>
          {commentsQuery.data?.length === 0 ? (
            <div className="text-sm text-muted-foreground">Aucun commentaire.</div>
          ) : (
            commentsQuery.data?.map((c) => (
              <div key={c.id} className="text-sm border rounded-md p-2">
                <div className="text-xs text-muted-foreground">{new Date(c.createdAt).toLocaleString('fr-FR')}</div>
                <div className="whitespace-pre-wrap">{c.body}</div>
              </div>
            ))
          )}
        </div>

        <form onSubmit={handleComment} className="flex gap-2">
          <Input
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Ajouter un commentaire..."
          />
          <Button type="submit" size="sm" disabled={commentMut.isPending || body.trim().length === 0}>
            {commentMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
