'use client';

import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  ChevronDown,
  ChevronRight,
  History,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
  XCircle,
} from 'lucide-react';
import { useState } from 'react';

import { AppShell } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
import { FormError } from '@/components/ui/form-error';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError, api } from '@/lib/api-client';
import { useCurrentOrg } from '@/stores/auth-store';

interface AuditLogRow {
  readonly id: string;
  readonly module: string;
  readonly action: string;
  readonly eventType: string;
  readonly userId: string | null;
  readonly entityType: string | null;
  readonly entityId: string | null;
  readonly before: Record<string, unknown> | null;
  readonly after: Record<string, unknown> | null;
  readonly metadata: Record<string, unknown>;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
  readonly requestId: string | null;
  readonly createdAt: string;
}

interface AuditResponse {
  readonly logs: ReadonlyArray<AuditLogRow>;
  readonly nextCursor?: string | null;
}

type ActionKind = 'CREATE' | 'UPDATE' | 'DELETE' | 'VALIDATE' | 'CANCEL' | 'OTHER';

function classifyAction(action: string): ActionKind {
  const a = action.toLowerCase();
  if (a.includes('create') || a.includes('add') || a.includes('upload')) return 'CREATE';
  if (a.includes('update') || a.includes('edit') || a.includes('patch') || a.includes('modify')) return 'UPDATE';
  if (a.includes('delete') || a.includes('remove')) return 'DELETE';
  if (a.includes('validate') || a.includes('approve') || a.includes('lock') || a.includes('post')) return 'VALIDATE';
  if (a.includes('cancel') || a.includes('reject') || a.includes('revoke') || a.includes('failed')) return 'CANCEL';
  return 'OTHER';
}

const ACTION_TONE: Record<ActionKind, string> = {
  CREATE: 'bg-accent-soft text-accent-ink',
  UPDATE: 'bg-info-soft text-info-ink',
  DELETE: 'bg-critical-soft text-critical-ink',
  VALIDATE: 'bg-accent-soft text-accent-ink',
  CANCEL: 'bg-warn-soft text-warn-ink',
  OTHER: 'bg-sunk text-ink-soft',
};

const ACTION_LABEL: Record<ActionKind, string> = {
  CREATE: 'Création',
  UPDATE: 'Modification',
  DELETE: 'Suppression',
  VALIDATE: 'Validation',
  CANCEL: 'Annulation',
  OTHER: 'Action',
};

