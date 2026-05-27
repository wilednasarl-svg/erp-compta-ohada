'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Send, X } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { AppShell } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
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
    if (!window.confirm(`Révoquer l'invitation envoyée à ${email} ?`)) return;
    await revoke.mutateAsync(invitationId).catch(() => undefined);
  };

  return (
    <AppShell>
      <div className="mx-auto max-w-[900px] animate-page-in space-y-12">
        <header>
          <p className="eyebrow mb-2">Organisation</p>
          <h1 className="font-display text-4xl font-medium tracking-tight text-ink">
            Invitations
          </h1>
          <p className="mt-3 max-w-[60ch] text-sm leading-relaxed text-ink-soft">
            Invitez de nouveaux membres à rejoindre{currentOrg?.name ? ` ${currentOrg.name}` : ''}. Le lien est valable 7 jours.
          </p>
        </header>

        {/* ─── Invite form ────────────────────────────────── */}
        <section aria-labelledby="invite-title" className="space-y-5">
          <div className="border-b border-line pb-3">
            <h2 id="invite-title" className="font-display text-xl font-medium text-ink">
              Inviter un membre
            </h2>
            <p className="mt-1 text-xs text-ink-mute">
              Le destinataire recevra un email avec un lien d'acceptation.
            </p>
          </div>

          <form onSubmit={onSubmit} noValidate>
            <FormError error={invite.error} className="mb-4" />
            <div className="grid gap-4 sm:grid-cols-[1fr_220px]">
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  {...form.register('email')}
                />
                {form.formState.errors.email !== undefined && (
                  <p className="text-xs text-critical-ink">
                    {form.formState.errors.email.message}
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="roleCode">Rôle</Label>
                <select
                  id="roleCode"
                  className="flex h-9 w-full rounded-sm border border-line-strong bg-paper px-3 py-1 text-sm text-ink transition-colors focus:border-accent focus:outline-none"
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
            <Button type="submit" className="press mt-4" disabled={invite.isPending}>
              {invite.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Send className="mr-2 h-4 w-4" />
              )}
              {invite.isPending ? 'Envoi…' : "Envoyer l'invitation"}
            </Button>
          </form>
        </section>

        {/* ─── Pending invitations ────────────────────────── */}
        <section aria-labelledby="pending-title" className="space-y-5">
          <div className="border-b border-line pb-3">
            <h2 id="pending-title" className="font-display text-xl font-medium text-ink">
              Invitations en attente
            </h2>
            {invitesQuery.data !== undefined && (
              <p className="mt-0.5 text-xs text-ink-mute">
                {invitesQuery.data.length} lien{invitesQuery.data.length !== 1 ? 's' : ''} envoyé{invitesQuery.data.length !== 1 ? 's' : ''}
              </p>
            )}
          </div>

          <FormError error={revoke.error} />

          {invitesQuery.isLoading ? (
            <div className="flex items-center gap-2 py-8 text-sm text-ink-mute">
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.5} />
              Chargement…
            </div>
          ) : invitesQuery.isError ? (
            <FormError error={invitesQuery.error} />
          ) : (invitesQuery.data ?? []).length === 0 ? (
            <p className="py-8 text-center text-sm text-ink-mute">
              Aucune invitation en attente.
            </p>
          ) : (
            <div className="divide-y divide-line rounded-sm border border-line">
              {(invitesQuery.data ?? []).map((inv) => (
                <div
                  key={inv.id}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-ink">{inv.email}</p>
                    <p className="truncate text-xs text-ink-mute">
                      Expire le {formatDate(inv.expiresAt)}
                    </p>
                  </div>
                  <span className="inline-block rounded-xs bg-sunk px-2 py-0.5 font-mono text-[11px] text-ink-mute">
                    {ROLE_LABELS[inv.roleCode as RoleCode] ?? inv.roleCode}
                  </span>
                  <button
                    type="button"
                    disabled={revoke.isPending}
                    onClick={() => void handleRevoke(inv.id, inv.email)}
                    aria-label={`Révoquer l'invitation de ${inv.email}`}
                    className="press inline-flex h-7 w-7 items-center justify-center rounded-xs border border-line text-ink-mute transition-colors hover:border-critical hover:text-critical-ink disabled:opacity-40"
                  >
                    <X className="h-3.5 w-3.5" strokeWidth={1.5} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </AppShell>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('fr-FR', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
