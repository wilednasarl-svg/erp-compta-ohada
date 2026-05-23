'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
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
import type { LoginResponse, MfaVerifyChallengeResponse } from '@/types/auth';

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

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const signin = useAuthStore((s) => s.signin);

  /**
   * The login flow is two-step when MFA is enabled. We keep the
   * challenge token in component state — never in the Zustand store —
   * because it is single-use and should not survive a reload.
   */
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
    if (mfaChallenge === null) {
      return;
    }
    const result = await mfaMutation.mutateAsync(values);
    signin({
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      user: result.user,
      // After MFA, the backend doesn't list organizations on the
      // verify-challenge response — they'll be fetched after select-org
      // or via a separate call. Empty for now; /organizations refetches.
      organizations: [],
    });
    router.replace(next ?? '/organizations');
  });

  if (mfaChallenge !== null) {
    return (
      <main className="container flex min-h-screen items-center justify-center py-12">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Vérification MFA</CardTitle>
            <CardDescription>
              Saisissez le code à 6 chiffres généré par votre application d'authentification, ou
              un de vos codes de secours.
            </CardDescription>
          </CardHeader>
          <form onSubmit={onMfaSubmit} noValidate>
            <CardContent className="space-y-4">
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
                  <p className="text-xs text-destructive">{mfaForm.formState.errors.code.message}</p>
                ) : null}
              </div>
            </CardContent>
            <CardFooter className="flex flex-col gap-3">
              <Button type="submit" className="w-full" disabled={mfaMutation.isPending}>
                {mfaMutation.isPending ? 'Vérification…' : 'Vérifier'}
              </Button>
              <button
                type="button"
                className="text-xs text-muted-foreground hover:underline"
                onClick={() => {
                  setMfaChallenge(null);
                  loginForm.reset();
                }}
              >
                Annuler et revenir à la connexion
              </button>
            </CardFooter>
          </form>
        </Card>
      </main>
    );
  }

  return (
    <main className="container flex min-h-screen items-center justify-center py-12">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Se connecter</CardTitle>
          <CardDescription>Connectez-vous à votre compte ERP Compta.</CardDescription>
        </CardHeader>
        <form onSubmit={onLoginSubmit} noValidate>
          <CardContent className="space-y-4">
            <FormError error={loginMutation.error} />

            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" autoComplete="email" {...loginForm.register('email')} />
              {loginForm.formState.errors.email !== undefined ? (
                <p className="text-xs text-destructive">
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
                <p className="text-xs text-destructive">
                  {loginForm.formState.errors.password.message}
                </p>
              ) : null}
            </div>
          </CardContent>
          <CardFooter className="flex flex-col gap-3">
            <Button type="submit" className="w-full" disabled={loginMutation.isPending}>
              {loginMutation.isPending ? 'Connexion…' : 'Se connecter'}
            </Button>
            <p className="text-center text-sm text-muted-foreground">
              Pas encore de compte ?{' '}
              <Link href="/signup" className="font-medium text-foreground hover:underline">
                Créer un compte
              </Link>
            </p>
          </CardFooter>
        </form>
      </Card>
    </main>
  );
}
