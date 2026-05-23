'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
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
import type { AcceptInvitationResponse } from '@/types/auth';

/**
 * Same schema as the backend `AcceptInvitationDto`: token is mandatory,
 * signup fields are optional. The form ALWAYS surfaces the signup
 * fields — the existing-user branch silently ignores them server-side.
 * This keeps a single UI for both branches; the user types `password`
 * once (if needed), submits, the server decides.
 */
const schema = z.object({
  token: z.string().min(1),
  password: z
    .string()
    .optional()
    .refine((v) => v === undefined || v === '' || v.length >= 12, {
      message: 'Le mot de passe doit faire au moins 12 caractères (laissez vide si vous avez déjà un compte).',
    }),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
});
type Values = z.infer<typeof schema>;

export default function AcceptInvitationPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tokenFromUrl = searchParams.get('token') ?? '';

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { token: tokenFromUrl, password: '', firstName: '', lastName: '' },
  });

  const accept = useApiMutation((values: Values) =>
    api.post<AcceptInvitationResponse>(
      '/auth/invitations/accept',
      {
        token: values.token,
        ...(values.password ? { password: values.password } : {}),
        ...(values.firstName ? { firstName: values.firstName } : {}),
        ...(values.lastName ? { lastName: values.lastName } : {}),
      },
      { anonymous: true },
    ),
  );

  const onSubmit = form.handleSubmit(async (values) => {
    const result = await accept.mutateAsync(values);
    // Always bounce to /login; the user picks a session there (no
    // tokens are returned by the accept endpoint).
    router.replace(`/login?email=${encodeURIComponent(result.user.email)}`);
  });

  if (tokenFromUrl === '') {
    return (
      <main className="container flex min-h-screen items-center justify-center py-12">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Lien d'invitation invalide</CardTitle>
            <CardDescription>
              Ouvrez le lien envoyé par email pour rejoindre l'organisation. Si le lien ne
              fonctionne pas, demandez à l'administrateur de vous renvoyer une invitation.
            </CardDescription>
          </CardHeader>
          <CardFooter>
            <Button asChild variant="outline">
              <Link href="/login">Retour à la connexion</Link>
            </Button>
          </CardFooter>
        </Card>
      </main>
    );
  }

  return (
    <main className="container flex min-h-screen items-center justify-center py-12">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Accepter l'invitation</CardTitle>
          <CardDescription>
            Si vous avez déjà un compte ERP Compta, laissez les champs vides. Sinon, choisissez
            un mot de passe pour créer votre compte et rejoindre l'organisation.
          </CardDescription>
        </CardHeader>
        <form onSubmit={onSubmit} noValidate>
          <CardContent className="space-y-4">
            <FormError error={accept.error} />
            <input type="hidden" {...form.register('token')} />

            <div className="space-y-2">
              <Label htmlFor="password">Mot de passe (nouveau compte uniquement)</Label>
              <Input id="password" type="password" autoComplete="new-password" {...form.register('password')} />
              {form.formState.errors.password !== undefined ? (
                <p className="text-xs text-destructive">{form.formState.errors.password.message}</p>
              ) : null}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="firstName">Prénom</Label>
                <Input id="firstName" {...form.register('firstName')} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="lastName">Nom</Label>
                <Input id="lastName" {...form.register('lastName')} />
              </div>
            </div>
          </CardContent>
          <CardFooter>
            <Button type="submit" className="w-full" disabled={accept.isPending}>
              {accept.isPending ? 'Acceptation…' : "Accepter l'invitation"}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </main>
  );
}
