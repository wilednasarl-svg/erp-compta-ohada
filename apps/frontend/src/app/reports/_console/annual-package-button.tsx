'use client';

/**
 * Dossier annuel SYSCOHADA en ZIP — livrable « tout-en-un » (Balance + CR
 * officiel + Bilan + SIG + Ratios + TFT + Annexe + Aging). Branché sur
 * `GET /organizations/:org/reports/annual-package.zip`.
 *
 * Porté du monolithe `/reports` vers la console modulaire, avec gestion
 * d'erreur explicite (le legacy laissait passer un échec sans retour).
 */

import { Loader2, Package, X } from 'lucide-react';
import { useState } from 'react';

import { ApiError, api } from '@/lib/api-client';

import { todayIso, yearStartIso } from './presets';

export function AnnualPackageButton({ orgId }: { readonly orgId: string }) {
  const [open, setOpen] = useState(false);
  const [fromDate, setFromDate] = useState<string>(() => yearStartIso());
  const [toDate, setToDate] = useState<string>(() => todayIso());
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const triggerDownload = async (): Promise<void> => {
    if (orgId === '') return;
    setError(null);
    setDownloading(true);
    try {
      const params = new URLSearchParams({ fromDate, toDate });
      await api.download(
        `/organizations/${orgId}/reports/annual-package.zip?${params.toString()}`,
        'dossier-annuel.zip',
      );
      setOpen(false);
    } catch (err: unknown) {
      setError(
        err instanceof ApiError && err.status === 404
          ? 'Dossier annuel indisponible pour cette période.'
          : 'La génération du dossier annuel a échoué. Réessayez.',
      );
    } finally {
      setDownloading(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-9 items-center gap-2 rounded-sm border border-accent/30 bg-accent-soft px-3 text-sm font-medium text-accent-ink transition-colors duration-fast hover:bg-accent-soft/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        <Package className="h-4 w-4" strokeWidth={1.5} aria-hidden />
        Dossier annuel · ZIP
      </button>
    );
  }

  return (
    <div className="space-y-2 rounded-md border border-line bg-paper p-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="space-y-1">
          <span className="block text-2xs uppercase tracking-wider text-ink-soft">Du</span>
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            aria-label="Dossier annuel — date de début"
            className="h-9 w-40 rounded-sm border border-line-strong bg-paper px-2 font-mono text-sm tabular-nums text-ink focus-visible:border-accent focus-visible:shadow-input focus-visible:outline-none"
          />
        </label>
        <label className="space-y-1">
          <span className="block text-2xs uppercase tracking-wider text-ink-soft">Au</span>
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            aria-label="Dossier annuel — date de fin"
            className="h-9 w-40 rounded-sm border border-line-strong bg-paper px-2 font-mono text-sm tabular-nums text-ink focus-visible:border-accent focus-visible:shadow-input focus-visible:outline-none"
          />
        </label>
        <button
          type="button"
          onClick={() => void triggerDownload()}
          disabled={downloading}
          aria-busy={downloading}
          className="inline-flex h-9 items-center gap-2 rounded-sm bg-accent px-4 text-sm font-medium text-paper transition-colors duration-fast hover:bg-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {downloading ? (
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.5} aria-hidden />
          ) : (
            <Package className="h-4 w-4" strokeWidth={1.5} aria-hidden />
          )}
          Générer le ZIP
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="inline-flex h-9 items-center gap-1.5 rounded-sm px-3 text-sm text-ink-soft transition-colors duration-fast hover:bg-sunk hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          <X className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden />
          Annuler
        </button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-critical-ink">
          {error}
        </p>
      )}
    </div>
  );
}
