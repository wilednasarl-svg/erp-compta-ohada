'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, CheckCircle2, History, Loader2, PenLine, Send, ShieldCheck, X } from 'lucide-react';
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
import { useApiMutation } from '@/hooks/use-api-mutation';
import { ApiError, api } from '@/lib/api-client';
import { useCurrentOrg } from '@/stores/auth-store';
import type { EntryView } from '@/types/journals';

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

const STATUS_LABEL: Record<WorkflowStatus, string> = {
  draft: 'Brouillon',
  in_review: 'En revue',
  approved: 'Approuvée',
  locked: 'Verrouillée',
};

const STATUS_COLOR: Record<WorkflowStatus, string> = {
  draft: 'bg-slate-200 text-slate-700',
  in_review: 'bg-blue-100 text-blue-900',
  approved: 'bg-amber-100 text-amber-900',
  locked: 'bg-emerald-100 text-emerald-900',
};

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
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Workflow d'approbation & signatures</h1>
          <p className="text-sm text-muted-foreground">
            Cycle d'approbation des écritures comptables : brouillon → revue → approbation chef
            de mission → signature finale expert-comptable (verrouillage + validation).
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-[2fr_3fr]">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Écritures brouillon</CardTitle>
              <CardDescription>
                {entriesQuery.data?.length ?? 0} écritures à traiter
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 max-h-[600px] overflow-y-auto">
              {entriesQuery.isLoading ? (
                <Loader2 className="inline h-4 w-4 animate-spin" />
              ) : entriesQuery.data?.length === 0 ? (
                <div className="py-8 text-center text-muted-foreground text-sm">Aucune écriture en brouillon.</div>
              ) : (
                entriesQuery.data?.map((e) => (
                  <button
                    key={e.id}
                    onClick={() => setActiveEntryId(e.id)}
                    className={`w-full text-left p-3 rounded-md border transition-colors hover:bg-accent ${activeEntryId === e.id ? 'border-primary bg-accent' : ''}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-medium text-sm">
                          <Badge variant="outline" className="mr-1">{e.journalCode}/{e.entryNumber}</Badge>
                          <span className="truncate">{e.description}</span>
                        </div>
                        <div className="text-xs text-muted-foreground">{e.entryDate}</div>
                      </div>
                    </div>
                  </button>
                ))
              )}
            </CardContent>
          </Card>

          {activeEntryId ? (
            <EntryWorkflowDetail orgId={orgId} entryId={activeEntryId} />
          ) : (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <History className="mx-auto h-8 w-8 opacity-50 mb-2" />
                <div className="text-sm">Sélectionnez une écriture pour voir son workflow.</div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </AppShell>
  );
}

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

  if (histQuery.isLoading) return <Card><CardContent className="py-8 text-center"><Loader2 className="inline h-4 w-4 animate-spin" /></CardContent></Card>;
  if (!histQuery.data) return null;

  const { workflow, events, signatures, entryStatus } = histQuery.data;
  const wfStatus = workflow?.currentStatus;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base">Détail du workflow</CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="outline">Entry: {entryStatus}</Badge>
            {wfStatus && <Badge className={STATUS_COLOR[wfStatus]}>WF: {STATUS_LABEL[wfStatus]}</Badge>}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {wfStatus === undefined && (
          <ActionBox icon={<Send className="h-4 w-4" />} title="Soumettre pour revue (chef de mission)">
            <Input placeholder="Commentaire (optionnel)" value={comment} onChange={(e) => setComment(e.target.value)} />
            {submitMut.isError && <FormError error={submitMut.error} />}
            <Button onClick={() => submitMut.mutateAsync(undefined).then(invalidate)} disabled={submitMut.isPending}>
              {submitMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Soumettre
            </Button>
          </ActionBox>
        )}

        {wfStatus === 'in_review' && (
          <>
            <ActionBox icon={<CheckCircle2 className="h-4 w-4" />} title="Approuver + signer (chef de mission)">
              <Input placeholder="Commentaire (optionnel)" value={comment} onChange={(e) => setComment(e.target.value)} />
              {approveMut.isError && <FormError error={approveMut.error} />}
              <Button onClick={() => approveMut.mutateAsync(undefined).then(invalidate)} disabled={approveMut.isPending}>
                {approveMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Approuver
              </Button>
            </ActionBox>
            <ActionBox icon={<X className="h-4 w-4" />} title="Rejeter (retour en brouillon)">
              <Input placeholder="Motif obligatoire" value={reason} onChange={(e) => setReason(e.target.value)} />
              {rejectMut.isError && <FormError error={rejectMut.error} />}
              <Button variant="outline" onClick={() => rejectMut.mutateAsync(undefined).then(invalidate)} disabled={rejectMut.isPending || reason.trim().length < 3}>
                {rejectMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Rejeter
              </Button>
            </ActionBox>
          </>
        )}

        {wfStatus === 'approved' && (
          <>
            <ActionBox icon={<ShieldCheck className="h-4 w-4" />} title="Signature finale (expert-comptable) + verrouillage">
              <Input placeholder="Commentaire (optionnel)" value={comment} onChange={(e) => setComment(e.target.value)} />
              {signMut.isError && <FormError error={signMut.error} />}
              <Button onClick={() => signMut.mutateAsync(undefined).then(invalidate)} disabled={signMut.isPending}>
                {signMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Signer & verrouiller
              </Button>
            </ActionBox>
            <ActionBox icon={<X className="h-4 w-4" />} title="Retour pour rework (expert-comptable)">
              <Input placeholder="Motif obligatoire" value={reason} onChange={(e) => setReason(e.target.value)} />
              <Button variant="outline" onClick={() => rejectMut.mutateAsync(undefined).then(invalidate)} disabled={rejectMut.isPending || reason.trim().length < 3}>
                {rejectMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Renvoyer
              </Button>
            </ActionBox>
          </>
        )}

        {wfStatus === 'locked' && (
          <div className="text-sm bg-emerald-50 text-emerald-900 rounded-md px-3 py-2">
            <ShieldCheck className="inline h-4 w-4 mr-1" />
            Écriture définitivement verrouillée et validée. Toute modification passe désormais par contre-passation.
          </div>
        )}

        <div className="space-y-2">
          <div className="text-sm font-medium">Signatures ({signatures.length})</div>
          {signatures.length === 0 ? (
            <div className="text-xs text-muted-foreground">Aucune signature.</div>
          ) : (
            signatures.map((s) => (
              <div key={s.id} className="text-xs bg-muted/40 rounded p-2 font-mono">
                <div><PenLine className="inline h-3 w-3 mr-1" />{s.signerRole} — {new Date(s.signedAt).toLocaleString('fr-FR')}</div>
                <div className="text-muted-foreground truncate">SHA-256: {s.signatureHash.slice(0, 32)}...</div>
                {s.comment && <div className="not-italic">"{s.comment}"</div>}
              </div>
            ))
          )}
        </div>

        <div className="space-y-2">
          <div className="text-sm font-medium">Historique ({events.length})</div>
          <ol className="space-y-1 text-xs">
            {events.map((e) => (
              <li key={e.id} className="flex items-center gap-2 bg-muted/40 rounded px-2 py-1.5">
                <span className="text-muted-foreground">{new Date(e.occurredAt).toLocaleString('fr-FR')}</span>
                {e.fromStatus && (
                  <>
                    <Badge className={STATUS_COLOR[e.fromStatus]}>{STATUS_LABEL[e.fromStatus]}</Badge>
                    <ArrowRight className="h-3 w-3" />
                  </>
                )}
                <Badge className={STATUS_COLOR[e.toStatus]}>{STATUS_LABEL[e.toStatus]}</Badge>
                {e.comment && <span className="text-muted-foreground italic truncate">"{e.comment}"</span>}
              </li>
            ))}
          </ol>
        </div>
      </CardContent>
    </Card>
  );
}

function ActionBox({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="border rounded-md p-3 space-y-2">
      <div className="text-sm font-medium flex items-center gap-2">{icon}{title}</div>
      {children}
    </div>
  );
}
