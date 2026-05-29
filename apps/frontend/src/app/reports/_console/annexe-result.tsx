'use client';

/**
 * Rendu de l'Annexe (notes DSF) — consomme `AnnexeReport`. Liste les notes
 * réglementaires avec leur statut de production (calculée / partielle /
 * manuelle), pour signaler celles qui restent à compléter à la main.
 * Composant autonome.
 */

import type { AnnexeNote, AnnexeReport } from '@/types/reports';

import { cn } from '@/lib/utils';

const STATUS: Record<AnnexeNote['status'], { label: string; cls: string }> = {
  COMPUTED: { label: 'Calculée', cls: 'bg-accent-soft text-accent-ink' },
  PARTIAL: { label: 'Partielle', cls: 'bg-warn-soft text-warn-ink' },
  MANUAL: { label: 'À saisir', cls: 'bg-sunk text-ink-soft' },
};

export function AnnexeResult({ report }: { readonly report: AnnexeReport }) {
  const partial = report.notes.filter((n) => n.status === 'PARTIAL').length;
  const manual = report.notes.filter((n) => n.status === 'MANUAL').length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border border-line bg-sunk/40 px-4 py-2.5 text-sm text-ink-soft" role="status">
        <span>{report.notes.length} notes</span>
        {partial > 0 && <span className="text-warn-ink">{partial} partielle{partial > 1 ? 's' : ''}</span>}
        {manual > 0 && <span className="text-ink-mute">{manual} à saisir</span>}
        {partial === 0 && manual === 0 && <span className="text-accent-ink">Toutes calculées</span>}
      </div>

      <ul className="space-y-2">
        {report.notes.map((note) => {
          const status = STATUS[note.status];
          return (
            <li key={note.code} className="rounded-md border border-line bg-paper p-3">
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-2xs text-ink-mute">{note.code}</span>
                <h3 className="flex-1 text-sm font-medium text-ink">{note.title}</h3>
                <span className={cn('rounded-full px-2 py-0.5 text-2xs font-medium', status.cls)}>
                  {status.label}
                </span>
              </div>
              {note.summary && <p className="mt-1 text-xs leading-snug text-ink-soft">{note.summary}</p>}
              {note.source && <p className="mt-1 text-2xs text-ink-mute">{note.source}</p>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
