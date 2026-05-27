'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Trash2, Users } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { AppShell } from '@/components/app-shell';
import { FormError } from '@/components/ui/form-error';
import { useApiMutation } from '@/hooks/use-api-mutation';
import { ApiError, api } from '@/lib/api-client';
import { useCurrentOrg, useCurrentUser } from '@/stores/auth-store';
import { ROLE_CODES, ROLE_LABELS, type MemberView, type RoleCode } from '@/types/rbac';

interface MembersResponse {
  readonly members: ReadonlyArray<MemberView>;
}

const ROLE_TONE: Record<string, string> = {
  admin: 'bg-critical-soft text-critical-ink',
  expert_comptable: 'bg-accent-soft text-accent-ink',
  chef_mission: 'bg-info-soft text-info-ink',
  comptable: 'bg-sunk text-ink-soft',
  auditeur: 'bg-warn-soft text-warn-ink',
};

function Avatar({ name, email }: { name?: string; email?: string }) {
  const initials = (name ?? email ?? '?')
    .split(/[ @.]/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? '')
    .join('');
  return (
    <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-medium uppercase tracking-wider text-accent-ink">
      {initials || '?'}
    </span>
  );
}

function SkeletonRows({ n = 4 }: { n?: number }) {
  return (
    <div className="animate-pulse divide-y divide-line">
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3">
          <div className="h-9 w-9 rounded-full bg-sunk" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3 w-32 rounded-xs bg-sunk" />
            <div className="h-2.5 w-48 rounded-xs bg-sunk" />
          </div>
          <div className="h-5 w-20 rounded-full bg-sunk" />
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
          className="inline-flex items-center gap-1.5 rounded-sm bg-accent-soft px-3 py-1.5 text-xs font-medium text-accent-ink transition-colors duration-fast hover:bg-accent hover:text-canvas"
        >
          {actionLabel}
        </Link>
      )}
    </div>
  );
}

