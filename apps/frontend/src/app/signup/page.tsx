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
    // Spec flow: signup does NOT auto-login (no token issued). Bounce
    // to login with the email prefilled.
    router.push(`/login?email=${encodeURIComponent(values.email)}`);
  });

  return (
    <main className="container flex min-h-screen items-center justify-center py-12">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Créer un compte</CardTitle>
          <CardDescription>
            Configurez votre compte ERP Compta. Vous créerez ensuite votre première organisation.
          </CardDescription>
        </CardHeader>
        <form onSubmit={onSubmit} noValidate>
          <CardContent className="space-y-4">
            <FormError error={signup.error} />

            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" autoComplete="email" {...form.register('email')} />
              {form.formState.errors.email !== undefined ? (
                <p className="text-xs text-destructive">{form.formState.errors.email.message}</p>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Mot de passe</Label>
              <Input
                id="password"
                type="password"
                autoComplete="new-password"
                {...form.register('password')}
              />
              {form.formState.errors.password !== undefined ? (
                <p className="text-xs text-destructive">{form.formState.errors.password.message}</p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Minimum 12 caractères. Mélangez chiffres, lettres et symboles.
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="firstName">Prénom</Label>
                <Input
                  id="firstName"
                  autoComplete="given-name"
                  {...form.register('firstName')}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="lastName">Nom</Label>
                <Input id="lastName" autoComplete="family-name" {...form.register('lastName')} />
              </div>
            </div>
          </CardContent>
          <CardFooter className="flex flex-col gap-3">
            <Button type="submit" className="w-full" disabled={signup.isPending}>
              {signup.isPending ? 'Création…' : 'Créer le compte'}
            </Button>
            <p className="text-center text-sm text-muted-foreground">
              Déjà un compte ?{' '}
              <Link href="/login" className="font-medium text-foreground hover:underline">
                Se connecter
              </Link>
            </p>
          </CardFooter>
        </form>
      </Card>
    </main>
  );
}
