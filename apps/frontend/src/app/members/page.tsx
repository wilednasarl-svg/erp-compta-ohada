'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { useState } from 'react';

import { AppShell } from '@/components/app-shell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FormError } from '@/components/ui/form-error';
import { useApiMutation } from '@/hooks/use-api-mutation';
import { ApiError, api } from '@/lib/api-client';
import { useCurrentOrg, useCurrentUser } from '@/stores/auth-store';
import { ROLE_CODES, ROLE_LABELS, type MemberView, type RoleCode } from '@/types/rbac';

interface MembersResponse {
  readonly members: ReadonlyArray<MemberView>;
}

/**
 * `/members` — admin / org-read view of the current org's active
 * memberships. Two mutations exposed inline on each row:
 *
 *   - Role change (admin OR `users.manage_roles`) — backend enforces
 *     the "at least one active admin per org" invariant (BE-RBAC-09).
 *   - Remove (admin OR `organizations.manage_members`) — same
 *     last-admin invariant; the backend returns ORG_LAST_ADMIN (409)
 *     and we surface the localised message via FormError.
 *
 * The page itself doesn't gate visibility per role: the backend will
 * refuse the mutations with FORBIDDEN_PERMISSION; we surface that
 * error contextually instead of pretending the controls don't exist.
 * For a richer UX a future refactor can read the current user's role
 * from the store + hide the controls preemptively.
 */
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
      // Surfaced via the inline FormError; nothing else to do here.
    } finally {
      setPendingRowId(null);
    }
  };

  const handleRemove = async (member: MemberView): Promise<void> => {
    const confirmed = window.confirm(
      `Retirer ${displayName(member)} de l'organisation ? Cette action est immédiate.`,
    );
    if (!confirmed) {
      return;
    }
    setPendingRowId(member.userId);
    try {
      await removeMember.mutateAsync(member.userId);
    } catch {
      // Surfaced via the inline FormError.
    } finally {
      setPendingRowId(null);
    }
  };

  const mutationError = changeRole.error ?? removeMember.error;

  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Membres</h1>
          <p className="text-sm text-muted-foreground">
            Gérez les membres actifs de l'organisation {currentOrg?.name}.
          </p>
        </div>

        <FormError error={mutationError} />

        <Card>
          <CardHeader>
            <CardTitle>Membres actifs</CardTitle>
            <CardDescription>
              Le rôle de chaque membre détermine ses permissions. Les modifications sont
              journalisées dans `auth_events`.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {membersQuery.isLoading ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Chargement…</p>
            ) : membersQuery.isError ? (
              <FormError error={membersQuery.error} />
            ) : (membersQuery.data ?? []).length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Aucun membre.</p>
            ) : (
              <ul className="divide-y">
                {(membersQuery.data ?? []).map((member) => {
                  const isSelf = member.userId === currentUser?.id;
                  const isPending =
                    pendingRowId === member.userId &&
                    (changeRole.isPending || removeMember.isPending);
                  return (
                    <li
                      key={member.userId}
                      className="flex flex-wrap items-center justify-between gap-3 py-3"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{displayName(member)}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {member.email ?? '—'}
                          {isSelf ? ' · vous' : ''}
                        </p>
                      </div>
                      <Badge variant="secondary">
                        {ROLE_LABELS[member.role as RoleCode] ?? member.role}
                      </Badge>
                      <select
                        aria-label={`Changer le rôle de ${displayName(member)}`}
                        className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                        value={member.role}
                        disabled={isPending}
                        onChange={(e) => void handleRoleChange(member.userId, e.target.value as RoleCode)}
                      >
                        {ROLE_CODES.map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABELS[r]}
                          </option>
                        ))}
                      </select>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void handleRemove(member)}
                        disabled={isPending}
                        aria-label={`Retirer ${displayName(member)}`}
                      >
                        <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Retirer
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

function displayName(member: MemberView): string {
  const parts = [member.firstName, member.lastName].filter(
    (v): v is string => typeof v === 'string' && v.length > 0,
  );
  if (parts.length > 0) {
    return parts.join(' ');
  }
  return member.email ?? member.userId;
}
