'use client';

/**
 * `/chart-of-accounts/import` — import d'un plan comptable depuis CSV / XLSX.
 * Route net-new (n'altère pas la page Plan comptable existante).
 */

import { AppShell } from '@/components/app-shell';

import { ChartImportPanel } from '../_import/chart-import-panel';

export default function ChartImportPage() {
  return (
    <AppShell>
      <div className="space-y-6">
        <header className="border-b border-line pb-5">
          <p className="text-2xs uppercase tracking-wider text-ink-mute">Référentiel · Plan comptable</p>
          <h1 className="mt-1 font-display text-3xl font-medium tracking-tight text-ink">
            Importer un plan comptable
          </h1>
        </header>
        <ChartImportPanel />
      </div>
    </AppShell>
  );
}