export default function MembersPage() {
  const currentOrg = useCurrentOrg();
  const currentUser = useCurrentUser();
  const orgId = currentOrg?.id ?? '';
  const queryClient = useQueryClient();
  const [pendingRowId, setPendingRowId] = useState<string | null>(null);

  const membersQuery = useQuery<ReadonlyArray<MemberView>, ApiError>({
    queryKey: ['members', orgId],
    queryFn: async () => {
      const data = await api.get<MembersResponse>(`/organizations/${orgId}/members`);
      return data.members;
    },
    enabled: orgId !== '',
  });

  const changeRole = useApiMutation(
    async (input: { userId: string; roleCode: RoleCode }) => {
      const data = await api.patch<{ member: MemberView }>(
        `/organizations/${orgId}/members/${input.userId}`,
        { roleCode: input.roleCode },
      );
      return data.member;
    },
    {
      onSettled: () => queryClient.invalidateQueries({ queryKey: ['members', orgId] }),
    },
  );

  const removeMember = useApiMutation(
    async (userId: string) => {
      await api.delete<void>(`/organizations/${orgId}/members/${userId}`);
    },
    {
      onSettled: () => queryClient.invalidateQueries({ queryKey: ['members', orgId] }),
    },
  );

  const handleRoleChange = async (userId: string, newRole: RoleCode): Promise<void> => {
    setPendingRowId(userId);
    try {
      await changeRole.mutateAsync({ userId, roleCode: newRole });
    } catch {
      // surfaced via FormError
    } finally {
      setPendingRowId(null);
    }
  };

  const handleRemove = async (member: MemberView): Promise<void> => {
    const confirmed = window.confirm(
      `Retirer ${displayName(member)} de l'organisation ? Cette action est immédiate.`,
    );
    if (!confirmed) return;
    setPendingRowId(member.userId);
    try {
      await removeMember.mutateAsync(member.userId);
    } catch {
      // surfaced via FormError
    } finally {
      setPendingRowId(null);
    }
  };

  const mutationError = changeRole.error ?? removeMember.error;
  const members = membersQuery.data ?? [];

  return (
    <AppShell>
      <div className="w-full animate-page-in space-y-8">
        <header>
          <p className="eyebrow mb-2">Organisation · Équipe</p>
          <h1 className="font-display text-4xl font-medium tracking-tight text-ink">Membres</h1>
          <p className="mt-2 max-w-[60ch] text-sm text-ink-mute">
            Équipe du cabinet. Gérez les rôles et les accès par organisation
            {currentOrg?.name ? ` ${currentOrg.name}` : ''}.
          </p>
        </header>

        <FormError error={mutationError} />

        <section aria-labelledby="members-title" className="space-y-4">
          <div className="flex items-end justify-between border-b border-line pb-3">
            <div>
              <h2 id="members-title" className="font-display text-xl font-medium text-ink">
                Membres actifs
              </h2>
              <p className="mt-1 text-xs text-ink-mute">
                Le rôle de chaque membre détermine ses permissions. Les modifications sont
                journalisées dans <span className="font-mono">auth_events</span>.
              </p>
            </div>
            {members.length > 0 && (
              <span className="font-mono tabular-nums text-xs text-ink-mute">
                {members.length} membre{members.length > 1 ? 's' : ''}
              </span>
            )}
          </div>

          <div className="rounded-sm border border-line bg-paper">
            {membersQuery.isLoading ? (
              <SkeletonRows n={4} />
            ) : membersQuery.isError ? (
              <div className="p-4">
                <FormError error={membersQuery.error} />
              </div>
            ) : members.length === 0 ? (
              <EmptyState
                icon={Users}
                title="Aucun membre"
                description="Invitez votre équipe via la page Invitations."
                actionLabel="Aller aux invitations"
                actionHref="/invitations"
              />
            ) : (
              <ul className="divide-y divide-line">
                {members.map((member) => {
                  const isSelf = member.userId === currentUser?.id;
                  const isPending =
                    pendingRowId === member.userId &&
                    (changeRole.isPending || removeMember.isPending);
                  const tone = ROLE_TONE[member.role] ?? 'bg-sunk text-ink-soft';
                  return (
                    <li
                      key={member.userId}
                      className="flex flex-wrap items-center gap-3 px-4 py-3 transition-colors duration-fast hover:bg-sunk/30"
                    >
                      <Avatar name={displayName(member)} email={member.email ?? undefined} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium text-ink">
                            {displayName(member)}
                          </span>
                          {isSelf && (
                            <span className="rounded-xs bg-info-soft px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-info-ink">
                              Vous
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-ink-mute">
                          <span className="truncate">{member.email ?? '—'}</span>
                        </div>
                      </div>
                      <span
                        className={`hidden shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-medium md:inline-flex ${tone}`}
                      >
                        {ROLE_LABELS[member.role as RoleCode] ?? member.role}
                      </span>
                      <select
                        aria-label={`Changer le rôle de ${displayName(member)}`}
                        className="h-8 shrink-0 rounded-xs border border-line-strong bg-paper px-2 text-xs text-ink transition-colors focus:border-accent focus:outline-none disabled:opacity-50"
                        value={member.role}
                        disabled={isPending}
                        onChange={(e) =>
                          void handleRoleChange(member.userId, e.target.value as RoleCode)
                        }
                      >
                        {ROLE_CODES.map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABELS[r]}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => void handleRemove(member)}
                        disabled={isPending}
                        aria-label={`Retirer ${displayName(member)}`}
                        className="press inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-xs border border-line text-ink-mute transition-colors duration-fast hover:border-critical hover:text-critical-ink disabled:opacity-40"
                      >
                        {isPending ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>
      </div>
    </AppShell>
  );
}

function displayName(member: MemberView): string {
  const parts = [member.firstName, member.lastName].filter(
    (v): v is string => typeof v === 'string' && v.length > 0,
  );
  if (parts.length > 0) return parts.join(' ');
  return member.email ?? member.userId;
}
