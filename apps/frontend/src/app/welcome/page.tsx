import type { Metadata } from 'next';
import React from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  BookText,
  Calendar,
  ChevronRight,
  FileBarChart,
  Link2,
  PenLine,
  type LucideIcon,
} from 'lucide-react';

import { AppShell } from '@/components/app-shell';

export const metadata: Metadata = {
  title: "Guide d'utilisation — ERP Compta OHADA",
  description:
    "Guide pas à pas pour démarrer votre dossier OHADA : périodes, journaux, écritures, lettrage, états financiers.",
};

interface GuideStep {
  readonly id: string;
  readonly number: string;
  readonly title: string;
  readonly summary: string;
  readonly description: string;
  readonly href: string;
  readonly hrefLabel: string;
  readonly icon: LucideIcon;
  readonly bullets: ReadonlyArray<string>;
  readonly tip?: string;
}

const STEPS: ReadonlyArray<GuideStep> = [
  {
    id: 'periodes',
    number: '01',
    title: 'Configurer les périodes',
    summary: "Cadrez l'exercice en cours et les périodes mensuelles avant toute saisie.",
    description:
      "Définissez l'exercice fiscal (12 mois standard ou exercice à cheval), créez les périodes mensuelles, et activez la clôture progressive. Une fois une période fermée, plus aucune écriture ne pourra l'impacter — c'est une exigence OHADA pour la traçabilité.",
    href: '/accounting-periods',
    hrefLabel: 'Ouvrir les périodes',
    icon: Calendar,
    bullets: [
      'Exercice fiscal annuel avec date d’ouverture et de clôture',
      '12 périodes mensuelles ou découpage personnalisé',
      'Clôture progressive — verrouillage par période',
    ],
    tip: 'Commencez toujours par l’exercice : il conditionne le plan comptable et les états.',
  },
  {
    id: 'journaux',
    number: '02',
    title: 'Paramétrer les journaux',
    summary: 'Créez les journaux auxiliaires (JV, JA, BAN, OD) avec leurs séquences de numérotation.',
    description:
      "Chaque opération s'enregistre dans un journal dédié — ventes, achats, banque, opérations diverses. Définissez le code journal, la séquence (annuelle ou mensuelle), le compte de contrepartie par défaut, et les rôles autorisés à valider.",
    href: '/journals',
    hrefLabel: 'Configurer les journaux',
    icon: BookText,
    bullets: [
      'Journal de ventes (JV), achats (JA), banque (BAN), OD',
      'Séquence automatique JV-2026-05-001…',
      'Workflow Brouillon → Soumis → Validé → Comptabilisé',
    ],
  },
  {
    id: 'ecritures',
    number: '03',
    title: 'Saisir les premières écritures',
    summary: "Enregistrez vos opérations avec contrôle débit/crédit en temps réel.",
    description:
      "Saisissez vos écritures dans la grille équilibrée — débit/crédit auto-balancés, autocomplétion des comptes du plan SYSCOHADA, calcul automatique de la TVA. Importez aussi depuis Sage, CSV ou PDF pour rattraper l'historique.",
    href: '/entry-workflow',
    hrefLabel: 'Saisir une écriture',
    icon: PenLine,
    bullets: [
      'Grille débit/crédit avec contrôle d’équilibre',
      'Plan SYSCOHADA révisé en autocomplétion',
      'Import Sage, CSV, PDF avec détection des doublons',
    ],
    tip: 'Une écriture déséquilibrée ne peut pas être validée. Le total Débit = Total Crédit.',
  },
  {
    id: 'lettrage',
    number: '04',
    title: 'Lettrer les comptes tiers',
    summary: 'Rapprochez factures et paiements sur les comptes 411 (clients) et 401 (fournisseurs).',
    description:
      "Le lettrage associe chaque facture à son règlement, ce qui révèle automatiquement les créances et dettes restantes. Utilisez le lettrage semi-automatique par montant et date, ou pointez manuellement les opérations complexes.",
    href: '/lettering',
    hrefLabel: 'Ouvrir le lettrage',
    icon: Link2,
    bullets: [
      'Association facture ↔ paiement sur les comptes auxiliaires',
      'Lettrage semi-automatique par montant + date',
      'Balance âgée des encours non lettrés',
    ],
  },
  {
    id: 'etats',
    number: '05',
    title: 'Préparer les états financiers',
    summary: 'Générez Bilan, Compte de résultat, TFT et déclarations TVA conformes Tome 3.',
    description:
      "Une fois les écritures saisies et les comptes lettrés, vos états financiers OHADA se génèrent depuis la balance. Bilan actif/passif, Compte de résultat par destination, TFT (ex-TAFIRE), Balance générale et déclaration TVA UEMOA — tout est exportable PDF/XLSX.",
    href: '/reports',
    hrefLabel: 'Générer les états',
    icon: FileBarChart,
    bullets: [
      'Bilan, Compte de résultat, TFT conformes SYSCOHADA 2017',
      'Balance générale, balance âgée, grand livre',
      'Déclarations TVA UEMOA prêtes pour la DGI',
    ],
    tip: 'Vérifiez le score de santé avant d’éditer les états : il signale les anomalies bloquantes.',
  },
];

