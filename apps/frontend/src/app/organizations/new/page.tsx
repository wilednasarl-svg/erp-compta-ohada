'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  ArrowLeft,
  BarChart3,
  BookOpen,
  Briefcase,
  Building2,
  FileUp,
  Loader2,
  Users,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
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
import { cn } from '@/lib/utils';
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
    subtitle:
      'PME et grandes entreprises — plan complet (~800 comptes), états financiers complets.',
  },
  ALLEGE: {
    title: 'Système Allégé',
    subtitle: 'Entités intermédiaires — plan intermédiaire (~600 comptes), états simplifiés.',
  },
  MINIMAL: {
    title: 'Système Minimal de Trésorerie',
    subtitle: "Très petites entités sous seuils — comptabilité d'encaissement, plan réduit.",
  },
};

const TYPE_OPTIONS: ReadonlyArray<{
  value: (typeof ORG_TYPES)[number];
  title: string;
  description: string;
  icon: LucideIcon;
}> = [
  { value: 'firm', title: 'Cabinet', description: "Cabinet d'expertise comptable", icon: Briefcase },
  { value: 'company', title: 'Entreprise', description: 'Entreprise cliente', icon: Building2 },
];

/* Ce que le dossier offre — factuel, pas de marketing (cf. PRODUCT.md). */
const VALUE_POINTS: ReadonlyArray<{
  icon: LucideIcon;
  tint: string;
  title: string;
  desc: string;
}> = [
  {
    icon: BookOpen,
    tint: 'bg-accent-soft text-accent-ink',
    title: 'Plan comptable SYSCOHADA',
    desc: 'Pré-chargé selon le système choisi, prêt à l’emploi.',
  },
  {
    icon: FileUp,
    tint: 'bg-info-soft text-info-ink',
    title: 'Import sans ressaisie',
    desc: 'Sage Saari, CSV ou PDF, avec mapping assisté.',
  },
  {
    icon: Users,
    tint: 'bg-warn-soft text-warn-ink',
    title: 'Collaboration encadrée',
    desc: 'Préparateur, valideur, approbateur — chaque action tracée.',
  },
  {
    icon: BarChart3,
    tint: 'bg-accent-soft text-accent-ink',
    title: 'États OHADA & TVA',
    desc: 'Bilan, compte de résultat, DSF, déclarations UEMOA.',
  },
];

