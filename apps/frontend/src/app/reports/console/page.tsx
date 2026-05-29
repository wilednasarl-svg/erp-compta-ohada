'use client';

/**
 * `/reports/console` — Console des états : parcours unifié (guide ① Période →
 * ② Périmètre → ③ Générer) servant le profil occasionnel comme l'expert.
 *
 * Coquille générique + sélecteur d'état. Chaque état est une console autonome
 * branchée sur son endpoint réel, démontrant que le framework couvre les deux
 * sémantiques de période : Bilan (`as-at`) et Balance générale (`range`).
 */

import { useState } from 'react';

import { AppShell } from '@/components/app-shell';
import { cn } from '@/lib/utils';
import { useCurrentOrg } from '@/stores/auth-store';

import { BalanceConsole } from '../_console/balance-console';
import { BilanConsole } from '../_console/bilan-console';
import { CrConsole } from '../_console/cr-console';

type ConsoleReport = 'balance-sheet' | 'profit-loss' | 'trial-balance';

const REPORTS: ReadonlyArray<{ readonly key: ConsoleReport; readonly label: string }> = [
  { key: 'balance-sheet', label: 'Bilan' },
  { key: 'profit-loss', label: 'Compte de résultat' },
  { key: 'trial-balance', label: 'Balance générale' },
];

export default function ReportConsolePage() {
  const org = useCurrentOrg();
  const orgId = org?.id ?? '';
  const [active, setActive] = useState<ConsoleReport>('balance-sheet');

  return (
    <AppShell>
      <div className="space-y-6">
        <header className="border-b border-line pb-5">
          <p className="text-2xs uppercase tracking-wider text-ink-mute">États · Reporting OHADA</p>
          <h1 className="mt-1 font-display text-3xl font-medium tracking-tight text-ink">
            Console des états
          </h1>
          <p className="mt-2 max-w-[68ch] text-sm leading-relaxed text-ink-soft">
            Un parcours unique pour générer chaque état : sélectionnez la période, ajustez le
            périmètre, puis générez. La conformité est contrôlée sur le rapport produit.
          </p>
        </header>

        <div className="flex flex-wrap gap-1 border-b border-line" role="tablist" aria-label="État à générer">
          {REPORTS.map((r) => {
            const isActive = r.key === active;
            return (
              <button
                key={r.key}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setActive(r.key)}
                className={cn(
                  '-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors duration-fast',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                  isActive
                    ? 'border-accent text-ink'
                    : 'border-transparent text-ink-mute hover:text-ink',
                )}
              >
                {r.label}
              </button>
            );
          })}
        </div>

        {active === 'balance-sheet' ? (
          <BilanConsole orgId={orgId} />
        ) : active === 'profit-loss' ? (
          <CrConsole orgId={orgId} />
        ) : (
          <BalanceConsole orgId={orgId} />
        )}
      </div>
    </AppShell>
  );
}
