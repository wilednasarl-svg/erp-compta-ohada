'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { CheckCircle2, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import { FormError } from '@/components/ui/form-error';
import { IllustrationLedger } from '@/components/ui/illustrations';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useApiMutation } from '@/hooks/use-api-mutation';
import { api } from '@/lib/api-client';
import type { SignupResponse } from '@/types/auth';

/* ─── Validation ─────────────────────────────────────────────── */

const signupSchema = z
  .object({
    firstName: z.string().min(1, 'Renseignez votre prénom.'),
    lastName: z.string().min(1, 'Renseignez votre nom.'),
    email: z.string().email("L'email n'est pas valide."),
    password: z.string().min(12, 'Le mot de passe doit faire au moins 12 caractères.'),
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: 'Les mots de passe ne correspondent pas.',
    path: ['confirmPassword'],
  });

type SignupValues = z.infer<typeof signupSchema>;

/* ─── Brand copy ─────────────────────────────────────────────── */

const FEATURES = [
  'Plan comptable SYSCOHADA Tome 1-3 intégré',
  'Journaux, lettrage et rapprochement bancaire',
  'États financiers OHADA exportables PDF / XLSX',
  'Multi-dossiers, multi-devises, multi-utilisateurs',
] as const;

/* ─── Password strength ──────────────────────────────────────── */

type Strength = 'empty' | 'weak' | 'medium' | 'strong';

function scorePassword(pw: string): Strength {
  if (pw.length === 0) return 'empty';
  let score = 0;
  if (pw.length >= 12) score += 1;
  if (pw.length >= 16) score += 1;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score += 1;
  if (/\d/.test(pw)) score += 1;
  if (/[^A-Za-z0-9]/.test(pw)) score += 1;
  if (score <= 2) return 'weak';
  if (score === 3) return 'medium';
  return 'strong';
}

const STRENGTH_META: Record<Exclude<Strength, 'empty'>, {
  label: string;
  chip: string;
  bar: string;
  width: string;
}> = {
  weak: {
    label: 'Faible',
    chip: 'bg-critical-soft text-critical-ink',
    bar: 'bg-critical',
    width: '33%',
  },
  medium: {
    label: 'Moyen',
    chip: 'bg-warn-soft text-warn-ink',
    bar: 'bg-warn',
    width: '66%',
  },
  strong: {
    label: 'Fort',
    chip: 'bg-accent-soft text-accent-ink',
    bar: 'bg-accent',
    width: '100%',
  },
};

/* ─── Page ───────────────────────────────────────────────────── */

