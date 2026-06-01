import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError, api } from '@/lib/api-client';

import { AnnualPackageButton } from './annual-package-button';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AnnualPackageButton', () => {
  it('déploie le formulaire Du/Au au clic', async () => {
    render(<AnnualPackageButton orgId="org-1" />);
    await userEvent.click(screen.getByRole('button', { name: /Dossier annuel/ }));

    expect(screen.getByLabelText(/date de début/)).toBeInTheDocument();
    expect(screen.getByLabelText(/date de fin/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Générer le ZIP/ })).toBeInTheDocument();
  });

  it('appelle annual-package.zip avec les dates', async () => {
    const spy = vi.spyOn(api, 'download').mockResolvedValue(undefined);
    render(<AnnualPackageButton orgId="org-42" />);

    await userEvent.click(screen.getByRole('button', { name: /Dossier annuel/ }));
    await userEvent.click(screen.getByRole('button', { name: /Générer le ZIP/ }));

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    const url = spy.mock.calls[0]?.[0] ?? '';
    expect(url).toContain('/organizations/org-42/reports/annual-package.zip');
    expect(url).toContain('fromDate=');
    expect(url).toContain('toDate=');
  });

  it('affiche une erreur si la génération échoue (plus de silence)', async () => {
    vi.spyOn(api, 'download').mockRejectedValue(
      new ApiError(500, { code: 'ERR', message: 'boom' }),
    );
    render(<AnnualPackageButton orgId="org-1" />);

    await userEvent.click(screen.getByRole('button', { name: /Dossier annuel/ }));
    await userEvent.click(screen.getByRole('button', { name: /Générer le ZIP/ }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/a échoué/);
    });
  });
});
