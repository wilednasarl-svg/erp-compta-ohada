'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { ShieldAlert, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
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
import type { MfaActivationResponse, MfaSetupResponse } from '@/types/auth';

/*
 * `/settings/mfa` — TOTP enrollment surface (BE-AUTH-MFA-01..03).
 *
 * UX is a small state machine:
 *
 *   IDLE ───┬─ "Activer" ─► SETUP   (otpauth URI + secret rendered)
 *           │                  │
 *           │            verify code
 *           │                  ▼
 *           │              ACTIVATED (backup codes shown ONCE)
 *           │
 *           └─ "Désactiver" ─► IDLE  (after `mfa/disable`)
 *
 * We deliberately render the otpauth URI as text + a clickable link
 * rather than embedding a QR-code library — keeps the bundle small for
 * MVP. Authenticator apps on phones can scan a QR drawn from this URI
 * via any QR generator (e.g. the user copies the URI into their app's
 * manual-entry field). A future iteration can drop in `qrcode.react`
 * without touching the API surface.
 */

const verifySchema = z.object({
  code: z
    .string()
    .min(6, 'Code requis (6 chiffres).')
    .max(8, 'Code trop long.')
    .regex(/^[A-Za-z0-9-]+$/u, 'Code invalide.'),
});
type VerifyValues = z.infer<typeof verifySchema>;

type Stage =
  | { kind: 'idle' }
  | { kind: 'setup'; setup: MfaSetupResponse }
  | { kind: 'activated'; backupCodes: ReadonlyArray<string> };

export default function MfaSettingsPage() {
  const [stage, setStage] = useState<Stage>({ kind: 'idle' });

  const setupMutation = useApiMutation<MfaSetupResponse, void>(() =>
    api.post<MfaSetupResponse>('/auth/mfa/setup'),
  );

  const verifyMutation = useApiMutation((values: VerifyValues) =>
    api.post<MfaActivationResponse>('/auth/mfa/verify', { code: values.code }),
  );

  const disableMutation = useApiMutation<undefined, void>(async () => {
    await api.post('/auth/mfa/disable');
    return undefined;
  });

  const verifyForm = useForm<VerifyValues>({
    resolver: zodResolver(verifySchema),
    defaultValues: { code: '' },
  });

  const onActivate = async (): Promise<void> => {
    const result = await setupMutation.mutateAsync();
    setStage({ kind: 'setup', setup: result });
    verifyForm.reset();
  };

  const onVerify = verifyForm.handleSubmit(async (values) => {
    const result = await verifyMutation.mutateAsync(values);
    setStage({ kind: 'activated', backupCodes: result.backupCodes });
  });

  const onDisable = async (): Promise<void> => {
    await disableMutation.mutateAsync();
    setStage({ kind: 'idle' });
  };

  return (
    <main className="container max-w-2xl space-y-6 py-10">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Authentification à deux facteurs</h1>
        <p className="text-sm text-muted-foreground">
          Ajoutez une étape de vérification à la connexion via une application TOTP (Google
          Authenticator, 1Password, Authy, …).
        </p>
      </header>

      {stage.kind === 'idle' ? (
        <Card>
          <CardHeader className="flex flex-row items-start gap-3 space-y-0">
            <ShieldAlert className="mt-1 h-5 w-5 text-muted-foreground" />
            <div className="space-y-1">
              <CardTitle>MFA non activée</CardTitle>
              <CardDescription>
                Sans MFA, votre compte est protégé uniquement par votre mot de passe. Activer la MFA
                ajoute un code à 6 chiffres demandé à chaque connexion.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <FormError error={setupMutation.error} />
          </CardContent>
          <CardFooter className="gap-3">
            <Button onClick={() => void onActivate()} disabled={setupMutation.isPending}>
              {setupMutation.isPending ? 'Préparation…' : 'Activer la MFA'}
            </Button>
            {/*
             * Disable lives in idle too so a user who already activated
             * in this session (then refreshed) can still turn it off
             * without re-running setup. Hidden until backend tells us
             * MFA is on — currently the simplest signal is the absence
             * of a 4xx from disable, but for MVP we just keep the
             * button available and surface 4xx via FormError below.
             */}
            <Button
              variant="ghost"
              onClick={() => void onDisable()}
              disabled={disableMutation.isPending}
            >
              {disableMutation.isPending ? 'Désactivation…' : 'Désactiver'}
            </Button>
          </CardFooter>
          <CardContent>
            <FormError error={disableMutation.error} />
          </CardContent>
        </Card>
      ) : null}

      {stage.kind === 'setup' ? (
        <Card>
          <CardHeader>
            <CardTitle>Scanner le code dans votre application</CardTitle>
            <CardDescription>
              Ouvrez votre application d'authentification et ajoutez un nouveau compte. Saisissez
              ensuite le code à 6 chiffres généré pour confirmer.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2 rounded-md border bg-muted/30 p-4 font-mono text-xs break-all">
              <div>
                <span className="text-muted-foreground">URI otpauth :</span>
                <br />
                {stage.setup.otpauthUri}
              </div>
              <div>
                <span className="text-muted-foreground">Secret (saisie manuelle) :</span>
                <br />
                {stage.setup.secret}
              </div>
            </div>

            <form onSubmit={onVerify} noValidate className="space-y-4">
              <FormError error={verifyMutation.error} />
              <div className="space-y-2">
                <Label htmlFor="code">Code à 6 chiffres</Label>
                <Input
                  id="code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  autoFocus
                  {...verifyForm.register('code')}
                />
                {verifyForm.formState.errors.code !== undefined ? (
                  <p className="text-xs text-destructive">
                    {verifyForm.formState.errors.code.message}
                  </p>
                ) : null}
              </div>
              <div className="flex gap-3">
                <Button type="submit" disabled={verifyMutation.isPending}>
                  {verifyMutation.isPending ? 'Vérification…' : 'Confirmer'}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setStage({ kind: 'idle' })}
                  disabled={verifyMutation.isPending}
                >
                  Annuler
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      {stage.kind === 'activated' ? (
        <Card>
          <CardHeader className="flex flex-row items-start gap-3 space-y-0">
            <ShieldCheck className="mt-1 h-5 w-5 text-emerald-600" />
            <div className="space-y-1">
              <CardTitle>MFA activée</CardTitle>
              <CardDescription>
                Conservez ces 10 codes de secours dans un endroit sûr. Chacun fonctionne une seule
                fois et remplace le code TOTP si vous perdez l'accès à votre application. Cette
                liste ne sera pas affichée à nouveau.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <ul className="grid grid-cols-2 gap-2 rounded-md border bg-muted/30 p-4 font-mono text-sm">
              {stage.backupCodes.map((code) => (
                <li key={code} className="select-all">
                  {code}
                </li>
              ))}
            </ul>
          </CardContent>
          <CardFooter>
            <Button asChild variant="outline">
              <Link href="/dashboard">Retour au tableau de bord</Link>
            </Button>
          </CardFooter>
        </Card>
      ) : null}
    </main>
  );
}