export default function WelcomePage() {
  return (
    <AppShell>
      <div className="animate-page-in w-full pb-24">
        {/* ── Page head ────────────────────────────────────────── */}
        <header className="border-b border-line py-12">
          <p className="eyebrow">Pilotage · Guide</p>
          <h1 className="mt-4 font-display text-4xl font-medium tracking-tight text-ink sm:text-5xl">
            Guide d'utilisation
          </h1>
          <p className="mt-4 max-w-[64ch] text-base leading-relaxed text-ink-soft">
            Cinq étapes pour démarrer un dossier OHADA, de la création de l'exercice
            jusqu'à l'édition des états financiers. Chaque étape vous renvoie vers
            l'écran concerné.
          </p>

          {/* Progress strip */}
          <div className="mt-8 flex items-center gap-3">
            <div className="flex flex-1 items-center gap-1">
              {STEPS.map((s) => (
                <div
                  key={s.id}
                  className="h-1 flex-1 rounded-full bg-sunk"
                  aria-hidden="true"
                />
              ))}
            </div>
            <span className="font-mono text-xs tabular-nums text-ink-mute">
              0 / {STEPS.length}
            </span>
          </div>
          <p className="mt-2 text-xs text-ink-mute">
            Avancez à votre rythme. Aucune obligation de tout faire dans l'ordre, mais
            l'enchaînement proposé évite les blocages.
          </p>
        </header>

        {/* ── Two columns : TOC + content ─────────────────────── */}
        <div className="grid gap-12 pt-12 lg:grid-cols-[240px_1fr] lg:gap-16">
          {/* TOC */}
          <aside className="lg:sticky lg:top-8 lg:self-start">
            <p className="eyebrow mb-4">Sommaire</p>
            <nav aria-label="Étapes du guide" className="flex flex-col gap-0.5">
              {STEPS.map((step) => (
                <a
                  key={step.id}
                  href={`#${step.id}`}
                  className="group flex items-center gap-3 rounded-sm px-2 py-2 text-sm text-ink-soft transition-colors duration-fast hover:bg-sunk hover:text-ink"
                >
                  <span className="font-mono text-2xs tabular-nums text-ink-mute group-hover:text-ink-soft">
                    {step.number}
                  </span>
                  <span className="flex-1 truncate">{step.title}</span>
                  <ChevronRight
                    className="h-3.5 w-3.5 -translate-x-1 text-ink-mute opacity-0 transition-all duration-fast group-hover:translate-x-0 group-hover:opacity-100"
                    strokeWidth={1.5}
                  />
                </a>
              ))}
            </nav>

            <div className="mt-8 rounded-sm border border-line bg-sunk p-4">
              <p className="text-xs font-medium text-ink">Besoin d'aide ?</p>
              <p className="mt-1 text-xs leading-relaxed text-ink-mute">
                Chaque module dispose d'une aide contextuelle accessible depuis l'icône
                d'information en haut à droite de l'écran.
              </p>
            </div>
          </aside>

          {/* Steps */}
          <div className="space-y-12">
            {STEPS.map((step, idx) => (
              <StepCard key={step.id} step={step} isLast={idx === STEPS.length - 1} />
            ))}

            {/* Final CTA */}
            <div className="rounded-sm border border-line bg-paper p-8">
              <p className="eyebrow">Étape suivante</p>
              <h2 className="mt-2 font-display text-xl font-medium text-ink">
                Vous êtes prêt — rendez-vous sur le tableau de bord
              </h2>
              <p className="mt-2 max-w-[56ch] text-sm leading-relaxed text-ink-soft">
                Le tableau de bord centralise vos priorités du jour, l'activité de
                l'équipe et le score de santé de votre dossier.
              </p>
              <Link
                href="/dashboard"
                className="press mt-5 inline-flex items-center gap-2 rounded-sm bg-ink px-4 py-2 text-sm font-medium text-canvas transition-opacity duration-fast hover:opacity-90"
              >
                Aller au tableau de bord
                <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.5} />
              </Link>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

interface StepCardProps {
  readonly step: GuideStep;
  readonly isLast: boolean;
}

function StepCard({ step, isLast }: StepCardProps) {
  const Icon = step.icon;
  return (
    <article
      id={step.id}
      className="scroll-mt-8 border-b border-line pb-12 last:border-b-0 last:pb-0"
      aria-labelledby={`${step.id}-title`}
    >
      <div className="flex items-start gap-5">
        {/* Number column */}
        <div className="flex flex-col items-center">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-line-strong bg-paper font-mono text-sm font-medium tabular-nums text-ink">
            {step.number}
          </span>
          {!isLast && (
            <span
              className="mt-2 hidden w-px flex-1 bg-line lg:block"
              aria-hidden="true"
            />
          )}
        </div>

        <div className="min-w-0 flex-1 space-y-5">
          {/* Header */}
          <div className="flex items-start gap-3">
            <span className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-sm bg-accent-soft">
              <Icon className="h-3.5 w-3.5 text-accent-ink" strokeWidth={1.5} />
            </span>
            <div>
              <h2
                id={`${step.id}-title`}
                className="font-display text-2xl font-medium tracking-tight text-ink"
              >
                {step.title}
              </h2>
              <p className="mt-1 max-w-[56ch] text-sm font-medium text-ink-soft">
                {step.summary}
              </p>
            </div>
          </div>

          <p className="max-w-[64ch] text-sm leading-relaxed text-ink-soft">
            {step.description}
          </p>

          <ul className="space-y-1.5">
            {step.bullets.map((b) => (
              <li key={b} className="flex items-start gap-2.5 text-sm text-ink-soft">
                <span
                  className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent"
                  aria-hidden="true"
                />
                {b}
              </li>
            ))}
          </ul>

          {step.tip !== undefined && (
            <div className="rounded-sm bg-info-soft px-3 py-2">
              <p className="text-xs leading-relaxed text-info-ink">
                <span className="font-semibold">Astuce — </span>
                {step.tip}
              </p>
            </div>
          )}

          <Link
            href={step.href}
            className="group inline-flex items-center gap-1.5 text-sm font-medium text-ink transition-colors duration-fast hover:text-accent-ink"
          >
            {step.hrefLabel}
            <ArrowRight
              className="h-3.5 w-3.5 transition-transform duration-fast group-hover:translate-x-0.5"
              strokeWidth={1.5}
            />
          </Link>
        </div>
      </div>
    </article>
  );
}