export default function SignupPage() {
  const router = useRouter();

  const form = useForm<SignupValues>({
    resolver: zodResolver(signupSchema),
    defaultValues: {
      firstName: '',
      lastName: '',
      email: '',
      password: '',
      confirmPassword: '',
    },
    mode: 'onChange',
  });

  const passwordValue = form.watch('password');
  const strength = useMemo(() => scorePassword(passwordValue), [passwordValue]);

  const signup = useApiMutation((values: SignupValues) =>
    api.post<SignupResponse>(
      '/auth/signup',
      {
        email: values.email,
        password: values.password,
        firstName: values.firstName,
        lastName: values.lastName,
      },
      { anonymous: true },
    ),
  );

  const onSubmit = form.handleSubmit(async (values) => {
    await signup.mutateAsync(values);
    router.push(`/login?email=${encodeURIComponent(values.email)}`);
  });

  return (
    <div className="flex min-h-screen">
      {/* ─── Brand panel ────────────────────────────────────── */}
      <div
        className="hidden flex-col justify-between px-14 py-12 lg:flex lg:w-[56%]"
        style={{ backgroundColor: 'oklch(36% 0.15 152)' }}
      >
        <div className="flex items-center gap-3">
          <span
            className="inline-flex h-8 w-8 items-center justify-center rounded-sm font-mono text-xs font-semibold tracking-tight"
            style={{
              backgroundColor: 'oklch(94% 0.018 155)',
              color: 'oklch(36% 0.15 152)',
            }}
          >
            EC
          </span>
          <span
            className="font-display text-lg font-medium tracking-tight"
            style={{ color: 'oklch(94% 0.018 155)' }}
          >
            Compta{' '}
            <span
              style={{
                color: 'oklch(68% 0.07 155)',
                fontSize: '0.68em',
                letterSpacing: '0.07em',
                textTransform: 'uppercase',
              }}
            >
              OHADA
            </span>
          </span>
        </div>

        <div>
          <h1
            className="font-display text-[3.25rem] font-medium leading-tight tracking-tight"
            style={{ color: 'oklch(96% 0.012 155)' }}
          >
            Rejoignez<br />ERP Compta.
          </h1>
          <p
            className="mt-5 max-w-[44ch] text-base leading-relaxed"
            style={{ color: 'oklch(72% 0.055 155)' }}
          >
            Créez votre compte en quelques secondes. Vous configurerez votre première
            organisation juste après — cabinet ou entreprise, à votre choix.
          </p>

          <IllustrationLedger className="mt-9 h-24 w-auto text-[oklch(74%_0.065_155)]" />

          <ul className="mt-9 space-y-3.5">
            {FEATURES.map((f) => (
              <li key={f} className="flex items-start gap-3">
                <CheckCircle2
                  className="mt-0.5 h-4 w-4 shrink-0"
                  style={{ color: 'oklch(68% 0.10 155)' }}
                  strokeWidth={1.5}
                />
                <span className="text-sm" style={{ color: 'oklch(84% 0.03 155)' }}>
                  {f}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <p className="text-xs" style={{ color: 'oklch(56% 0.05 155)' }}>
          SYSCOHADA Révisé · Acte Uniforme OHADA 2017 · UEMOA / CEMAC
        </p>
      </div>

      {/* ─── Form panel ─────────────────────────────────────── */}
      <div className="flex flex-1 flex-col items-center justify-center bg-canvas px-8 py-12">
        {/* Mobile wordmark */}
        <div className="mb-10 flex items-center gap-2 lg:hidden">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-xs bg-ink font-mono text-2xs font-semibold text-canvas">
            EC
          </span>
          <span className="font-display text-base font-medium text-ink">Compta OHADA</span>
        </div>

        <div className="w-full max-w-[400px] animate-page-in">
          <h2 className="font-display text-3xl font-medium tracking-tight text-ink">
            Créer un compte
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-ink-soft">
            Quelques informations et vous êtes prêt à démarrer.
          </p>

          <form onSubmit={onSubmit} noValidate className="mt-8 space-y-5">
            <FormError error={signup.error} />

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="firstName">Prénom</Label>
                <Input
                  id="firstName"
                  autoComplete="given-name"
                  autoFocus
                  {...form.register('firstName')}
                />
                {form.formState.errors.firstName !== undefined && (
                  <p className="text-xs text-critical-ink">
                    {form.formState.errors.firstName.message}
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="lastName">Nom</Label>
                <Input
                  id="lastName"
                  autoComplete="family-name"
                  {...form.register('lastName')}
                />
                {form.formState.errors.lastName !== undefined && (
                  <p className="text-xs text-critical-ink">
                    {form.formState.errors.lastName.message}
                  </p>
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="email">Email professionnel</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="vous@cabinet.ci"
                {...form.register('email')}
              />
              {form.formState.errors.email !== undefined && (
                <p className="text-xs text-critical-ink">
                  {form.formState.errors.email.message}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Mot de passe</Label>
                {strength !== 'empty' && (
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-2xs font-medium ${STRENGTH_META[strength].chip}`}
                  >
                    {STRENGTH_META[strength].label}
                  </span>
                )}
              </div>
              <Input
                id="password"
                type="password"
                autoComplete="new-password"
                {...form.register('password')}
              />
              {strength !== 'empty' && (
                <div className="h-1 overflow-hidden rounded-full bg-sunk">
                  <div
                    className={`h-full transition-all duration-fast ${STRENGTH_META[strength].bar}`}
                    style={{ width: STRENGTH_META[strength].width }}
                  />
                </div>
              )}
              {form.formState.errors.password !== undefined ? (
                <p className="text-xs text-critical-ink">
                  {form.formState.errors.password.message}
                </p>
              ) : (
                <p className="text-xs text-ink-mute">
                  Minimum 12 caractères. Mélangez chiffres, lettres et symboles.
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="confirmPassword">Confirmer le mot de passe</Label>
              <Input
                id="confirmPassword"
                type="password"
                autoComplete="new-password"
                {...form.register('confirmPassword')}
              />
              {form.formState.errors.confirmPassword !== undefined && (
                <p className="text-xs text-critical-ink">
                  {form.formState.errors.confirmPassword.message}
                </p>
              )}
            </div>

            <Button type="submit" className="press w-full" disabled={signup.isPending}>
              {signup.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              {signup.isPending ? 'Création…' : 'Créer le compte'}
            </Button>

            <p className="text-2xs leading-relaxed text-ink-mute">
              En créant un compte, vous acceptez nos conditions générales d'utilisation
              et notre politique de confidentialité.
            </p>
          </form>

          <p className="mt-6 text-center text-sm text-ink-mute">
            Déjà un compte ?{' '}
            <Link
              href="/login"
              className="font-medium text-ink transition-colors duration-fast hover:text-accent-ink"
            >
              Se connecter
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
