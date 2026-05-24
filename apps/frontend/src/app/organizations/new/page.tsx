'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
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
  // Module 2 — système comptable OHADA SYSCOHADA. Choix immuable
  // après création (cf. design D2 du Module 2). Le backend valide la
  // même liste fermée via `IsIn` sur `CreateOrganizationDto`.
  system: z.enum(ACCOUNTING_SYSTEMS),
});
type Values = z.infer<typeof schema>;

interface CreateOrgResponse {
  organization: { id: string; name: string; slug: string; type: 'firm' | 'company' };
}

/**
 * Étiquettes utilisateur des trois systèmes. Volontairement courtes —
 * un lien externe vers la doc accounting-plan détaillera les critères
 * de choix (CA, type d'activité, obligation déclarative).
 */
const SYSTEM_LABELS: Record<(typeof ACCOUNTING_SYSTEMS)[number], { title: string; subtitle: string }> = {
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
    subtitle: 'Très petites entités sous seuils — comptabilité d\'encaissement, plan réduit.',
  },
};

/**
 * Create an organization → auto-select it (the backend assigns the
 * creator as admin). Two-step UX:
 *   1. POST /organizations creates the row + the admin membership.
 *   2. POST /auth/select-organization upgrades the JWT with org_id +
 *      role, then we redirect to /dashboard.
 */
export default function NewOrganizationPage() {
  const router = useRouter();
  const setOrg = useAuthStore((s) => s.setOrg);

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    // NORMAL = défaut le plus courant en cabinet OHADA (les TPE
    // éligibles au Minimal sont une minorité ; la migration upgrade
    // vers Normal est lourde, mieux vaut démarrer Normal).
    defaultValues: { name: '', type: 'firm', system: 'NORMAL' },
  });

  const create = useApiMutation((values: Values) => api.post<CreateOrgResponse>('/organizations', values));
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
    <main className="container flex min-h-screen items-center justify-center py-12">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Créer une organisation</CardTitle>
          <CardDescription>
            Votre organisation est l'espace dans lequel vos collaborateurs et clients vont travailler.
          </CardDescription>
        </CardHeader>
        <form onSubmit={onSubmit} noValidate>
          <CardContent className="space-y-4">
            <FormError error={error} />

            <div className="space-y-2">
              <Label htmlFor="name">Nom de l'organisation</Label>
              <Input
                id="name"
                autoFocus
                autoComplete="organization"
                placeholder="Cabinet Konan & Associés"
                {...form.register('name')}
              />
              {form.formState.errors.name !== undefined ? (
                <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="type">Type</Label>
              <select
                id="type"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                {...form.register('type')}
              >
                <option value="firm">Cabinet d'expertise comptable</option>
                <option value="company">Entreprise cliente</option>
              </select>
            </div>

            <div className="space-y-2">
              <Label>Système comptable OHADA</Label>
              <p className="text-xs text-muted-foreground">
                Choix <strong>définitif</strong> — il fige le plan comptable et les états
                financiers. Voir{' '}
                <Link href="/docs/accounting-plan" className="underline">
                  guide de choix du système
                </Link>
                .
              </p>
              <div className="space-y-2">
                {ACCOUNTING_SYSTEMS.map((sys) => (
                  <label
                    key={sys}
                    className="flex cursor-pointer items-start gap-3 rounded-md border border-input p-3 transition hover:border-foreground/30 has-[:checked]:border-foreground has-[:checked]:bg-secondary/40"
                  >
                    <input
                      type="radio"
                      value={sys}
                      className="mt-1 h-4 w-4"
                      {...form.register('system')}
                    />
                    <div className="space-y-0.5">
                      <p className="text-sm font-medium">{SYSTEM_LABELS[sys].title}</p>
                      <p className="text-xs text-muted-foreground">{SYSTEM_LABELS[sys].subtitle}</p>
                    </div>
                  </label>
                ))}
              </div>
              {form.formState.errors.system !== undefined ? (
                <p className="text-xs text-destructive">{form.formState.errors.system.message}</p>
              ) : null}
            </div>
          </CardContent>
          <CardFooter className="flex flex-col gap-3">
            <Button type="submit" className="w-full" disabled={pending}>
              {pending ? 'Création…' : "Créer et continuer"}
            </Button>
            <Link href="/organizations" className="text-xs text-muted-foreground hover:underline">
              Retour à la liste
            </Link>
          </CardFooter>
        </form>
      </Card>
    </main>
  );
}
