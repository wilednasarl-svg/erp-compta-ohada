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
import type { SignupResponse } from '@/types/auth';

const signupSchema = z.object({
  email: z.string().email("L'email n'est pas valide."),
  password: z.string().min(12, 'Le mot de passe doit faire au moins 12 caractères.'),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
});
type SignupValues = z.infer<typeof signupSchema>;

export default function SignupPage() {
  const router = useRouter();
  const form = useForm<SignupValues>({
    resolver: zodResolver(signupSchema),
    defaultValues: { email: '', password: '', firstName: '', lastName: '' },
  });

  const signup = useApiMutation((values: SignupValues) =>
    api.post<SignupResponse>(
      '/auth/signup',
      {
        email: values.email,
        password: values.password,
        ...(values.firstName ? { firstName: values.firstName } : {}),
        ...(values.lastName ? { lastName: values.lastName } : {}),
      },
      { anonymous: true },
    ),
  );

  const onSubmit = form.handleSubmit(async (values) => {
    await signup.mutateAsync(values);
    router.push(`/login?email=${encodeURIComponent(values.email)}`);
  });

  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-4 py-12">
      <div className="w-full max-w-md animate-page-in space-y-8 rounded-sm border border-line bg-paper p-8">
        <header>
          <p className="eyebrow mb-2">ERP Compta OHADA</p>
          <h1 className="font-display text-3xl font-medium tracking-tight text-ink">
            Créer un compte
          </h1>
          <p className="mt-2 text-sm text-ink-mute">
            Configurez votre compte. Vous créerez votre première organisation à l'étape suivante.
          </p>
        </header>

        <form onSubmit={onSubmit} noValidate className="space-y-5">
          <FormError error={signup.error} />

          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" autoComplete="email" {...form.register('email')} />
            {form.formState.errors.email !== undefined && (
              <p className="text-xs text-critical-ink">{form.formState.errors.email.message}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="password">Mot de passe</Label>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              {...form.register('password')}
            />
            {form.formState.errors.password !== undefined ? (
              <p className="text-xs text-critical-ink">{form.formState.errors.password.message}</p>
            ) : (
              <p className="text-xs text-ink-mute">
                Minimum 12 caractères. Mélangez chiffres, lettres et symboles.
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="firstName">Prénom</Label>
              <Input id="firstName" autoComplete="given-name" {...form.register('firstName')} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lastName">Nom</Label>
              <Input id="lastName" autoComplete="family-name" {...form.register('lastName')} />
            </div>
          </div>

          <Button type="submit" className="press w-full" disabled={signup.isPending}>
            {signup.isPending ? 'Création…' : 'Créer le compte'}
          </Button>

          <p className="text-center text-sm text-ink-mute">
            Déjà un compte ?{' '}
            <Link href="/login" className="font-medium text-ink hover:underline">
              Se connecter
            </Link>
          </p>
        </form>
      </div>
    </main>
  );
}
