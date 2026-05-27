'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Mail, Send, X } from 'lucide-react';
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

const ROLE_TONE: Record<string, string> = {
  admin: 'bg-critical-soft text-critical-ink',
  expert_comptable: 'bg-accent-soft text-accent-ink',
  chef_mission: 'bg-info-soft text-info-ink',
  comptable: 'bg-sunk text-ink-soft',
  auditeur: 'bg-warn-soft text-warn-ink',
};

type InvitationStatus = 'pending' | 'accepted' | 'expired' | 'revoked';

function getInvitationStatus(inv: InvitationView): InvitationStatus {
  if (inv.status === 'accepted') return 'accepted';
  if (inv.status === 'revoked') return 'revoked';
  if (inv.status === 'expired') return 'expired';
  const exp = new Date(inv.expiresAt).getTime();
  if (!Number.isNaN(exp) && exp < Date.now()) return 'expired';
  return 'pending';
}

const STATUS_TONE: Record<InvitationStatus, string> = {
  pending: 'bg-warn-soft text-warn-ink',
  accepted: 'bg-accent-soft text-accent-ink',
  expired: 'bg-sunk text-ink-mute',
  revoked: 'bg-critical-soft text-critical-ink',
};

const STATUS_LABEL: Record<InvitationStatus, string> = {
  pending: 'En attente',
  accepted: 'Acceptée',
  expired: 'Expirée',
  revoked: 'Révoquée',
};

function SkeletonRows({ n = 3 }: { n?: number }) {
  return (
    <div className="animate-pulse divide-y divide-line">
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3">
          <div className="h-8 w-8 rounded-full bg-sunk" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3 w-40 rounded-xs bg-sunk" />
            <div className="h-2.5 w-32 rounded-xs bg-sunk" />
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

  const invitations = invitesQuery.data ?? [];

  return (
    <AppShell>
      <div className="w-full animate-page-in space-y-8">
        <header>
          <p className="eyebrow mb-2">Organisation · Invitations</p>
          <h1 className="font-display text-4xl font-medium tracking-tight text-ink">
            Invitations
          </h1>
          <p className="mt-2 max-w-[60ch] text-sm text-ink-mute">
            Inviter un collaborateur à rejoindre votre organisation
            {currentOrg?.name ? ` ${currentOrg.name}` : ''}. Le lien est valable 7 jours.
          </p>
        </header>

        <section aria-labelledby="invite-title" className="space-y-4">
          <div className="border-b border-line pb-3">
            <h2 id="invite-title" className="font-display text-xl font-medium text-ink">
              Inviter un membre
            </h2>
            <p className="mt-1 text-xs text-ink-mute">
              Le destinataire recevra un email avec un lien d&apos;acceptation.
            </p>
          </div>

          <form
            onSubmit={onSubmit}
            noValidate
            className="rounded-sm border border-line bg-paper p-4"
          >
            <FormError error={invite.error} className="mb-4" />
            <div className="flex flex-col gap-3 md:flex-row md:items-end">
              <div className="flex-1 space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  placeholder="collaborateur@cabinet.ci"
                  {...form.register('email')}
                />
                {form.formState.errors.email !== undefined && (
                  <p className="text-xs text-critical-ink">
                    {form.formState.errors.email.message}
                  </p>
                )}
              </div>
              <div className="space-y-1.5 md:w-48">
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
              <Button
                type="submit"
                className="press md:w-auto"
                disabled={invite.isPending}
              >
                {invite.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Send className="mr-2 h-4 w-4" />
                )}
                {invite.isPending ? 'Envoi…' : 'Envoyer'}
              </Button>
            </div>
          </form>
        </section>

        <section aria-labelledby="pending-title" className="space-y-4">
          <div className="flex items-end justify-between border-b border-line pb-3">
            <div>
              <h2 id="pending-title" className="font-display text-xl font-medium text-ink">
                Invitations envoyées
              </h2>
              <p className="mt-1 text-xs text-ink-mute">
                Statut, rôle attribué et date d&apos;expiration.
              </p>
            </div>
            {invitations.length > 0 && (
              <span className="font-mono tabular-nums text-xs text-ink-mute">
                {invitations.length} envoyée{invitations.length > 1 ? 's' : ''}
              </span>
            )}
          </div>

          <FormError error={revoke.error} />

          <div className="rounded-sm border border-line bg-paper">
            {invitesQuery.isLoading ? (
              <SkeletonRows n={3} />
            ) : invitesQuery.isError ? (
              <div className="p-4">
                <FormError error={invitesQuery.error} />
              </div>
            ) : invitations.length === 0 ? (
              <EmptyState
                icon={Mail}
                title="Aucune invitation envoyée"
                description="Invitez votre équipe ci-dessous."
              />
            ) : (
              <ul className="divide-y divide-line">
                {invitations.map((inv) => {
                  const status = getInvitationStatus(inv);
                  const roleTone = ROLE_TONE[inv.roleCode] ?? 'bg-sunk text-ink-soft';
                  return (
                    <li
                      key={inv.id}
                      className="flex flex-wrap items-center gap-3 px-4 py-3 transition-colors duration-fast hover:bg-sunk/30"
                    >
                      <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sunk">
                        <Mail className="h-4 w-4 text-ink-mute" strokeWidth={1.5} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-ink">{inv.email}</p>
                        <p className="mt-0.5 text-xs text-ink-mute">
                          Expire le{' '}
                          <span className="font-mono tabular-nums">
                            {formatDate(inv.expiresAt)}
                          </span>
                        </p>
                      </div>
                      <span
                        className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${roleTone}`}
                      >
                        {ROLE_LABELS[inv.roleCode as RoleCode] ?? inv.roleCode}
                      </span>
                      <span
                        className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_TONE[status]}`}
                      >
                        {STATUS_LABEL[status]}
                      </span>
                      <button
                        type="button"
                        disabled={revoke.isPending || status !== 'pending'}
                        onClick={() => void handleRevoke(inv.id, inv.email)}
                        aria-label={`Révoquer l'invitation de ${inv.email}`}
                        className="press inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-xs border border-line text-ink-mute transition-colors duration-fast hover:border-critical hover:text-critical-ink disabled:opacity-40"
                      >
                        <X className="h-3.5 w-3.5" strokeWidth={1.5} />
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
