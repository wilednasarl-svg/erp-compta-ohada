import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { DateRangeField } from './date-range-field';
import { defaultPeriod, previousYearEndIso, previousYearStartIso } from './presets';
import type { AsAtValue, PeriodValue } from './types';

const RANGE: PeriodValue = { kind: 'range', fromDate: '2026-02-14', toDate: '2026-03-03' };
const AS_AT: AsAtValue = {
  kind: 'as-at',
  asAtDate: '2026-05-29',
  fiscalYearStartDate: '2026-01-01',
};

describe('DateRangeField — popover (AC-P1, P4)', () => {
  it('ouvre un popover au clic sans recharger, avec rail de presets + calendrier', async () => {
    render(<DateRangeField value={RANGE} onChange={vi.fn()} label="Période" />);
    expect(screen.queryByRole('dialog')).toBeNull();

    await userEvent.click(screen.getByRole('button'));

    const dialog = screen.getByRole('dialog', { name: 'Période' });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Raccourcis' })).toBeInTheDocument();
    expect(screen.getByRole('grid', { name: 'Calendrier' })).toBeInTheDocument();
  });

  it('ferme avec Échap et rend le focus au déclencheur (AC-P4)', async () => {
    render(<DateRangeField value={RANGE} onChange={vi.fn()} label="Période" />);
    const trigger = screen.getByRole('button');
    await userEvent.click(trigger);
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await userEvent.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});

describe('DateRangeField — presets (AC-P2, P3)', () => {
  it('marque le preset actif quand la valeur lui correspond exactement (AC-P3)', async () => {
    // defaultPeriod('range') === preset « Cet exercice » résolu aujourd'hui.
    render(<DateRangeField value={defaultPeriod('range')} onChange={vi.fn()} label="Période" />);
    await userEvent.click(screen.getByRole('button'));

    const active = screen.getByRole('button', { name: /Cet exercice/, pressed: true });
    expect(active).toBeInTheDocument();
  });

  it('applique « Clôture N-1 » : arrêté 31/12 N-1 + exercice 01/01 N-1 (AC-P2)', async () => {
    const onChange = vi.fn();
    render(<DateRangeField value={AS_AT} onChange={onChange} label="Arrêté" />);
    await userEvent.click(screen.getByRole('button'));

    await userEvent.click(screen.getByRole('button', { name: /Clôture N-1/ }));

    expect(onChange).toHaveBeenCalledWith({
      kind: 'as-at',
      asAtDate: previousYearEndIso(),
      fiscalYearStartDate: previousYearStartIso(),
    });
  });

  it('applique un preset de plage et émet la période résolue', async () => {
    const onChange = vi.fn();
    render(<DateRangeField value={RANGE} onChange={onChange} label="Période" />);
    await userEvent.click(screen.getByRole('button'));

    await userEvent.click(screen.getByRole('button', { name: /Exercice N-1/ }));

    expect(onChange).toHaveBeenCalledTimes(1);
    const emitted = onChange.mock.calls[0]![0] as PeriodValue;
    expect(emitted.kind).toBe('range');
  });
});
