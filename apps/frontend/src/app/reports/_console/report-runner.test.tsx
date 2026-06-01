import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/lib/api-client';

import { ReportRunner } from './report-runner';
import type { PeriodValue } from './types';

const PERIOD: PeriodValue = { kind: 'range', fromDate: '2026-01-01', toDate: '2026-03-31' };

function setup(props: Partial<ComponentProps<typeof ReportRunner>> = {}) {
  const base: ComponentProps<typeof ReportRunner> = {
    orgId: 'org-1',
    mode: 'trial-balance',
    periodLabel: 'Balance générale',
    period: PERIOD,
    onPeriodChange: vi.fn(),
    status: 'ready',
    onGenerate: vi.fn(),
    children: <div>résultat</div>,
  };
  return render(<ReportRunner {...base} {...props} />);
}

describe('ReportRunner — export', () => {
  it('affiche PDF et Excel par défaut', () => {
    setup({ onExport: vi.fn() });
    expect(screen.getByRole('button', { name: /PDF/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Excel/ })).toBeInTheDocument();
  });

  it('n’affiche que le bouton supporté quand exportFormats=[xlsx]', () => {
    setup({ onExport: vi.fn(), exportFormats: ['xlsx'] });
    expect(screen.getByRole('button', { name: /Excel/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /PDF/ })).toBeNull();
  });

  it('affiche un message d’erreur si l’export échoue (404) — plus de rejet silencieux', async () => {
    const onExport = vi
      .fn()
      .mockRejectedValue(new ApiError(404, { code: 'NOT_FOUND', message: 'absent' }));
    setup({ onExport });

    await userEvent.click(screen.getByRole('button', { name: /PDF/ }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/n’est pas disponible/);
    });
    expect(onExport).toHaveBeenCalledWith('pdf');
  });

  it('n’affiche aucune erreur quand l’export réussit', async () => {
    const onExport = vi.fn().mockResolvedValue(undefined);
    setup({ onExport });

    await userEvent.click(screen.getByRole('button', { name: /Excel/ }));

    await waitFor(() => expect(onExport).toHaveBeenCalledWith('xlsx'));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
