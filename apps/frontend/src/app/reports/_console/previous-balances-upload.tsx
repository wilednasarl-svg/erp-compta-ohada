'use client';

/**
 * Sous-section COMPACTE « Comparaison & TFT (optionnel) » — extraite de
 * `balance-upload-console.tsx` pour rester sous la limite de 800 lignes.
 *
 * Permet de charger une balance d'exercice antérieur (N-1) et, optionnellement,
 * N-2, chacune avec sa date de clôture. Le chargement d'une balance N-1 débloque
 * côté backend les états Comparative, Pluriannuelle et TFT.
 *
 * Le parsing réutilise la même logique que la dropzone principale (CSV/Excel) ;
 * ce composant est purement présentationnel/contrôlé : il reçoit l'état et les
 * callbacks depuis le parent.
 */

import { CheckCircle2, Layers } from 'lucide-react';
import { useRef } from 'react';

import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

import type { BalanceParsed } from './balance-parse';

interface PreviousBalanceSlotProps {
  readonly label: string;
  readonly hint: string;
  readonly inputLabel: string;
  readonly parsed: BalanceParsed | null;
  readonly asAtDate: string;
  readonly onFile: (file: File) => void;
  readonly onAsAtDateChange: (value: string) => void;
}

function PreviousBalanceSlot({
  label,
  hint,
  inputLabel,
  parsed,
  asAtDate,
  onFile,
  onAsAtDateChange,
}: PreviousBalanceSlotProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="flex flex-col gap-2 rounded-sm border border-line bg-paper px-3 py-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-ink">{label}</span>
        <span className="text-2xs text-ink-mute">{hint}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="press inline-flex h-8 items-center rounded-sm border border-line-strong bg-sunk/40 px-3 text-xs font-medium text-ink-soft transition-colors duration-fast hover:bg-sunk hover:text-ink"
        >
          {parsed !== null ? 'Remplacer le fichier' : 'Choisir un fichier'}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.txt,.tsv,.xlsx,.xls"
          className="sr-only"
          aria-label={inputLabel}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
            e.target.value = '';
          }}
        />
        <Input
          type="date"
          value={asAtDate}
          onChange={(e) => onAsAtDateChange(e.target.value)}
          aria-label={`Date de clôture — ${label}`}
          className="h-8 w-36 font-mono text-xs tabular-nums"
        />
        {parsed !== null && (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-accent-ink">
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
            {parsed.rows.length.toLocaleString('fr-FR')} comptes
          </span>
        )}
      </div>
    </div>
  );
}

interface PreviousBalancesUploadProps {
  readonly parsedPrev: BalanceParsed | null;
  readonly prevAsAtDate: string;
  readonly onPrevFile: (file: File) => void;
  readonly onPrevAsAtDateChange: (value: string) => void;
  readonly parsedPrev2: BalanceParsed | null;
  readonly prev2AsAtDate: string;
  readonly onPrev2File: (file: File) => void;
  readonly onPrev2AsAtDateChange: (value: string) => void;
  readonly error: string | null;
}

export function PreviousBalancesUpload({
  parsedPrev,
  prevAsAtDate,
  onPrevFile,
  onPrevAsAtDateChange,
  parsedPrev2,
  prev2AsAtDate,
  onPrev2File,
  onPrev2AsAtDateChange,
  error,
}: PreviousBalancesUploadProps) {
  return (
    <div className="rounded-md border border-line bg-paper">
      <div className="border-b border-line px-4 py-3">
        <p className="inline-flex items-center gap-2 font-display text-sm font-medium tracking-tight text-ink">
          <Layers className="h-4 w-4 shrink-0 text-ink-mute" strokeWidth={1.5} />
          Comparaison &amp; TFT{' '}
          <span className="text-xs font-normal text-ink-mute">(optionnel)</span>
        </p>
        <p className="mt-0.5 text-xs text-ink-soft">
          Chargez la balance de l&apos;exercice antérieur (N-1) pour débloquer les états{' '}
          <strong>Comparative</strong>, <strong>Pluriannuelle</strong> et <strong>TFT</strong>. La
          balance N-2 ajoute une 3ᵉ colonne à la vue pluriannuelle.
        </p>
      </div>
      <div className="grid gap-px bg-line sm:grid-cols-2">
        <div className="bg-paper p-3">
          <PreviousBalanceSlot
            label="Balance N-1"
            hint="Exercice précédent"
            inputLabel="Fichier de balance N-1"
            parsed={parsedPrev}
            asAtDate={prevAsAtDate}
            onFile={onPrevFile}
            onAsAtDateChange={onPrevAsAtDateChange}
          />
        </div>
        <div className="bg-paper p-3">
          <PreviousBalanceSlot
            label="Balance N-2"
            hint="Facultatif"
            inputLabel="Fichier de balance N-2"
            parsed={parsedPrev2}
            asAtDate={prev2AsAtDate}
            onFile={onPrev2File}
            onAsAtDateChange={onPrev2AsAtDateChange}
          />
        </div>
      </div>
      {error !== null && (
        <p
          className={cn(
            'border-t border-critical/40 bg-critical-soft/60 px-4 py-2 text-xs text-critical-ink',
          )}
        >
          {error}
        </p>
      )}
    </div>
  );
}
