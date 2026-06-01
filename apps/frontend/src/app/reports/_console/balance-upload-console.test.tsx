import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { api } from '@/lib/api-client';
import type { BalanceSheetReport, ProfitLossReport } from '@/types/reports';

import { BalanceUploadConsole } from './balance-upload-console';

/**
 * Tests CSV uniquement — le chemin Excel charge dynamiquement le module `xlsx`
 * (`await import('xlsx')`) et n'est volontairement pas couvert ici pour éviter
 * d'embarquer cette dépendance dans le runner de test.
 */

// `FromBalanceResult` minimal valide renvoyé par le backend mocké.
const BILAN: BalanceSheetReport = {
  asAtDate: '2026-12-31',
  actifMasses: [],
  passifMasses: [],
  unclassified: [],
  totals: { actif: '0.00', passif: '0.00', difference: '0.00' },
  netResultIncorporated: null,
  difference: '0.00',
};

const CR: ProfitLossReport = {
  fromDate: '2026-01-01',
  toDate: '2026-12-31',
  charges: [],
  produits: [],
  lines: [],
  totalCharges: '0.00',
  totalProduits: '0.00',
  resultat: '0.00',
};

const FROM_BALANCE = {
  bilan: BILAN,
  cr: CR,
  unusualBalances: [],
  stockBreakdown: { lines: [], totalBrut: '0.00', depreciation: '0.00', totalNet: '0.00' },
  trialBalance: {
    fromDate: '2026-01-01',
    toDate: '2026-12-31',
    rows: [],
    totals: {
      openingDebit: '0.00',
      openingCredit: '0.00',
      periodDebit: '0.00',
      periodCredit: '0.00',
      endingDebit: '0.00',
      endingCredit: '0.00',
    },
  },
  sig: { fromDate: '2026-01-01', toDate: '2026-12-31', charges: [], produits: [], soldes: [] },
  ratios: { asAtDate: '2026-12-31', fiscalYearStartDate: '2026-01-01', ratios: [] },
  annexe: { asAtDate: '2026-12-31', fiscalYearStartDate: '2026-01-01', notes: [] },
};

// Balance CSV simple : 2 comptes équilibrés (∑Débit = ∑Crédit = 1000).
const CSV_CONTENT = ['Compte;Libellé;Solde Débiteur;Solde Créditeur', '601000;Achats;1000;0', '401000;Fournisseurs;0;1000'].join(
  '\n',
);

function renderWithClient(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function uploadCsv(): File {
  return new File([CSV_CONTENT], 'balance.csv', { type: 'text/csv' });
}

describe('BalanceUploadConsole', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('affiche la zone de dépôt', () => {
    renderWithClient(<BalanceUploadConsole orgId="org-1" />);

    expect(
      screen.getByText(/Glisser-déposer une balance CSV ou Excel/),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Fichier de balance')).toBeInTheDocument();
  });

  it('parse un CSV déposé et affiche les lignes + l’indicateur d’équilibre', async () => {
    renderWithClient(<BalanceUploadConsole orgId="org-1" />);

    const input = screen.getByLabelText('Fichier de balance');
    await userEvent.upload(input, uploadCsv());

    // Les codes de compte parsés s'affichent dans l'aperçu.
    await waitFor(() => expect(screen.getByText('601000')).toBeInTheDocument());
    expect(screen.getByText('401000')).toBeInTheDocument();

    // Contrôle d'équilibre du fichier uploadé (∑D = ∑C → équilibrée).
    expect(screen.getByText('Équilibrée')).toBeInTheDocument();
  });

  it('appelle api.post vers /reports/from-balance au clic sur « Générer »', async () => {
    const postSpy = vi
      .spyOn(api, 'post')
      .mockResolvedValue(FROM_BALANCE as unknown as never);

    renderWithClient(<BalanceUploadConsole orgId="org-1" />);

    const input = screen.getByLabelText('Fichier de balance');
    await userEvent.upload(input, uploadCsv());

    await waitFor(() => expect(screen.getByText('601000')).toBeInTheDocument());

    const generate = screen.getByRole('button', { name: /Générer les états/ });
    await userEvent.click(generate);

    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));
    const [path, body] = postSpy.mock.calls[0] ?? [];
    expect(path).toBe('/organizations/org-1/reports/from-balance');
    expect(body).toMatchObject({
      asAtDate: expect.any(String),
      rows: expect.arrayContaining([
        expect.objectContaining({ code: '601000' }),
        expect.objectContaining({ code: '401000' }),
      ]),
    });
  });

  it('expose les onglets des états dérivés et affiche la Balance générale', async () => {
    vi.spyOn(api, 'post').mockResolvedValue(FROM_BALANCE as unknown as never);

    renderWithClient(<BalanceUploadConsole orgId="org-1" />);
    await userEvent.upload(screen.getByLabelText('Fichier de balance'), uploadCsv());
    await waitFor(() => expect(screen.getByText('601000')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /Générer les états/ }));

    await waitFor(() => expect(screen.getByRole('button', { name: /^SIG$/ })).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /^Ratios$/ })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Balance générale/ }));
    await waitFor(() => expect(screen.getByText(/Balance équilibrée/)).toBeInTheDocument());
  });
});
