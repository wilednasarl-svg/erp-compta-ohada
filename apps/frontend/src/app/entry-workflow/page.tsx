'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRight,
  CheckCircle2,
  ClipboardList,
  History,
  Loader2,
  PenLine,
  Search,
  Send,
  ShieldCheck,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';

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
type FilterKey = 'all' | WorkflowStatus;

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

const STATUS_CHIP_CLASS: Record<WorkflowStatus, string> = {
  draft: 'bg-sunk text-ink-soft',
  in_review: 'bg-warn-soft text-warn-ink',
  approved: 'bg-info-soft text-info-ink',
  locked: 'bg-accent-soft text-accent-ink',
};

const SIGNER_ROLE_LABEL: Record<SignerRole, string> = {
  chef_mission: 'Chef de mission',
  expert_comptable: 'Expert-comptable',
};

const FILTERS: ReadonlyArray<{ key: FilterKey; label: string }> = [
  { key: 'all', label: 'Toutes' },
  { key: 'draft', label: 'Brouillon' },
  { key: 'in_review', label: 'En revue' },
  { key: 'approved', label: 'Approuvées' },
  { key: 'locked', label: 'Verrouillées' },
];

/* ─── Shared building blocks ─────────────────────────────────── */

function SkeletonRows({ n = 5 }: { n?: number }) {
  return (
    <div className="animate-pulse divide-y divide-line">
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-3.5">
          <div className="h-3 w-12 rounded-xs bg-sunk" />
          <div className="h-3 w-40 rounded-xs bg-sunk" />
          <div className="h-3 flex-1 rounded-xs bg-sunk" />
          <div className="h-5 w-16 rounded-full bg-sunk" />
        </div>
      ))}
    </div>
  );
}

function EmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  actionHref,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  title: string;
  description: string;
  actionLabel?: string;
  actionHref?: string;
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
      {actionLabel && actionHref && (
        <Link
          href={actionHref}
          className="press inline-flex items-center gap-1.5 rounded-sm bg-accent-soft px-3 py-1.5 text-xs font-medium text-accent-ink transition-colors duration-fast hover:bg-accent hover:text-canvas"
        >
          {actionLabel}
        </Link>
      )}
    </div>
  );
}

