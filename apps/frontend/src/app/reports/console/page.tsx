'use client';

/**
 * `/reports/console` — Console des états : parcours unifié (guide ① Période →
 * ② Périmètre → ③ Générer) servant le profil occasionnel comme l'expert.
 *
 * Coquille générique + sélecteur d'état. Chaque état est une console autonome
 * branchée sur son endpoint réel, démontrant que le framework couvre les deux
 * sémantiques de période : Bilan (`as-at`) et Balance générale (`range`).
 */

import { useRouter, useSearchParams } from 'next/navigation';

import { AppShell } from '@/components/app-shell';
import { cn } from '@/lib/utils';
import { useCurrentOrg } from '@/stores/auth-store';

import { AgingConsole } from '../_console/aging-console';
import { AnnexeConsole } from '../_console/annexe-console';
import { AnnualPackageButton } from '../_console/annual-package-button';
import { BalanceConsole } from '../_console/balance-console';
import { BalanceUploadConsole } from '../_console/balance-upload-console';
import { BilanConsole } from '../_console/bilan-console';
import { BilanDiagnosticConsole } from '../_console/bilan-diagnostic-console';
import { CashTrendConsole } from '../_console/cash-trend-console';
import { ComparativeConsole } from '../_console/comparative-console';
import { CrConsole } from '../_console/cr-console';
import { GlConsole } from '../_console/gl-console';
import { ImportDiagnosticConsole } from '../_console/import-diagnostic-console';
import { MarginConsole } from '../_console/margin-console';
import { MultiYearConsole } from '../_console/multi-year-console';
import { RatiosConsole } from '../_console/ratios-console';
import { SigConsole } from '../_console/sig-console';
import { TftConsole } from '../_console/tft-console';

type ConsoleReport =
  | 'balance-sheet'
  | 'profit-loss'
  | 'sig'
  | 'tft'
  | 'annexe'
  | 'ratios'
  | 'trial-balance'
  | 'comparative-balance'
  | 'multi-year-balance'
  | 'margin-by-axis'
  | 'general-ledger'
  | 'aging-balance'
  | 'cash-trend'
  | 'bilan-diagnostic'
  | 'import-diagnostic'
  | 'balance-upload';

interface ConsoleReportDef {
  readonly key: ConsoleReport;
  readonly label: string;
  /** Sous-titre court affiché sous l'onglet actif (contexte). */
  readonly tagline: string;
}

interface ConsoleGroup {
  readonly title: string;
  readonly items: ReadonlyArray<ConsoleReportDef>;
}

/**
 * États groupés par famille — une nav à plat de 16 onglets s'enroulait sans
 * hiérarchie. Le regroupement donne du rythme et un repère (comme la liasse).
 */
const CONSOLE_GROUPS: ReadonlyArray<ConsoleGroup> = [
  {
    title: 'États OHADA',
    items: [
      { key: 'balance-sheet', label: 'Bilan', tagline: 'Patrimoine à une date' },
      { key: 'profit-loss', label: 'Compte de résultat', tagline: 'Charges & produits' },
      { key: 'sig', label: 'SIG', tagline: 'Soldes intermédiaires' },
      { key: 'tft', label: 'TFT', tagline: 'Flux de trésorerie' },
      { key: 'annexe', label: 'Annexe', tagline: 'Notes réglementaires' },
    ],
  },
  {
    title: 'Analyses',
    items: [
      { key: 'ratios', label: 'Ratios', tagline: 'Structure & rentabilité' },
      { key: 'margin-by-axis', label: 'Marge analytique', tagline: 'Par axe (chantier…)' },
      { key: 'cash-trend', label: 'Tendance trésorerie', tagline: 'Évolution mensuelle' },
    ],
  },
  {
    title: 'Balances',
    items: [
      { key: 'trial-balance', label: 'Balance générale', tagline: 'Soldes par compte' },
      { key: 'comparative-balance', label: 'Comparative', tagline: 'N vs N-1' },
      { key: 'multi-year-balance', label: 'Pluriannuelle', tagline: 'N / N-1 / N-2' },
      { key: 'aging-balance', label: 'Balance âgée', tagline: 'Ancienneté clients/fourn.' },
      { key: 'balance-upload', label: 'Balance importée', tagline: 'Bilan/CR depuis un fichier' },
    ],
  },
  {
    title: 'Détail & contrôle',
    items: [
      { key: 'general-ledger', label: 'Grand livre', tagline: 'Détail d’un compte' },
      { key: 'bilan-diagnostic', label: 'Bilan diagnostic', tagline: 'Contrôle pré-clôture' },
      { key: 'import-diagnostic', label: 'Diagnostic d’import', tagline: 'Contrôle avant commit' },
    ],
  },
];

