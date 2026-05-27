'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { AppShell } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
import { FormError } from '@/components/ui/form-error';
import { useApiMutation } from '@/hooks/use-api-mutation';
import { ApiError, api } from '@/lib/api-client';
import { useCurrentOrg, useCurrentUser } from '@/stores/auth-store';
import { ROLE_CODES, ROLE_LABELS, type MemberView, type RoleCode } from '@/types/rbac';

interface MembersResponse {
  readonly members: ReadonlyArray<MemberView>;
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

  return (
    <AppShell>
      <div className="mx-auto max-w-[900px] animate-page-in space-y-10">
        <header>
          <p className="eyebrow mb-2">Organisation</p>
          <h1 className="font-display text-4xl font-medium tracking-tight text-ink">Membres</h1>
          <p className="mt-3 max-w-[60ch] text-sm leading-relaxed text-ink-soft">
            Gérez les membres actifs de l'organisation{currentOrg?.name ? ` ${currentOrg.name}` : ''}.
          </p>
        </header>

        <FormError error={mutationError} />

        <section aria-labelledby="members-title" className="space-y-5">
          <div className="border-b border-line pb-3">
            <h2 id="members-title" className="font-display text-xl font-medium text-ink">
              Membres actifs
            </h2>
            <p className="mt-1 text-xs text-ink-mute">
              Le rôle de chaque membre détermine ses permissions. Les modifications sont
              journalisées dans auth_events.
            </p>
          </div>

          {membersQuery.isLoading ? (
            <div className="flex items-center gap-2 py-8 text-sm text-ink-mute">
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.5} />
              Chargement…
            </div>
          ) : membersQuery.isError ? (
            <FormError error={membersQuery.error} />
          ) : (membersQuery.data ?? []).length === 0 ? (
            <p className="py-8 text-center text-sm text-ink-mute">Aucun membre.</p>
          ) : (
            <div className="overflow-x-auto rounded-sm border border-line">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line bg-sunk">
                    <th className="px-4 py-2.5 text-left"><span className="eyebrow">Membre</span></th>
                    <th className="px-4 py-2.5 text-left"><span className="eyebrow">Email</span></th>
                    <th className="px-4 py-2.5 text-left"><span className="eyebrow">Rôle</span></th>
                    <th className="px-4 py-2.5 text-right"><span className="eyebrow">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {(membersQuery.data ?? []).map((member, i) => {
                    const isSelf = member.userId === currentUser?.id;
                    const isPending =
                      pendingRowId === member.userId &&
                      (changeRole.isPending || removeMember.isPending);
                    return (
                      <tr
                        key={member.userId}
                        className={`border-b border-line last:border-0 ${i % 2 === 1 ? 'bg-sunk/25' : 'bg-paper'}`}
                      >
                        <td className="px-4 py-3 font-medium text-ink">
                          {displayName(member)}
                          {isSelf && (
                            <span className="ml-2 text-xs text-ink-mute">(vous)</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-ink-soft">{member.email ?? '—'}</td>
                        <td className="px-4 py-3">
                          <select
                            aria-label={`Changer le rôle de ${displayName(member)}`}
                            className="h-8 rounded-xs border border-line-strong bg-paper px-2 text-xs text-ink transition-colors focus:border-accent focus:outline-none disabled:opacity-50"
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
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            type="button"
                            onClick={() => void handleRemove(member)}
                            disabled={isPending}
                            aria-label={`Retirer ${displayName(member)}`}
                            className="press inline-flex h-7 w-7 items-center justify-center rounded-xs border border-line text-ink-mute transition-colors hover:border-critical hover:text-critical-ink disabled:opacity-40"
                          >
                            {isPending ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                            )}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
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
