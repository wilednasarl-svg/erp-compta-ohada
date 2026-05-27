'use client';

import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight } from 'lucide-react';
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

/**
 * `/audit-logs` — journal append-only (Module 7).
 *
 * Lecture seule, paginé par cursor (le backend retourne `nextCursor`
 * encodant `{createdAt, id}` du dernier vu). Filtres : module,
 * action, entityType, entityId, userId, dates.
 */
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

  return (
    <AppShell>
      <div className="animate-page-in space-y-8">
        <header>
          <p className="eyebrow mb-2">Compliance</p>
          <h1 className="font-display text-4xl font-medium tracking-tight text-ink">Audit logs</h1>
          <p className="mt-2 text-sm text-ink-mute">
            Journal append-only de toutes les actions sensibles : auth, écritures,
            documents, transformations. Conserve `before` / `after` pour reconstituer la
            diff exacte sans accès à la DB.
          </p>
        </header>

        <section className="space-y-4">
          <div className="border-b border-line pb-3">
            <h2 className="font-display text-xl font-medium text-ink">Filtres</h2>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="space-y-1">
              <Label htmlFor="f-mod">Module</Label>
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
              <Label htmlFor="f-act">Action</Label>
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
              <Label htmlFor="f-eid">Entity ID</Label>
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
          <div className="border-b border-line pb-3">
            <h2 className="font-display text-xl font-medium text-ink">Événements récents</h2>
            <p className="mt-1 text-sm text-ink-mute">
              Tri antéchronologique. Cliquer une ligne pour voir le payload before/after.
            </p>
          </div>
          <div className="space-y-3">
            {logsQuery.isLoading ? (
              <p className="text-sm text-ink-mute">Chargement…</p>
            ) : (logsQuery.data?.logs ?? []).length === 0 ? (
              <p className="text-sm text-ink-mute">Aucun événement ne correspond aux filtres.</p>
            ) : (
              <ul className="divide-y divide-line rounded-sm border border-line bg-paper">
                {(logsQuery.data?.logs ?? []).map((log) => (
                  <LogRow key={log.id} log={log} />
                ))}
              </ul>
            )}
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

  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start gap-3 px-3 py-2 text-left text-sm text-ink transition-colors hover:bg-sunk/50"
      >
        <span className="mt-0.5">
          {hasPayload ? (
            open ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )
          ) : (
            <span className="inline-block w-4" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-block rounded-xs bg-sunk px-2 py-0.5 font-mono text-[11px] text-ink-mute">
              {log.module}
            </span>
            <span className="font-medium text-ink">{log.action}</span>
            {log.entityType && (
              <span className="text-xs text-ink-mute">
                {log.entityType}
                {log.entityId ? `:${log.entityId.slice(0, 8)}` : ''}
              </span>
            )}
          </div>
          <div className="mt-0.5 text-xs text-ink-mute">
            {new Date(log.createdAt).toLocaleString('fr-FR')}
            {log.userId ? ` · user ${log.userId.slice(0, 8)}` : ''}
            {log.ipAddress ? ` · ${log.ipAddress}` : ''}
          </div>
        </div>
      </button>
      {open && hasPayload && (
        <div className="space-y-2 border-t border-line bg-sunk/20 px-7 py-3 text-xs">
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
      <div className="font-mono text-[10px] uppercase text-ink-mute">{title}</div>
      <pre className="overflow-x-auto rounded-sm border border-line bg-paper p-2 font-mono text-[11px] text-ink">
        {JSON.stringify(payload, null, 2)}
      </pre>
    </div>
  );
}