const ALL_REPORTS: ReadonlyArray<ConsoleReportDef> = CONSOLE_GROUPS.flatMap((g) => g.items);

/** Garde de type : un `?view=` inconnu retombe sur le Bilan (défaut). */
function isConsoleReport(value: string | null): value is ConsoleReport {
  return value !== null && ALL_REPORTS.some((r) => r.key === value);
}

export default function ReportConsolePage() {
  const org = useCurrentOrg();
  const orgId = org?.id ?? '';
  const router = useRouter();
  const searchParams = useSearchParams();
  // L'état actif vit dans l'URL (`?view=ratios`) : chaque état devient
  // adressable — lien direct depuis la nav, partage, retour navigateur.
  // Dérivé (pas de useState) : un clic nav vers `?view=…` alors qu'on est
  // déjà sur la console resynchronise l'affichage sans re-mount.
  const requested = searchParams.get('view');
  const active: ConsoleReport = isConsoleReport(requested) ? requested : 'balance-sheet';
  const selectReport = (key: ConsoleReport) => {
    router.replace(`/reports/console?view=${key}`, { scroll: false });
  };
  const current = ALL_REPORTS.find((r) => r.key === active);

  return (
    <AppShell>
      <div className="space-y-6">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-5">
          <div>
            <p className="text-2xs uppercase tracking-wider text-ink-mute">États · Reporting OHADA</p>
            <h1 className="mt-1 font-display text-3xl font-medium tracking-tight text-ink">
              Console des états
            </h1>
            <p className="mt-2 max-w-[68ch] text-sm leading-relaxed text-ink-soft">
              Un parcours unique pour générer chaque état : sélectionnez la période, ajustez le
              périmètre, puis générez. La conformité est contrôlée sur le rapport produit.
            </p>
          </div>
          <AnnualPackageButton orgId={orgId} />
        </header>

        <nav className="space-y-3" aria-label="État à générer">
          {CONSOLE_GROUPS.map((group) => (
            <div key={group.title} className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <span className="w-28 shrink-0 text-2xs uppercase tracking-wider text-ink-mute">
                {group.title}
              </span>
              <div className="flex flex-wrap gap-1.5">
                {group.items.map((r) => {
                  const isActive = r.key === active;
                  return (
                    <button
                      key={r.key}
                      type="button"
                      aria-pressed={isActive}
                      onClick={() => selectReport(r.key)}
                      className={cn(
                        'rounded-full border px-3 py-1 text-sm transition-colors duration-fast',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                        isActive
                          ? 'border-accent bg-accent-soft font-medium text-accent-ink'
                          : 'border-line-strong bg-paper text-ink-soft hover:border-ink hover:text-ink',
                      )}
                    >
                      {r.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {current && (
          <p className="-mt-1 text-xs text-ink-mute" aria-live="polite">
            Vous consultez : <span className="font-medium text-ink-soft">{current.label}</span> — {current.tagline}
          </p>
        )}

        {active === 'balance-sheet' ? (
          <BilanConsole orgId={orgId} />
        ) : active === 'profit-loss' ? (
          <CrConsole orgId={orgId} />
        ) : active === 'sig' ? (
          <SigConsole orgId={orgId} />
        ) : active === 'tft' ? (
          <TftConsole orgId={orgId} />
        ) : active === 'annexe' ? (
          <AnnexeConsole orgId={orgId} />
        ) : active === 'ratios' ? (
          <RatiosConsole orgId={orgId} />
        ) : active === 'comparative-balance' ? (
          <ComparativeConsole orgId={orgId} />
        ) : active === 'multi-year-balance' ? (
          <MultiYearConsole orgId={orgId} />
        ) : active === 'margin-by-axis' ? (
          <MarginConsole orgId={orgId} />
        ) : active === 'general-ledger' ? (
          <GlConsole orgId={orgId} />
        ) : active === 'aging-balance' ? (
          <AgingConsole orgId={orgId} />
        ) : active === 'cash-trend' ? (
          <CashTrendConsole orgId={orgId} />
        ) : active === 'bilan-diagnostic' ? (
          <BilanDiagnosticConsole orgId={orgId} />
        ) : active === 'import-diagnostic' ? (
          <ImportDiagnosticConsole orgId={orgId} />
        ) : active === 'balance-upload' ? (
          <BalanceUploadConsole orgId={orgId} />
        ) : (
          <BalanceConsole orgId={orgId} />
        )}
      </div>
    </AppShell>
  );
}
