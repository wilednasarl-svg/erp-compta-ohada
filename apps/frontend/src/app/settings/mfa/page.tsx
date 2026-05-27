'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { ShieldAlert, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
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
  | { kind: 'activated'; backupCodes: ReadonlyArray<string> }
  | { kind: 'disabling' };

export default function MfaSettingsPage() {
  const [stage, setStage] = useState<Stage>({ kind: 'idle' });

  const setupMutation = useApiMutation<MfaSetupResponse, void>(() =>
    api.post<MfaSetupResponse>('/auth/mfa/setup'),
  );

  const verifyMutation = useApiMutation((values: VerifyValues) =>
    api.post<MfaActivationResponse>('/auth/mfa/verify', { code: values.code }),
  );

  // Disabling requires a fresh TOTP / backup code (step-up). The form
  // collects it; we don't trigger this from the idle state without one.
  const disableMutation = useApiMutation(async (values: VerifyValues) => {
    await api.post('/auth/mfa/disable', { code: values.code });
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

  const disableForm = useForm<VerifyValues>({
    resolver: zodResolver(verifySchema),
    defaultValues: { code: '' },
  });

  const onDisable = disableForm.handleSubmit(async (values) => {
    await disableMutation.mutateAsync(values);
    setStage({ kind: 'idle' });
    disableForm.reset();
  });

  return (
    <main className="container max-w-2xl space-y-8 py-10">
      <div className="animate-page-in space-y-8">
        <header className="space-y-2">
          <p className="eyebrow mb-2">Sécurité</p>
          <h1 className="font-display text-4xl font-medium tracking-tight text-ink">
            Authentification à deux facteurs
          </h1>
          <p className="text-sm text-ink-mute">
            Ajoutez une étape de vérification à la connexion via une application TOTP (Google
            Authenticator, 1Password, Authy, …).
          </p>
        </header>

        {stage.kind === 'idle' ? (
          <section className="space-y-4">
            <div className="border-b border-line pb-3">
              <div className="flex flex-row items-start gap-3">
                <ShieldAlert className="mt-1 h-5 w-5 text-ink-mute" />
                <div className="space-y-1">
                  <h2 className="font-display text-xl font-medium text-ink">MFA non activée</h2>
                  <p className="text-sm text-ink-mute">
                    Sans MFA, votre compte est protégé uniquement par votre mot de passe. Activer
                    la MFA ajoute un code à 6 chiffres demandé à chaque connexion.
                  </p>
                </div>
              </div>
            </div>
            <div className="space-y-4">
              <FormError error={setupMutation.error} />
              <div className="flex gap-3">
                <Button
                  className="press"
                  onClick={() => void onActivate()}
                  disabled={setupMutation.isPending}
                >
                  {setupMutation.isPending ? 'Préparation…' : 'Activer la MFA'}
                </Button>
                {/*
                 * The "Désactiver" button reveals a code-entry form rather
                 * than calling disable directly: the backend now requires a
                 * fresh TOTP / backup code as a step-up factor (prevents a
                 * leaked access token from stripping MFA).
                 */}
                <Button
                  variant="ghost"
                  className="press"
                  onClick={() => setStage({ kind: 'disabling' })}
                >
                  Désactiver
                </Button>
              </div>
            </div>
          </section>
        ) : null}

        {stage.kind === 'disabling' ? (
          <section className="space-y-4">
            <div className="border-b border-line pb-3">
              <h2 className="font-display text-xl font-medium text-ink">
                Confirmer la désactivation
              </h2>
              <p className="mt-1 text-sm text-ink-mute">
                Saisissez un code TOTP courant ou un code de secours pour confirmer la
                désactivation de la MFA. Cette vérification empêche qu&apos;un jeton d&apos;accès
                volé désactive silencieusement votre second facteur.
              </p>
            </div>
            <form onSubmit={onDisable} noValidate className="space-y-4">
              <FormError error={disableMutation.error} />
              <div className="space-y-2">
                <Label htmlFor="disable-code">Code</Label>
                <Input
                  id="disable-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  autoFocus
                  {...disableForm.register('code')}
                />
                {disableForm.formState.errors.code !== undefined ? (
                  <p className="text-xs text-critical-ink">
                    {disableForm.formState.errors.code.message}
                  </p>
                ) : null}
              </div>
              <div className="flex gap-3">
                <Button
                  type="submit"
                  variant="destructive"
                  className="press"
                  disabled={disableMutation.isPending}
                >
                  {disableMutation.isPending ? 'Désactivation…' : 'Désactiver la MFA'}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="press"
                  onClick={() => setStage({ kind: 'idle' })}
                  disabled={disableMutation.isPending}
                >
                  Annuler
                </Button>
              </div>
            </form>
          </section>
        ) : null}

        {stage.kind === 'setup' ? (
          <section className="space-y-4">
            <div className="border-b border-line pb-3">
              <h2 className="font-display text-xl font-medium text-ink">
                Scanner le code dans votre application
              </h2>
              <p className="mt-1 text-sm text-ink-mute">
                Ouvrez votre application d&apos;authentification et ajoutez un nouveau compte.
                Saisissez ensuite le code à 6 chiffres généré pour confirmer.
              </p>
            </div>
            <div className="space-y-4">
              <div className="space-y-2 rounded-sm border border-line bg-sunk/30 p-4 font-mono text-xs break-all text-ink">
                <div>
                  <span className="text-ink-mute">URI otpauth :</span>
                  <br />
                  {stage.setup.otpauthUri}
                </div>
                <div>
                  <span className="text-ink-mute">Secret (saisie manuelle) :</span>
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
                    <p className="text-xs text-critical-ink">
                      {verifyForm.formState.errors.code.message}
                    </p>
                  ) : null}
                </div>
                <div className="flex gap-3">
                  <Button type="submit" className="press" disabled={verifyMutation.isPending}>
                    {verifyMutation.isPending ? 'Vérification…' : 'Confirmer'}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="press"
                    onClick={() => setStage({ kind: 'idle' })}
                    disabled={verifyMutation.isPending}
                  >
                    Annuler
                  </Button>
                </div>
              </form>
            </div>
          </section>
        ) : null}

        {stage.kind === 'activated' ? (
          <section className="space-y-4">
            <div className="border-b border-line pb-3">
              <div className="flex flex-row items-start gap-3">
                <ShieldCheck className="mt-1 h-5 w-5 text-accent-ink" />
                <div className="space-y-1">
                  <h2 className="font-display text-xl font-medium text-ink">MFA activée</h2>
                  <p className="text-sm text-ink-mute">
                    Conservez ces 10 codes de secours dans un endroit sûr. Chacun fonctionne une
                    seule fois et remplace le code TOTP si vous perdez l&apos;accès à votre
                    application. Cette liste ne sera pas affichée à nouveau.
                  </p>
                </div>
              </div>
            </div>
            <div className="space-y-4">
              <ul className="grid grid-cols-2 gap-2 rounded-sm border border-line bg-sunk/30 p-4 font-mono text-sm text-ink">
                {stage.backupCodes.map((code) => (
                  <li key={code} className="select-all">
                    {code}
                  </li>
                ))}
              </ul>
              <div>
                <Button asChild variant="outline" className="press">
                  <Link href="/dashboard">Retour au tableau de bord</Link>
                </Button>
              </div>
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}