function ActionIcon({ kind }: { kind: ActionKind }) {
  const cls = 'h-3.5 w-3.5';
  const stroke = 1.75;
  switch (kind) {
    case 'CREATE':
      return <Plus className={cls} strokeWidth={stroke} />;
    case 'UPDATE':
      return <Pencil className={cls} strokeWidth={stroke} />;
    case 'DELETE':
      return <Trash2 className={cls} strokeWidth={stroke} />;
    case 'VALIDATE':
      return <ShieldCheck className={cls} strokeWidth={stroke} />;
    case 'CANCEL':
      return <XCircle className={cls} strokeWidth={stroke} />;
    default:
      return <Activity className={cls} strokeWidth={stroke} />;
  }
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffSec = Math.round((now - then) / 1000);
  if (diffSec < 60) return "à l'instant";
  if (diffSec < 3600) return `il y a ${Math.floor(diffSec / 60)} min`;
  if (diffSec < 86_400) return `il y a ${Math.floor(diffSec / 3600)} h`;
  if (diffSec < 604_800) return `il y a ${Math.floor(diffSec / 86_400)} j`;
  return new Date(iso).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function SkeletonRows({ n = 5 }: { n?: number }) {
  return (
    <div className="animate-pulse divide-y divide-line">
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3">
          <div className="h-8 w-8 rounded-full bg-sunk" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3 w-40 rounded-xs bg-sunk" />
            <div className="h-2.5 w-56 rounded-xs bg-sunk" />
          </div>
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

export default function AuditLogsPage() {
  const currentOrg = useCurrentOrg();
  const orgId = currentOrg?.id ?? '';

  const [filterModule, setFilterModule] = useState('');
  const [filterAction, setFilterAction] = useState('');
  const [filterEntityId, setFilterEntityId] = useState('');
  const [cursor, setCursor] = useState<string | null>(null);

  const logsQuery = useQuery<AuditResponse, ApiError>({
    queryKey: ['audit-logs', orgId, filterModule, filterAction, filterEntityId, cursor],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filterModule.trim() !== '') params.set('module', filterModule.trim());
      if (filterAction.trim() !== '') params.set('action', filterAction.trim());
      if (filterEntityId.trim() !== '') params.set('entityId', filterEntityId.trim());
      if (cursor) params.set('cursor', cursor);
      params.set('limit', '50');
      return api.get<AuditResponse>(`/audit/logs?${params.toString()}`);
    },
    enabled: orgId !== '',
  });

  const logs = logsQuery.data?.logs ?? [];

  return (
    <AppShell>
      <div className="animate-page-in space-y-8">
        <header>
          <p className="eyebrow mb-2">Organisation · Audit</p>
          <h1 className="font-display text-4xl font-medium tracking-tight text-ink">
            Journal d&apos;audit
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-ink-mute">
            Traçabilité complète des actions utilisateur. Conforme aux exigences OHADA
            d&apos;immuabilité.
          </p>
        </header>

        <section className="rounded-sm border border-line bg-paper p-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="space-y-1">
              <Label htmlFor="f-mod" className="text-xs uppercase tracking-wider text-ink-mute">
                Module
              </Label>
              <Input
                id="f-mod"
                value={filterModule}
                onChange={(e) => {
                  setFilterModule(e.target.value);
                  setCursor(null);
                }}
                placeholder="auth, journals, imports…"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="f-act" className="text-xs uppercase tracking-wider text-ink-mute">
                Action
              </Label>
              <Input
                id="f-act"
                value={filterAction}
                onChange={(e) => {
                  setFilterAction(e.target.value);
                  setCursor(null);
                }}
                placeholder="entry_created, login_failed…"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="f-eid" className="text-xs uppercase tracking-wider text-ink-mute">
                Entity ID
              </Label>
              <Input
                id="f-eid"
                value={filterEntityId}
                onChange={(e) => {
                  setFilterEntityId(e.target.value);
                  setCursor(null);
                }}
                placeholder="UUID exact"
              />
            </div>
          </div>
        </section>

        <section className="space-y-4">
          <div className="flex items-end justify-between border-b border-line pb-3">
            <div>
              <h2 className="font-display text-xl font-medium text-ink">Événements récents</h2>
              <p className="mt-1 text-sm text-ink-mute">
                Tri antéchronologique. Cliquer une ligne pour voir le payload before/after.
              </p>
            </div>
            {logs.length > 0 && (
              <span className="font-mono tabular-nums text-xs text-ink-mute">
                {logs.length} événement{logs.length > 1 ? 's' : ''}
              </span>
            )}
          </div>

          <div className="rounded-sm border border-line bg-paper">
            {logsQuery.isLoading ? (
              <SkeletonRows n={6} />
            ) : logs.length === 0 ? (
              <EmptyState
                icon={History}
                title="Aucun événement"
                description="Les actions des utilisateurs seront tracées ici."
              />
            ) : (
              <ul className="divide-y divide-line">
                {logs.map((log) => (
                  <LogRow key={log.id} log={log} />
                ))}
              </ul>
            )}
          </div>
          <FormError error={logsQuery.error} className="mt-3" />

          <div className="mt-3 flex items-center justify-between text-sm">
            <Button
              type="button"
              variant="outline"
              className="press"
              disabled={cursor === null}
              onClick={() => setCursor(null)}
            >
              Page 1
            </Button>
            <Button
              type="button"
              variant="outline"
              className="press"
              disabled={!logsQuery.data?.nextCursor}
              onClick={() => setCursor(logsQuery.data?.nextCursor ?? null)}
            >
              Suivant
            </Button>
          </div>
        </section>
      </div>
    </AppShell>
  );
}

function LogRow({ log }: { log: AuditLogRow }) {
  const [open, setOpen] = useState(false);
  const hasPayload =
    (log.before && Object.keys(log.before).length > 0) ||
    (log.after && Object.keys(log.after).length > 0) ||
    Object.keys(log.metadata).length > 0;

  const kind = classifyAction(log.action);
  const absolute = new Date(log.createdAt).toLocaleString('fr-FR');

  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors duration-fast hover:bg-sunk/40"
      >
        <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sunk text-ink-soft">
          <ActionIcon kind={kind} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${ACTION_TONE[kind]}`}
            >
              {ACTION_LABEL[kind]}
            </span>
            <span className="font-mono text-xs tracking-tight text-ink">{log.action}</span>
            <span className="rounded-xs bg-sunk px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-ink-mute">
              {log.module}
            </span>
            {log.entityType && (
              <span className="font-mono text-2xs text-ink-mute">
                {log.entityType}
                {log.entityId ? `:${log.entityId.slice(0, 8)}` : ''}
              </span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-ink-mute">
            <span title={absolute}>{relativeTime(log.createdAt)}</span>
            {log.userId && (
              <>
                <span aria-hidden>·</span>
                <span className="font-mono">user {log.userId.slice(0, 8)}</span>
              </>
            )}
            {log.ipAddress && (
              <>
                <span aria-hidden>·</span>
                <span className="font-mono tabular-nums">{log.ipAddress}</span>
              </>
            )}
          </div>
        </div>
        <span className="mt-1 shrink-0 text-ink-mute">
          {hasPayload ? (
            open ? (
              <ChevronDown className="h-4 w-4" strokeWidth={1.5} />
            ) : (
              <ChevronRight className="h-4 w-4" strokeWidth={1.5} />
            )
          ) : null}
        </span>
      </button>
      {open && hasPayload && (
        <div className="space-y-2 border-t border-line bg-sunk/20 px-12 py-3 text-xs">
          {log.before && Object.keys(log.before).length > 0 && (
            <Block title="before" payload={log.before} />
          )}
          {log.after && Object.keys(log.after).length > 0 && (
            <Block title="after" payload={log.after} />
          )}
          {Object.keys(log.metadata).length > 0 && (
            <Block title="metadata" payload={log.metadata} />
          )}
        </div>
      )}
    </li>
  );
}

function Block({ title, payload }: { title: string; payload: Record<string, unknown> }) {
  return (
    <div>
      <div className="eyebrow mb-1">{title}</div>
      <pre className="overflow-x-auto rounded-sm border border-line bg-paper p-2 font-mono text-[11px] text-ink">
        {JSON.stringify(payload, null, 2)}
      </pre>
    </div>
  );
}
