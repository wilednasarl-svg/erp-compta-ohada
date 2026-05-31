'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { CheckCircle2, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import { FormError } from '@/components/ui/form-error';
import { IllustrationLedger } from '@/components/ui/illustrations';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useApiMutation } from '@/hooks/use-api-mutation';
import { api } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth-store';
import type { LoginResponse, MfaVerifyChallengeResponse } from '@/types/auth';

/* ─── Validation schemas ─────────────────────────────────────── */

const loginSchema = z.object({
  email: z.string().email("L'email n'est pas valide."),
  password: z.string().min(1, 'Renseignez votre mot de passe.'),
});
type LoginValues = z.infer<typeof loginSchema>;

const mfaSchema = z.object({
  code: z
    .string()
    .min(6, 'Code MFA requis.')
    .regex(/^[A-Za-z0-9-]+$/u, 'Code invalide.'),
});
type MfaValues = z.infer<typeof mfaSchema>;

/* ─── Brand copy ─────────────────────────────────────────────── */

const FEATURES = [
  'Plan comptable SYSCOHADA Tome 1-3 intégré',
  'Journaux, lettrage et rapprochement bancaire',
  'États financiers OHADA exportables PDF / XLSX',
  'Score de santé comptable en temps réel',
] as const;

/* ─── Page ───────────────────────────────────────────────────── */

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const signin = useAuthStore((s) => s.signin);

  const [mfaChallenge, setMfaChallenge] = useState<string | null>(null);

  const loginForm = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: searchParams.get('email') ?? '', password: '' },
  });

  const mfaForm = useForm<MfaValues>({
    resolver: zodResolver(mfaSchema),
    defaultValues: { code: '' },
  });

  const loginMutation = useApiMutation((values: LoginValues) =>
    api.post<LoginResponse>('/auth/login', values, { anonymous: true }),
  );

  const mfaMutation = useApiMutation((values: MfaValues) =>
    api.post<MfaVerifyChallengeResponse>(
      '/auth/mfa/verify-challenge',
      { mfaChallengeToken: mfaChallenge, code: values.code },
      { anonymous: true },
    ),
  );

  const next = searchParams.get('next');

  const onLoginSubmit = loginForm.handleSubmit(async (values) => {
    const result = await loginMutation.mutateAsync(values);
    if (result.mfa_required) {
      setMfaChallenge(result.mfaChallengeToken);
      mfaForm.reset();
      return;
    }
    signin({
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      user: result.user,
      organizations: result.organizations,
    });
    router.replace(next ?? '/organizations');
  });

  const onMfaSubmit = mfaForm.handleSubmit(async (values) => {
    if (mfaChallenge === null) return;
    const result = await mfaMutation.mutateAsync(values);
    signin({
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      user: result.user,
      organizations: [],
    });
    router.replace(next ?? '/organizations');
  });

  return (
    <div className="flex min-h-screen">
      {/* ─── Brand panel ────────────────────────────────────── */}
      <div
        className="hidden flex-col justify-between px-14 py-12 lg:flex lg:w-[56%]"
        style={{ backgroundColor: 'oklch(36% 0.15 152)' }}
      >
        {/* Wordmark */}
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

        {/* Hero */}
        <div>
          <h1
            className="font-display text-[3.25rem] font-medium leading-tight tracking-tight"
            style={{ color: 'oklch(96% 0.012 155)' }}
          >
            La comptabilité<br />OHADA, maîtrisée.
          </h1>
          <p
            className="mt-5 max-w-[44ch] text-base leading-relaxed"
            style={{ color: 'oklch(72% 0.055 155)' }}
          >
            Conçu pour les experts-comptables et directeurs financiers d'Afrique
            sub-saharienne. Conforme SYSCOHADA Révisé, du journal au dépôt DSF.
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

        {/* Footnote */}
        <p className="text-xs" style={{ color: 'oklch(56% 0.05 155)' }}>
          SYSCOHADA Révisé · Acte Uniforme OHADA 2017 · UEMOA / CEMAC
        </p>
      </div>

      {/* ─── Form panel ─────────────────────────────────────── */}
      <div className="flex flex-1 flex-col items-center justify-center bg-canvas px-8 py-12">
        {/* Mobile wordmark */}
        <div className="mb-10 flex items-center gap-2 lg:hidden">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-xs bg-ink font-mono text-[10px] font-semibold text-canvas">
            EC
          </span>
          <span className="font-display text-base font-medium text-ink">Compta OHADA</span>
        </div>

        <div className="w-full max-w-[360px] animate-page-in">
          {mfaChallenge !== null ? (
            /* ── MFA step ─────────────────────────────────── */
            <>
              <h2 className="font-display text-3xl font-medium tracking-tight text-ink">
                Vérification MFA
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-ink-soft">
                Saisissez le code à 6 chiffres de votre application d'authentification,
                ou un code de secours.
              </p>

              <form onSubmit={onMfaSubmit} noValidate className="mt-8 space-y-5">
                <FormError error={mfaMutation.error} />

                <div className="space-y-2">
                  <Label htmlFor="code">Code</Label>
                  <Input
                    id="code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    autoFocus
                    {...mfaForm.register('code')}
                  />
                  {mfaForm.formState.errors.code !== undefined ? (
                    <p className="text-xs text-critical-ink">
                      {mfaForm.formState.errors.code.message}
                    </p>
                  ) : null}
                </div>

                <Button type="submit" className="press w-full" disabled={mfaMutation.isPending}>
                  {mfaMutation.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : null}
                  {mfaMutation.isPending ? 'Vérification…' : 'Vérifier'}
                </Button>

                <button
                  type="button"
                  className="mx-auto block text-xs text-ink-mute transition-colors duration-fast hover:text-ink-soft"
                  onClick={() => {
                    setMfaChallenge(null);
                    loginForm.reset();
                  }}
                >
                  Annuler — revenir à la connexion
                </button>
              </form>
            </>
          ) : (
            /* ── Login step ───────────────────────────────── */
            <>
              <h2 className="font-display text-3xl font-medium tracking-tight text-ink">
                Se connecter
              </h2>
              <p className="mt-2 text-sm text-ink-soft">
                Connectez-vous à votre espace ERP Compta.
              </p>

              <form onSubmit={onLoginSubmit} noValidate className="mt-8 space-y-5">
                <FormError error={loginMutation.error} />

                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    {...loginForm.register('email')}
                  />
                  {loginForm.formState.errors.email !== undefined ? (
                    <p className="text-xs text-critical-ink">
                      {loginForm.formState.errors.email.message}
                    </p>
                  ) : null}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="password">Mot de passe</Label>
                  <Input
                    id="password"
                    type="password"
                    autoComplete="current-password"
                    {...loginForm.register('password')}
                  />
                  {loginForm.formState.errors.password !== undefined ? (
                    <p className="text-xs text-critical-ink">
                      {loginForm.formState.errors.password.message}
                    </p>
                  ) : null}
                </div>

                <Button
                  type="submit"
                  className="press w-full"
                  disabled={loginMutation.isPending}
                >
                  {loginMutation.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : null}
                  {loginMutation.isPending ? 'Connexion…' : 'Se connecter'}
                </Button>
              </form>

              <p className="mt-6 text-center text-sm text-ink-mute">
                Pas encore de compte ?{' '}
                <Link
                  href="/signup"
                  className="font-medium text-ink transition-colors duration-fast hover:text-accent-ink"
                >
                  Créer un compte
                </Link>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
