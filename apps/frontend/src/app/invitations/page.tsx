'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Send, X } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { AppShell } from '@/components/app-shell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FormError } from '@/components/ui/form-error';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useApiMutation } from '@/hooks/use-api-mutation';
import { ApiError, api } from '@/lib/api-client';
import { useCurrentOrg } from '@/stores/auth-store';
import { ROLE_CODES, ROLE_LABELS, type InvitationView, type RoleCode } from '@/types/rbac';

interface InvitationsResponse {
  readonly invitations: ReadonlyArray<InvitationView>;
}

const inviteSchema = z.object({
  email: z.string().email("L'email n'est pas valide."),
  roleCode: z.enum(ROLE_CODES),
});
type InviteValues = z.infer<typeof inviteSchema>;

/**
 * `/invitations` — admin surface for the invitation lifecycle.
 *
 *   - Form: POST /organizations/:id/invitations creates a pending row,
 *     mints + emails the JWT (dry-run logs in dev). On success the
 *     list refetches.
 *   - List: GET /organizations/:id/invitations renders the pending
 *     invitations with their TTL.
 *   - Revoke: DELETE /organizations/:id/invitations/:invitationId
 *     flips status to `revoked`. Backend is idempotent on already-
 *     final rows.
 *
 * Visibility: the page renders for any tenant member; the backend
 * gates the mutations on `organizations.invite` (create) and
 * `organizations.manage_members` (revoke). Failures surface via the
 * inline FormError so a non-admin understands why the actions don't
 * land.
 */
export default function InvitationsPage() {
  const currentOrg = useCurrentOrg();
  const orgId = currentOrg?.id ?? '';
  const queryClient = useQueryClient();

  const invitesQuery = useQuery<ReadonlyArray<InvitationView>, ApiError>({
    queryKey: ['invitations', orgId],
    queryFn: async () => {
      const data = await api.get<InvitationsResponse>(`/organizations/${orgId}/invitations`);
      return data.invitations;
    },
    enabled: orgId !== '',
  });

  const form = useForm<InviteValues>({
    resolver: zodResolver(inviteSchema),
    defaultValues: { email: '', roleCode: 'comptable' },
  });

  const invite = useApiMutation(
    async (values: InviteValues) => {
      const data = await api.post<{ invitation: InvitationView }>(
        `/organizations/${orgId}/invitations`,
        values,
      );
      return data.invitation;
    },
    {
      onSuccess: () => {
        form.reset({ email: '', roleCode: 'comptable' });
        queryClient.invalidateQueries({ queryKey: ['invitations', orgId] });
      },
    },
  );

  const revoke = useApiMutation(
    async (invitationId: string) => {
      await api.delete<void>(`/organizations/${orgId}/invitations/${invitationId}`);
    },
    {
      onSettled: () => queryClient.invalidateQueries({ queryKey: ['invitations', orgId] }),
    },
  );

  const onSubmit = form.handleSubmit(async (values) => {
    await invite.mutateAsync(values).catch(() => undefined);
  });

  const handleRevoke = async (invitationId: string, email: string): Promise<void> => {
    if (!window.confirm(`Révoquer l'invitation envoyée à ${email} ?`)) {
      return;
    }
    await revoke.mutateAsync(invitationId).catch(() => undefined);
  };

  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Invitations</h1>
          <p className="text-sm text-muted-foreground">
            Invitez de nouveaux membres à rejoindre {currentOrg?.name}. Le lien est valable 7 jours.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Inviter un membre</CardTitle>
            <CardDescription>
              Le destinataire recevra un email avec un lien d'acceptation. S'il n'a pas encore de
              compte, il pourra en créer un au moment de l'acceptation.
            </CardDescription>
          </CardHeader>
          <form onSubmit={onSubmit} noValidate>
            <CardContent className="space-y-4">
              <FormError error={invite.error} />
              <div className="grid gap-4 sm:grid-cols-[1fr_220px]">
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" type="email" autoComplete="email" {...form.register('email')} />
                  {form.formState.errors.email !== undefined ? (
                    <p className="text-xs text-destructive">{form.formState.errors.email.message}</p>
                  ) : null}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="roleCode">Rôle</Label>
                  <select
                    id="roleCode"
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    {...form.register('roleCode')}
                  >
                    {ROLE_CODES.map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABELS[r]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <Button type="submit" disabled={invite.isPending}>
                <Send className="mr-2 h-4 w-4" />
                {invite.isPending ? 'Envoi…' : "Envoyer l'invitation"}
              </Button>
            </CardContent>
          </form>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Invitations en attente</CardTitle>
            <CardDescription>
              Liens d'invitation envoyés mais pas encore acceptés.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FormError error={revoke.error} />
            {invitesQuery.isLoading ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Chargement…</p>
            ) : invitesQuery.isError ? (
              <FormError error={invitesQuery.error} />
            ) : (invitesQuery.data ?? []).length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Aucune invitation en attente.
              </p>
            ) : (
              <ul className="divide-y">
                {(invitesQuery.data ?? []).map((inv) => (
                  <li
                    key={inv.id}
                    className="flex flex-wrap items-center justify-between gap-3 py-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{inv.email}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        Expire le {formatDate(inv.expiresAt)}
                      </p>
                    </div>
                    <Badge variant="secondary">
                      {ROLE_LABELS[inv.roleCode as RoleCode] ?? inv.roleCode}
                    </Badge>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={revoke.isPending}
                      onClick={() => void handleRevoke(inv.id, inv.email)}
                      aria-label={`Révoquer l'invitation de ${inv.email}`}
                    >
                      <X className="mr-1.5 h-3.5 w-3.5" /> Révoquer
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

/**
 * Render an ISO date as a locale-formatted date+time. Uses `fr-FR`
 * unconditionally for MVP since the product is OHADA-targeted; full
 * i18n is a later concern.
 */
function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return iso;
  }
  return d.toLocaleString('fr-FR', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
