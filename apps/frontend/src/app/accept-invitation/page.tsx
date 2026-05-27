'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import { FormError } from '@/components/ui/form-error';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useApiMutation } from '@/hooks/use-api-mutation';
import { api } from '@/lib/api-client';
import type { AcceptInvitationResponse } from '@/types/auth';

const schema = z.object({
  token: z.string().min(1),
  password: z
    .string()
    .optional()
    .refine((v) => v === undefined || v === '' || v.length >= 12, {
      message:
        'Le mot de passe doit faire au moins 12 caractères (laissez vide si vous avez déjà un compte).',
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
    router.replace(`/login?email=${encodeURIComponent(result.user.email)}`);
  });

  if (tokenFromUrl === '') {
    return (
      <main className="flex min-h-screen items-center justify-center bg-canvas px-4 py-12">
        <div className="w-full max-w-md animate-page-in space-y-6 rounded-sm border border-line bg-paper p-8">
          <header>
            <h1 className="font-display text-2xl font-medium text-ink">
              Lien d'invitation invalide
            </h1>
            <p className="mt-2 text-sm text-ink-mute">
              Ouvrez le lien envoyé par email pour rejoindre l'organisation. Si le lien ne
              fonctionne pas, demandez à l'administrateur de vous renvoyer une invitation.
            </p>
          </header>
          <Button asChild variant="outline">
            <Link href="/login">Retour à la connexion</Link>
          </Button>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-4 py-12">
      <div className="w-full max-w-md animate-page-in space-y-8 rounded-sm border border-line bg-paper p-8">
        <header>
          <p className="eyebrow mb-2">ERP Compta OHADA</p>
          <h1 className="font-display text-3xl font-medium tracking-tight text-ink">
            Accepter l'invitation
          </h1>
          <p className="mt-2 text-sm text-ink-mute">
            Si vous avez déjà un compte ERP Compta, laissez les champs vides. Sinon, choisissez un
            mot de passe pour créer votre compte et rejoindre l'organisation.
          </p>
        </header>

        <form onSubmit={onSubmit} noValidate className="space-y-5">
          <FormError error={accept.error} />
          <input type="hidden" {...form.register('token')} />

          <div className="space-y-1.5">
            <Label htmlFor="password">Mot de passe (nouveau compte uniquement)</Label>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              {...form.register('password')}
            />
            {form.formState.errors.password !== undefined && (
              <p className="text-xs text-critical-ink">
                {form.formState.errors.password.message}
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="firstName">Prénom</Label>
              <Input id="firstName" {...form.register('firstName')} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lastName">Nom</Label>
              <Input id="lastName" {...form.register('lastName')} />
            </div>
          </div>

          <Button type="submit" className="press w-full" disabled={accept.isPending}>
            {accept.isPending ? 'Acceptation…' : "Accepter l'invitation"}
          </Button>
        </form>
      </div>
    </main>
  );
}
