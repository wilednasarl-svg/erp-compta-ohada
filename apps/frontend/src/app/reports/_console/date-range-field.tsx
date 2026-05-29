'use client';

/**
 * DateRangeField — champ de période unique pour les 16 panneaux d'état.
 * Remplace les paires `<input type=date>` + presets réimplémentées partout.
 *
 * Déclencheur compact (résumé lisible) → popover : rail de presets à gauche,
 * calendrier à droite, plus la saisie manuelle exacte (un comptable connaît
 * souvent la date au jour près). Deux sémantiques via l'union `PeriodValue` :
 *   - range  : plage Du / Au.
 *   - as-at  : date d'arrêté + début d'exercice de rattachement.
 */

import { CalendarDays } from 'lucide-react';
import { useState } from 'react';

import { cn } from '@/lib/utils';

import { Calendar } from './calendar';
import { Popover } from './popover';
import { matchPreset, presetsFor, summarizePeriod } from './presets';
import type { PeriodValue } from './types';

interface DateRangeFieldProps {
  readonly value: PeriodValue;
  readonly onChange: (next: PeriodValue) => void;
  readonly label: string;
}

const fieldLabelCls = 'text-2xs uppercase tracking-wider text-ink-soft';
const dateInputCls =
  'h-9 w-40 rounded-sm border border-line-strong bg-paper px-2.5 font-mono text-sm tabular-nums text-ink ' +
  'focus-visible:border-accent focus-visible:shadow-input focus-visible:outline-none';

export function DateRangeField({ value, onChange, label }: DateRangeFieldProps) {
  const activePreset = matchPreset(value);

  return (
    <Popover
      label={label}
      panelClassName="w-[420px] max-w-[calc(100vw-2rem)]"
      trigger={({ ref, onClick, ...aria }) => (
        <button
          ref={ref}
          type="button"
          onClick={onClick}
          {...aria}
          className="inline-flex h-9 items-center gap-2 rounded-sm border border-line-strong bg-paper px-3 text-sm text-ink transition-colors duration-fast hover:border-ink focus-visible:border-accent focus-visible:shadow-input focus-visible:outline-none"
        >
          <CalendarDays className="h-4 w-4 text-ink-mute" strokeWidth={1.5} aria-hidden />
          <span className="font-mono tabular-nums">{summarizePeriod(value)}</span>
        </button>
      )}
    >
      {(close) => (
        <div className="flex gap-4">
          <PresetRail value={value} activePreset={activePreset} onPick={onChange} />
          <div className="space-y-3">
            {value.kind === 'range' ? (
              <RangeBody value={value} onChange={onChange} />
            ) : (
              <AsAtBody value={value} onChange={onChange} />
            )}
            <div className="flex justify-end border-t border-line pt-2">
              <button
                type="button"
                onClick={close}
                className="rounded-sm bg-accent px-3 py-1.5 text-sm font-medium text-paper transition-colors duration-fast hover:bg-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
              >
                Appliquer
              </button>
            </div>
          </div>
        </div>
      )}
    </Popover>
  );
}

// ─── Rail de presets ────────────────────────────────────────────────────

interface PresetRailProps {
  readonly value: PeriodValue;
  readonly activePreset: string | null;
  readonly onPick: (next: PeriodValue) => void;
}

function PresetRail({ value, activePreset, onPick }: PresetRailProps) {
  const now = new Date();
  return (
    <div className="w-[130px] shrink-0 border-r border-line pr-3" role="group" aria-label="Raccourcis">
      <ul className="space-y-0.5">
        {presetsFor(value.kind).map((preset) => {
          const isActive = preset.key === activePreset;
          return (
            <li key={preset.key}>
              <button
                type="button"
                aria-pressed={isActive}
                onClick={() => onPick(preset.resolve(now))}
                className={cn(
                  'w-full rounded-sm px-2 py-1.5 text-left text-sm transition-colors duration-fast',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                  isActive
                    ? 'bg-accent-soft font-medium text-accent-ink'
                    : 'text-ink-soft hover:bg-sunk hover:text-ink',
                )}
              >
                {preset.label}
                {preset.describe && (
                  <span className="mt-0.5 block text-2xs text-ink-mute">{preset.describe(now)}</span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ─── Corps « plage Du / Au » ─────────────────────────────────────────────

function RangeBody({
  value,
  onChange,
}: {
  readonly value: Extract<PeriodValue, { kind: 'range' }>;
  readonly onChange: (next: PeriodValue) => void;
}) {
  return (
    <>
      <Calendar
        mode="range"
        start={value.fromDate}
        // from == to ⇒ borne haute pas encore choisie : permet la sélection en 2 clics.
        end={value.toDate && value.toDate !== value.fromDate ? value.toDate : ''}
        onRangeChange={({ start, end }) =>
          onChange({ kind: 'range', fromDate: start, toDate: end || start })
        }
      />
      <div className="flex items-end gap-2">
        <label className="space-y-1">
          <span className={fieldLabelCls}>Du</span>
          <input
            type="date"
            value={value.fromDate}
            onChange={(e) => onChange({ ...value, fromDate: e.target.value })}
            className={dateInputCls}
          />
        </label>
        <label className="space-y-1">
          <span className={fieldLabelCls}>Au</span>
          <input
            type="date"
            value={value.toDate}
            onChange={(e) => onChange({ ...value, toDate: e.target.value })}
            className={dateInputCls}
          />
        </label>
      </div>
    </>
  );
}

// ─── Corps « arrêté » ─────────────────────────────────────────────────────

function AsAtBody({
  value,
  onChange,
}: {
  readonly value: Extract<PeriodValue, { kind: 'as-at' }>;
  readonly onChange: (next: PeriodValue) => void;
}) {
  return (
    <>
      <Calendar
        mode="single"
        selected={value.asAtDate}
        onSelect={(iso) => onChange({ ...value, asAtDate: iso })}
      />
      <div className="flex items-end gap-2">
        <label className="space-y-1">
          <span className={fieldLabelCls}>Début exercice</span>
          <input
            type="date"
            value={value.fiscalYearStartDate}
            onChange={(e) => onChange({ ...value, fiscalYearStartDate: e.target.value })}
            className={dateInputCls}
          />
        </label>
        <label className="space-y-1">
          <span className={fieldLabelCls}>Arrêté au</span>
          <input
            type="date"
            value={value.asAtDate}
            onChange={(e) => onChange({ ...value, asAtDate: e.target.value })}
            className={dateInputCls}
          />
        </label>
      </div>
    </>
  );
}
