'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import { FormError } from '@/components/ui/form-error';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useApiMutation } from '@/hooks/use-api-mutation';
import { api } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth-store';
import type { SelectOrganizationResponse } from '@/types/auth';

const ORG_TYPES = ['firm', 'company'] as const;
const ACCOUNTING_SYSTEMS = ['NORMAL', 'MINIMAL', 'ALLEGE'] as const;

const schema = z.object({
  name: z.string().min(2, 'Au moins 2 caractères.').max(120, 'Maximum 120 caractères.'),
  type: z.enum(ORG_TYPES),
  system: z.enum(ACCOUNTING_SYSTEMS),
});
type Values = z.infer<typeof schema>;

interface CreateOrgResponse {
  organization: { id: string; name: string; slug: string; type: 'firm' | 'company' };
}

const SYSTEM_LABELS: Record<
  (typeof ACCOUNTING_SYSTEMS)[number],
  { title: string; subtitle: string }
> = {
  NORMAL: {
    title: 'Système Normal',
    subtitle: 'PME et grandes entreprises — plan complet (~800 comptes), états financiers complets.',
  },
  ALLEGE: {
    title: 'Système Allégé',
    subtitle: 'Entités intermédiaires — plan intermédiaire (~600 comptes), états simplifiés.',
  },
  MINIMAL: {
    title: 'Système Minimal de Trésorerie',
    subtitle:
      "Très petites entités sous seuils — comptabilité d'encaissement, plan réduit.",
  },
};

export default function NewOrganizationPage() {
  const router = useRouter();
  const setOrg = useAuthStore((s) => s.setOrg);

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', type: 'firm', system: 'NORMAL' },
  });

  const create = useApiMutation((values: Values) =>
    api.post<CreateOrgResponse>('/organizations', values),
  );
  const select = useApiMutation((orgId: string) =>
    api.post<SelectOrganizationResponse>('/auth/select-organization', { organizationId: orgId }),
  );

  const onSubmit = form.handleSubmit(async (values) => {
    const created = await create.mutateAsync(values);
    const switched = await select.mutateAsync(created.organization.id);
    setOrg({
      accessToken: switched.accessToken,
      refreshToken: switched.refreshToken,
      organization: switched.organization,
    });
    router.replace('/dashboard');
  });

  const pending = create.isPending || select.isPending;
  const error = create.error ?? select.error;

  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-4 py-12">
      <div className="w-full max-w-md animate-page-in space-y-8 rounded-sm border border-line bg-paper p-8">
        <header>
          <p className="eyebrow mb-2">ERP Compta OHADA</p>
          <h1 className="font-display text-3xl font-medium tracking-tight text-ink">
            Créer une organisation
          </h1>
          <p className="mt-2 text-sm text-ink-mute">
            Votre organisation est l'espace dans lequel vos collaborateurs et clients vont
            travailler.
          </p>
        </header>

        <form onSubmit={onSubmit} noValidate className="space-y-5">
          <FormError error={error} />

          <div className="space-y-1.5">
            <Label htmlFor="name">Nom de l'organisation</Label>
            <Input
              id="name"
              autoFocus
              autoComplete="organization"
              placeholder="Cabinet Konan & Associés"
              {...form.register('name')}
            />
            {form.formState.errors.name !== undefined && (
              <p className="text-xs text-critical-ink">{form.formState.errors.name.message}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="type">Type</Label>
            <select
              id="type"
              className="flex h-9 w-full rounded-sm border border-line-strong bg-paper px-3 py-1 text-sm text-ink transition-colors focus:border-accent focus:outline-none"
              {...form.register('type')}
            >
              <option value="firm">Cabinet d'expertise comptable</option>
              <option value="company">Entreprise cliente</option>
            </select>
          </div>

          <div className="space-y-2">
            <Label>Système comptable OHADA</Label>
            <p className="text-xs text-ink-mute">
              Choix <strong>définitif</strong> — il fige le plan comptable et les états financiers.
              Voir{' '}
              <Link href="/docs/accounting-plan" className="underline">
                guide de choix du système
              </Link>
              .
            </p>
            <div className="space-y-2">
              {ACCOUNTING_SYSTEMS.map((sys) => (
                <label
                  key={sys}
                  className="flex cursor-pointer items-start gap-3 rounded-sm border border-line p-3 transition hover:border-accent/40 has-[:checked]:border-accent has-[:checked]:bg-accent-soft/30"
                >
                  <input
                    type="radio"
                    value={sys}
                    className="mt-1 h-4 w-4 accent-[oklch(var(--accent))]"
                    {...form.register('system')}
                  />
                  <div className="space-y-0.5">
                    <p className="text-sm font-medium text-ink">{SYSTEM_LABELS[sys].title}</p>
                    <p className="text-xs text-ink-mute">{SYSTEM_LABELS[sys].subtitle}</p>
                  </div>
                </label>
              ))}
            </div>
            {form.formState.errors.system !== undefined && (
              <p className="text-xs text-critical-ink">{form.formState.errors.system.message}</p>
            )}
          </div>

          <Button type="submit" className="press w-full" disabled={pending}>
            {pending ? 'Création…' : 'Créer et continuer'}
          </Button>

          <Link
            href="/organizations"
            className="block text-center text-xs text-ink-mute hover:underline"
          >
            Retour à la liste
          </Link>
        </form>
      </div>
    </main>
  );
}