function StatusChip({ status }: { status: WorkflowStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_CHIP_CLASS[status]}`}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

/* ─── Page ───────────────────────────────────────────────────── */

export default function EntryWorkflowPage() {
  const currentOrg = useCurrentOrg();
  const orgId = currentOrg?.id ?? '';
  const [activeEntryId, setActiveEntryId] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [query, setQuery] = useState('');

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

  const entries = entriesQuery.data ?? [];

  // Stats summary derived from current draft entries. Workflow data lives
  // per-entry in the detail panel; here we surface raw counts the user
  // sees in the left list to anchor scanning.
  const stats = useMemo(() => {
    const total = entries.length;
    return { total };
  }, [entries]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter((e) => {
      if (q === '') return true;
      return (
        String(e.entryNumber).toLowerCase().includes(q) ||
        e.journalCode.toLowerCase().includes(q) ||
        (e.description ?? '').toLowerCase().includes(q)
      );
    });
  }, [entries, query]);

  return (
    <AppShell>
      <div className="mx-auto max-w-[1200px] animate-page-in space-y-8">
        {/* ─── Header ──────────────────────────────────────── */}
        <header className="space-y-3">
          <p className="eyebrow">Saisie · Workflow</p>
          <h1 className="font-display text-4xl font-medium tracking-tight text-ink">
            Workflow écritures
          </h1>
          <p className="max-w-[64ch] text-sm leading-relaxed text-ink-soft">
            Cycle de validation en deux paliers : le préparateur soumet l&apos;écriture, le
            chef de mission approuve, puis l&apos;expert-comptable signe et verrouille
            définitivement. Chaque transition est tracée et horodatée.
          </p>
        </header>

        {/* ─── Stats summary bar ──────────────────────────── */}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-y border-line bg-paper px-4 py-3 text-xs">
          <span className="flex items-center gap-1.5 text-ink-soft">
            <span className="font-mono text-sm font-medium tabular-nums text-ink">
              {stats.total}
            </span>
            écriture{stats.total > 1 ? 's' : ''} en brouillon
          </span>
          <span aria-hidden className="text-line-strong">
            ·
          </span>
          <span className="text-ink-mute">
            Filtre actif&nbsp;:{' '}
            <span className="font-medium text-ink-soft">
              {FILTERS.find((f) => f.key === filter)?.label ?? 'Toutes'}
            </span>
          </span>
          {query !== '' && (
            <>
              <span aria-hidden className="text-line-strong">
                ·
              </span>
              <span className="text-ink-mute">
                <span className="font-mono tabular-nums text-ink">{filtered.length}</span>{' '}
                résultat{filtered.length > 1 ? 's' : ''} pour «&nbsp;{query}&nbsp;»
              </span>
            </>
          )}
        </div>

        {/* ─── Inline filter row ──────────────────────────── */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-mute"
              strokeWidth={1.5}
            />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Rechercher numéro, journal, libellé…"
              className="h-8 w-64 rounded-sm border border-line-strong bg-paper pl-8 pr-3 text-xs text-ink placeholder:text-ink-mute focus-visible:border-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/40"
            />
          </div>
          <div className="flex items-center gap-1 rounded-sm border border-line bg-paper p-0.5">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                className={`press rounded-xs px-2.5 py-1 text-xs font-medium transition-colors duration-fast ${
                  filter === f.key
                    ? 'bg-ink text-canvas'
                    : 'text-ink-soft hover:bg-sunk hover:text-ink'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* ─── Two-panel layout ────────────────────────────── */}
        <div className="grid gap-6 md:grid-cols-[2fr_3fr]">
          {/* Left — Draft entry list */}
          <div className="overflow-hidden rounded-sm border border-line bg-paper">
            <div className="flex items-baseline justify-between border-b border-line px-4 py-3">
              <p className="eyebrow mb-0">Écritures brouillon</p>
              <p className="text-xs text-ink-mute">
                <span className="font-mono tabular-nums">{filtered.length}</span> à traiter
              </p>
            </div>
            <div className="max-h-[560px] overflow-y-auto">
              {entriesQuery.isLoading ? (
                <SkeletonRows n={6} />
              ) : entriesQuery.error ? (
                <div className="px-4 py-6">
                  <FormError error={entriesQuery.error} />
                </div>
              ) : filtered.length === 0 ? (
                <EmptyState
                  icon={PenLine}
                  title="Aucune écriture en attente de validation"
                  description={
                    query !== ''
                      ? 'Aucun résultat pour cette recherche. Effacer le filtre ou essayer une autre clé.'
                      : 'Les écritures saisies depuis le journal apparaîtront ici dès qu’elles seront soumises au workflow.'
                  }
                />
              ) : (
                <div className="divide-y divide-line">
                  {filtered.map((e) => (
                    <button
                      key={e.id}
                      type="button"
                      onClick={() => setActiveEntryId(e.id)}
                      className={`press w-full px-4 py-3.5 text-left transition-colors duration-fast hover:bg-sunk/50 ${
                        activeEntryId === e.id
                          ? 'bg-accent-soft/60 ring-1 ring-inset ring-accent/30'
                          : ''
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline gap-2">
                            <span className="font-mono text-xs tabular-nums text-ink-soft">
                              {e.journalCode}/{e.entryNumber}
                            </span>
                            <span className="truncate text-sm font-medium text-ink">
                              {e.description}
                            </span>
                          </div>
                          <div className="mt-1 font-mono text-xs tabular-nums text-ink-mute">
                            {e.entryDate}
                          </div>
                        </div>
                        <StatusChip status="draft" />
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right — Workflow detail */}
          {activeEntryId ? (
            <EntryWorkflowDetail orgId={orgId} entryId={activeEntryId} />
          ) : (
            <div className="flex flex-col items-center justify-center rounded-sm border border-dashed border-line-strong bg-paper py-20 text-center">
              <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-sunk">
                <ClipboardList className="h-5 w-5 text-ink-mute" strokeWidth={1.5} />
              </span>
              <p className="mt-4 text-sm font-medium text-ink">
                Sélectionnez une écriture
              </p>
              <p className="mt-1 max-w-[36ch] text-xs text-ink-mute">
                Le détail du workflow apparaît ici&nbsp;: signatures, événements et actions
                disponibles selon votre rôle.
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
      <div className="rounded-sm border border-line bg-paper">
        <SkeletonRows n={4} />
      </div>
    );
  }
  if (histQuery.error) {
    return (
      <div className="rounded-sm border border-line bg-paper p-5">
        <FormError error={histQuery.error} />
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
        <div>
          <p className="eyebrow mb-1">Détail du workflow</p>
          <p className="font-mono text-xs text-ink-mute">id · {entryId.slice(0, 8)}…</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="font-mono text-2xs uppercase tracking-wider">
            Écriture · {entryStatus}
          </Badge>
          {wfStatus && <StatusChip status={wfStatus} />}
        </div>
      </div>

      {/* Action boxes */}
      <div className="space-y-3">
        {wfStatus === undefined && (
          <ActionBox
            icon={<Send className="h-4 w-4" strokeWidth={1.5} />}
            title="Soumettre pour revue"
            subtitle="Le chef de mission sera notifié pour approbation."
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
              Soumettre pour revue
            </Button>
          </ActionBox>
        )}

        {wfStatus === 'in_review' && (
          <>
            <ActionBox
              icon={<CheckCircle2 className="h-4 w-4" strokeWidth={1.5} />}
              title="Approuver (chef de mission)"
              subtitle="L’écriture passera ensuite à la signature de l’expert-comptable."
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
              subtitle="Le préparateur recevra le motif et pourra corriger."
              tone="critical"
            >
              <Input
                placeholder="Motif obligatoire (3 caractères min.)"
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
              title="Signature finale (expert-comptable)"
              subtitle="Verrouillage définitif. Toute modification ultérieure passera par contre-passation."
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
              title="Renvoyer pour rework"
              subtitle="L’écriture retournera au préparateur avec votre motif."
              tone="critical"
            >
              <Input
                placeholder="Motif obligatoire (3 caractères min.)"
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
          <div className="flex items-start gap-3 rounded-sm border border-accent/30 bg-accent-soft px-4 py-3 text-sm text-accent-ink">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.5} />
            <span>
              Écriture définitivement verrouillée et validée. Toute modification passe
              désormais par contre-passation depuis la page Journaux.
            </span>
          </div>
        )}
      </div>

      {/* Signatures */}
      <div className="space-y-3 border-t border-line pt-5">
        <div className="flex items-baseline justify-between">
          <p className="eyebrow mb-0">Signatures</p>
          <p className="font-mono text-xs tabular-nums text-ink-mute">{signatures.length}</p>
        </div>
        {signatures.length === 0 ? (
          <p className="text-xs text-ink-mute">Aucune signature enregistrée à ce stade.</p>
        ) : (
          <ul className="space-y-2">
            {signatures.map((s) => (
              <li
                key={s.id}
                className="rounded-sm border border-line bg-sunk/50 px-3 py-2 text-xs"
              >
                <div className="flex flex-wrap items-center gap-2 text-ink">
                  <PenLine className="h-3.5 w-3.5 shrink-0 text-ink-mute" strokeWidth={1.5} />
                  <span className="font-medium">{SIGNER_ROLE_LABEL[s.signerRole]}</span>
                  <span className="font-mono tabular-nums text-ink-mute">
                    {new Date(s.signedAt).toLocaleString('fr-FR')}
                  </span>
                </div>
                <div className="mt-1 truncate font-mono text-ink-mute">
                  SHA-256 · {s.signatureHash.slice(0, 32)}…
                </div>
                {s.comment && (
                  <div className="mt-1 italic text-ink-soft">«&nbsp;{s.comment}&nbsp;»</div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Event timeline */}
      <div className="space-y-3 border-t border-line pt-5">
        <div className="flex items-baseline justify-between">
          <p className="eyebrow mb-0">Historique</p>
          <p className="font-mono text-xs tabular-nums text-ink-mute">{events.length}</p>
        </div>
        {events.length === 0 ? (
          <EmptyState
            icon={History}
            title="Aucun événement"
            description="Les transitions apparaîtront ici dès que l’écriture entrera dans le workflow."
          />
        ) : (
          <ol className="relative space-y-2.5">
            <span
              aria-hidden
              className="absolute bottom-[8px] left-[5px] top-[8px] w-px bg-line"
            />
            {events.map((e) => (
              <li key={e.id} className="relative flex flex-wrap items-center gap-2 pl-5 text-xs">
                <span
                  aria-hidden
                  className="absolute left-0 top-[7px] h-[11px] w-[11px] rounded-full border-2 border-canvas bg-line-strong"
                />
                <span className="shrink-0 font-mono tabular-nums text-ink-mute">
                  {new Date(e.occurredAt).toLocaleString('fr-FR')}
                </span>
                {e.fromStatus && (
                  <>
                    <StatusChip status={e.fromStatus} />
                    <ArrowRight
                      className="h-3 w-3 shrink-0 text-ink-mute"
                      strokeWidth={1.5}
                    />
                  </>
                )}
                <StatusChip status={e.toStatus} />
                {e.comment && (
                  <span className="min-w-0 truncate italic text-ink-mute">
                    «&nbsp;{e.comment}&nbsp;»
                  </span>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

/* ─── Action box ─────────────────────────────────────────────── */

function ActionBox({
  icon,
  title,
  subtitle,
  tone,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  tone?: 'accent' | 'critical';
  children: React.ReactNode;
}) {
  const borderClass =
    tone === 'accent'
      ? 'border-accent/30 bg-accent-soft/30'
      : tone === 'critical'
        ? 'border-critical/30 bg-critical-soft/30'
        : 'border-line bg-sunk/40';

  const iconClass =
    tone === 'accent'
      ? 'text-accent-ink'
      : tone === 'critical'
        ? 'text-critical-ink'
        : 'text-ink-soft';

  return (
    <div className={`space-y-3 rounded-sm border p-4 ${borderClass}`}>
      <div>
        <div className="flex items-center gap-2 text-sm font-medium text-ink">
          <span className={iconClass}>{icon}</span>
          {title}
        </div>
        {subtitle && (
          <p className="mt-1 pl-6 text-xs leading-snug text-ink-soft">{subtitle}</p>
        )}
      </div>
      <div className="space-y-2.5">{children}</div>
    </div>
  );
}
