'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { CheckCircle2, KeyRound, Loader2, QrCode, ShieldAlert, ShieldCheck } from 'lucide-react';
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

function StepCircle({ n, done = false }: { n: number; done?: boolean }) {
  return (
    <span
      className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-mono text-xs font-medium tabular-nums ${
        done ? 'bg-accent text-canvas' : 'border border-line-strong bg-paper text-ink'
      }`}
    >
      {done ? <CheckCircle2 className="h-4 w-4" strokeWidth={2} /> : n}
    </span>
  );
}

function SecurityCallout() {
  return (
    <div className="flex items-start gap-3 rounded-sm border border-info/30 bg-info-soft/60 p-4">
      <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-info-ink" strokeWidth={1.75} />
      <div className="space-y-1 text-sm">
        <p className="font-medium text-info-ink">Pourquoi activer la MFA ?</p>
        <p className="text-xs leading-relaxed text-info-ink/80">
          La double authentification protège votre compte même si votre mot de passe est compromis.
          Elle est requise pour accéder aux fonctions sensibles (clôture, journal d&apos;audit,
          export FEC).
        </p>
      </div>
    </div>
  );
}

export default function MfaSettingsPage() {
  const [stage, setStage] = useState<Stage>({ kind: 'idle' });

  const setupMutation = useApiMutation<MfaSetupResponse, void>(() =>
    api.post<MfaSetupResponse>('/auth/mfa/setup'),
  );

  const verifyMutation = useApiMutation((values: VerifyValues) =>
    api.post<MfaActivationResponse>('/auth/mfa/verify', { code: values.code }),
  );

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

  const codeInputCls =
    'h-12 text-center font-mono text-2xl tracking-[0.5em] tabular-nums';

  return (
    <main className="container mx-auto max-w-2xl px-4 py-10 md:py-14">
      <div className="animate-page-in space-y-8">
        <header>
          <p className="eyebrow mb-2">Organisation · Sécurité</p>
          <h1 className="font-display text-3xl font-medium tracking-tight text-ink">
            Double authentification
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-ink-mute">
            Protection renforcée de votre compte par code TOTP (Google Authenticator, 1Password,
            Authy, …).
          </p>
        </header>

        {stage.kind === 'idle' ? (
          <section className="space-y-6">
            <SecurityCallout />

            <div className="rounded-sm border border-line bg-paper p-5">
              <div className="flex items-start gap-3">
                <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-warn-soft">
                  <ShieldAlert className="h-5 w-5 text-warn-ink" strokeWidth={1.75} />
                </span>
                <div className="min-w-0 flex-1 space-y-1">
                  <h2 className="font-display text-xl font-medium text-ink">MFA non activée</h2>
                  <p className="text-sm leading-relaxed text-ink-soft">
                    Sans MFA, votre compte est protégé uniquement par votre mot de passe. Activer la
                    MFA ajoute un code à 6 chiffres demandé à chaque connexion.
                  </p>
                </div>
              </div>
              <FormError error={setupMutation.error} className="mt-4" />
              <div className="mt-5 flex flex-wrap gap-3">
                <Button
                  className="press"
                  onClick={() => void onActivate()}
                  disabled={setupMutation.isPending}
                >
                  {setupMutation.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <ShieldCheck className="mr-2 h-4 w-4" strokeWidth={1.75} />
                  )}
                  {setupMutation.isPending ? 'Préparation…' : 'Activer la MFA'}
                </Button>
                <Button
                  variant="ghost"
                  className="press"
                  onClick={() => setStage({ kind: 'disabling' })}
                >
                  J&apos;ai déjà activé — désactiver
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
                Saisissez un code TOTP courant ou un code de secours pour confirmer. Cette
                vérification empêche qu&apos;un jeton d&apos;accès volé désactive silencieusement
                votre second facteur.
              </p>
            </div>
            <form
              onSubmit={onDisable}
              noValidate
              className="space-y-4 rounded-sm border border-line bg-paper p-5"
            >
              <FormError error={disableMutation.error} />
              <div className="space-y-2">
                <Label htmlFor="disable-code">Code de vérification</Label>
                <Input
                  id="disable-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  autoFocus
                  className={codeInputCls}
                  {...disableForm.register('code')}
                />
                {disableForm.formState.errors.code !== undefined ? (
                  <p className="text-xs text-critical-ink">
                    {disableForm.formState.errors.code.message}
                  </p>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-3">
                <Button
                  type="submit"
                  variant="destructive"
                  className="press"
                  disabled={disableMutation.isPending}
                >
                  {disableMutation.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : null}
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
          <section className="space-y-6">
            <div className="border-b border-line pb-3">
              <h2 className="font-display text-xl font-medium text-ink">
                Configurer votre application
              </h2>
              <p className="mt-1 text-sm text-ink-mute">
                Deux étapes : scanner le code, puis vérifier avec un code généré.
              </p>
            </div>

            <ol className="space-y-6">
              <li className="flex gap-4">
                <StepCircle n={1} />
                <div className="min-w-0 flex-1 space-y-3">
                  <div>
                    <p className="text-sm font-medium text-ink">
                      Scanner le code dans votre application
                    </p>
                    <p className="mt-1 text-xs text-ink-mute">
                      Ouvrez votre application d&apos;authentification et ajoutez un nouveau compte.
                    </p>
                  </div>
                  <div className="flex flex-col gap-3 md:flex-row md:items-start">
                    <div className="flex h-40 w-40 shrink-0 items-center justify-center rounded-sm border border-line bg-white p-4">
                      <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 text-ink-mute">
                        <QrCode className="h-10 w-10" strokeWidth={1.25} />
                        <span className="text-2xs uppercase tracking-wider">QR placeholder</span>
                      </div>
                    </div>
                    <div className="min-w-0 flex-1 space-y-2 rounded-sm border border-line bg-sunk/40 p-3 text-xs">
                      <div className="space-y-1">
                        <div className="eyebrow">URI otpauth</div>
                        <div className="break-all font-mono text-[11px] text-ink select-all">
                          {stage.setup.otpauthUri}
                        </div>
                      </div>
                      <div className="space-y-1 border-t border-line pt-2">
                        <div className="eyebrow flex items-center gap-1.5">
                          <KeyRound className="h-3 w-3" strokeWidth={1.5} /> Secret (saisie manuelle)
                        </div>
                        <div className="break-all font-mono text-xs tracking-wider text-ink select-all">
                          {stage.setup.secret}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </li>

              <li className="flex gap-4">
                <StepCircle n={2} />
                <div className="min-w-0 flex-1 space-y-3">
                  <div>
                    <p className="text-sm font-medium text-ink">Saisir le code généré</p>
                    <p className="mt-1 text-xs text-ink-mute">
                      Entrez le code à 6 chiffres affiché par votre application pour confirmer.
                    </p>
                  </div>
                  <form onSubmit={onVerify} noValidate className="space-y-4">
                    <FormError error={verifyMutation.error} />
                    <div className="space-y-2">
                      <Label htmlFor="code" className="sr-only">
                        Code à 6 chiffres
                      </Label>
                      <Input
                        id="code"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        autoFocus
                        placeholder="000 000"
                        maxLength={8}
                        className={codeInputCls}
                        {...verifyForm.register('code')}
                      />
                      {verifyForm.formState.errors.code !== undefined ? (
                        <p className="text-xs text-critical-ink">
                          {verifyForm.formState.errors.code.message}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap gap-3">
                      <Button type="submit" className="press" disabled={verifyMutation.isPending}>
                        {verifyMutation.isPending ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : null}
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
              </li>
            </ol>
          </section>
        ) : null}

        {stage.kind === 'activated' ? (
          <section className="space-y-6">
            <div className="flex items-start gap-3 rounded-sm border border-accent/40 bg-accent-soft/70 p-5">
              <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-canvas">
                <ShieldCheck className="h-5 w-5" strokeWidth={2} />
              </span>
              <div className="min-w-0 flex-1 space-y-1">
                <h2 className="font-display text-xl font-medium text-accent-ink">MFA activée</h2>
                <p className="text-sm leading-relaxed text-accent-ink/85">
                  Votre compte est désormais protégé par un second facteur. Un code TOTP sera
                  demandé à chaque connexion.
                </p>
              </div>
            </div>

            <div className="space-y-3">
              <div className="border-b border-line pb-3">
                <h3 className="font-display text-base font-medium text-ink">Codes de secours</h3>
                <p className="mt-1 text-xs text-ink-mute">
                  Conservez ces 10 codes dans un endroit sûr. Chacun fonctionne une seule fois et
                  remplace le code TOTP si vous perdez l&apos;accès à votre application.{' '}
                  <span className="font-medium text-critical-ink">
                    Cette liste ne sera pas affichée à nouveau.
                  </span>
                </p>
              </div>
              <ul className="grid grid-cols-2 gap-2 rounded-sm border border-line bg-sunk/40 p-4 font-mono text-sm text-ink">
                {stage.backupCodes.map((code) => (
                  <li
                    key={code}
                    className="select-all rounded-xs bg-paper px-2 py-1.5 text-center tabular-nums tracking-wider"
                  >
                    {code}
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex flex-wrap gap-3">
              <Button asChild className="press">
                <Link href="/dashboard">Retour au tableau de bord</Link>
              </Button>
              <Button
                variant="ghost"
                className="press"
                onClick={() => setStage({ kind: 'disabling' })}
              >
                Désactiver la MFA
              </Button>
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}