export default function NewOrganizationPage() {
  const router = useRouter();
  const setOrg = useAuthStore((s) => s.setOrg);

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', type: 'firm', system: 'NORMAL' },
  });

  const selectedType = form.watch('type');
  const selectedSystem = form.watch('system');

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
    <main className="flex min-h-screen flex-col bg-canvas px-4 py-12 sm:py-16">
      <div className="mx-auto w-full max-w-5xl animate-page-in">
        {/* ── Retour ───────────────────────────────────────── */}
        <Link
          href="/organizations"
          className="group mb-8 inline-flex items-center gap-1.5 text-xs font-medium text-ink-mute transition-colors duration-fast hover:text-ink"
        >
          <ArrowLeft
            className="h-3 w-3 transition-transform duration-fast group-hover:-translate-x-0.5"
            strokeWidth={1.5}
          />
          Retour aux dossiers
        </Link>

        <div className="grid gap-10 lg:grid-cols-[1fr_minmax(0,360px)]">
          {/* ── Colonne formulaire ─────────────────────────── */}
          <div className="min-w-0">
            <header className="border-b border-line pb-6">
              <p className="eyebrow">Espace de travail</p>
              <h1 className="mt-1.5 font-display text-3xl font-medium tracking-tight text-ink sm:text-4xl">
                Nouveau dossier
              </h1>
              <p className="mt-2 max-w-[56ch] text-base leading-relaxed text-ink-soft">
                Un dossier est l&apos;espace où vos collaborateurs et votre client travaillent. Donnez-lui
                un nom, un type, et le système comptable OHADA applicable.
              </p>
            </header>

            <form onSubmit={onSubmit} noValidate className="mt-8 space-y-7">
              <FormError error={error} />

              {/* Nom */}
              <div className="space-y-1.5">
                <Label htmlFor="name">Nom du dossier</Label>
                <Input
                  id="name"
                  autoFocus
                  autoComplete="organization"
                  placeholder="Cabinet Konan & Associés"
                  {...form.register('name')}
                />
                {form.formState.errors.name !== undefined ? (
                  <p className="text-xs text-critical-ink">{form.formState.errors.name.message}</p>
                ) : (
                  <p className="text-xs text-ink-mute">
                    Tel qu&apos;il apparaîtra sur les états et les documents officiels.
                  </p>
                )}
              </div>

              {/* Type */}
              <div className="space-y-2">
                <Label>Type de dossier</Label>
                <div className="grid grid-cols-2 gap-2">
                  {TYPE_OPTIONS.map((opt) => {
                    const Icon = opt.icon;
                    const isActive = selectedType === opt.value;
                    return (
                      <label
                        key={opt.value}
                        className={cn(
                          'group relative flex cursor-pointer flex-col gap-1 rounded-sm border px-3 py-3 transition-colors duration-fast',
                          isActive ? 'border-ink bg-sunk' : 'border-line bg-paper hover:bg-sunk',
                        )}
                      >
                        <input type="radio" value={opt.value} className="sr-only" {...form.register('type')} />
                        <div className="flex items-center gap-2">
                          <span
                            className={cn(
                              'flex h-7 w-7 items-center justify-center rounded-sm',
                              isActive ? 'bg-ink text-canvas' : 'bg-sunk text-ink-soft',
                            )}
                          >
                            <Icon className="h-3.5 w-3.5" strokeWidth={1.5} />
                          </span>
                          <span className="text-sm font-medium text-ink">{opt.title}</span>
                        </div>
                        <p className="text-2xs leading-relaxed text-ink-mute">{opt.description}</p>
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* Système */}
              <div className="space-y-2">
                <Label>Système comptable OHADA</Label>
                <p className="text-xs leading-relaxed text-ink-mute">
                  Choix <strong className="text-ink">définitif</strong> — il fige le plan comptable et les
                  états financiers. Voir{' '}
                  <Link href="/docs/accounting-plan" className="underline">
                    guide de choix du système
                  </Link>
                  .
                </p>
                <div className="space-y-2 pt-1">
                  {ACCOUNTING_SYSTEMS.map((sys) => {
                    const isActive = selectedSystem === sys;
                    return (
                      <label
                        key={sys}
                        className={cn(
                          'flex cursor-pointer items-start gap-3 rounded-sm border p-3 transition-colors duration-fast',
                          isActive ? 'border-accent bg-accent-soft' : 'border-line bg-paper hover:bg-sunk',
                        )}
                      >
                        <input
                          type="radio"
                          value={sys}
                          className="mt-1 h-3.5 w-3.5 border-line-strong text-accent focus:ring-1 focus:ring-accent"
                          {...form.register('system')}
                        />
                        <div className="space-y-0.5">
                          <p className={cn('text-sm font-medium', isActive ? 'text-accent-ink' : 'text-ink')}>
                            {SYSTEM_LABELS[sys].title}
                          </p>
                          <p
                            className={cn(
                              'text-xs leading-relaxed',
                              isActive ? 'text-accent-ink/80' : 'text-ink-mute',
                            )}
                          >
                            {SYSTEM_LABELS[sys].subtitle}
                          </p>
                        </div>
                      </label>
                    );
                  })}
                </div>
                {form.formState.errors.system !== undefined && (
                  <p className="text-xs text-critical-ink">{form.formState.errors.system.message}</p>
                )}
              </div>

              {/* Actions */}
              <div className="flex flex-col gap-3 border-t border-line pt-6">
                <Button type="submit" className="press w-full" disabled={pending}>
                  {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  {pending ? 'Création…' : 'Créer et continuer'}
                </Button>
                <Link
                  href="/organizations"
                  className="text-center text-xs text-ink-mute transition-colors duration-fast hover:text-ink"
                >
                  Annuler
                </Link>
              </div>
            </form>
          </div>

          {/* ── Colonne valeur (réassurance) ───────────────── */}
          <aside className="hidden lg:block">
            <div className="sticky top-16 rounded-lg border border-line bg-paper p-6">
              <p className="eyebrow">Ce que vous obtenez</p>
              <h2 className="mt-1.5 font-display text-xl text-ink">Un dossier prêt à travailler</h2>
              <ul className="mt-6 space-y-5">
                {VALUE_POINTS.map((p) => {
                  const Icon = p.icon;
                  return (
                    <li key={p.title} className="flex items-start gap-3">
                      <span className={cn('mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md', p.tint)}>
                        <Icon className="h-4 w-4" strokeWidth={1.5} />
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-ink">{p.title}</p>
                        <p className="mt-0.5 text-xs leading-relaxed text-ink-mute">{p.desc}</p>
                      </div>
                    </li>
                  );
                })}
              </ul>
              <p className="mt-6 border-t border-line pt-4 text-xs leading-relaxed text-ink-mute">
                Le système comptable est définitif ; le reste se règle plus tard. Vous pourrez inviter
                des collaborateurs après la création.
              </p>
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}
