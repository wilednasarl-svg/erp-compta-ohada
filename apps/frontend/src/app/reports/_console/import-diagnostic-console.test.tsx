import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { ApiError, api } from '@/lib/api-client';
import type { ImportDiagnosticReport, ImportSessionSummary } from '@/types/reports';

import { ImportDiagnosticConsole } from './import-diagnostic-console';

const SESSION: ImportSessionSummary = {
  id: 'sess-0001-aaaa-bbbb-cccc-dddddddddddd',
  status: 'validated',
  sourceType: 'csv',
  label: 'Balance N',
  totalLines: 42,
  errorLines: 0,
  createdAt: '2026-01-15T10:30:00.000Z',
  documentType: 'balance',
};

const REPORT: ImportDiagnosticReport = {
  session: {
    id: SESSION.id,
    label: SESSION.label,
    status: SESSION.status,
    sourceType: SESSION.sourceType,
    documentType: SESSION.documentType,
    totalLines: SESSION.totalLines,
    errorLines: SESSION.errorLines,
    createdAt: SESSION.createdAt,
  },
  trialBalance: [
    {
      accountCode: '601000',
      accountLabel: 'Achats de marchandises',
      debit: '1500000.00',
      credit: '0.00',
      balance: '1500000.00',
      sign: 'D',
      lineCount: 3,
      accountExists: true,
      autoProvisionable: false,
    },
  ],
  totals: {
    totalDebit: '1500000.00',
    totalCredit: '1500000.00',
    balanceDelta: '0.00',
    isBalanced: true,
  },
  anomalies: { critical: [], warnings: [], info: [] },
  remediationPlan: [],
  verdict: {
    status: 'conforme',
    criticalCount: 0,
    warningCount: 0,
    infoCount: 0,
    canCommit: true,
  },
};

function renderWithClient(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

/**
 * `api.get` est appelé deux fois : d'abord la liste des sessions
 * (`/imports/sessions`), puis le rapport de diagnostic
 * (`/reports/import-diagnostic/:id`). On route sur l'URL.
 */
function mockApiGet(): void {
  vi.spyOn(api, 'get').mockImplementation((path: string) => {
    if (path.includes('/imports/sessions')) {
      return Promise.resolve({ sessions: [SESSION] }) as Promise<unknown> as never;
    }
    if (path.includes('/reports/import-diagnostic/')) {
      return Promise.resolve({ report: REPORT }) as Promise<unknown> as never;
    }
    return Promise.reject(new Error(`URL non mockée : ${path}`)) as never;
  });
}

describe('ImportDiagnosticConsole', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('affiche le sélecteur de session quand des sessions éligibles existent', async () => {
    mockApiGet();
    renderWithClient(<ImportDiagnosticConsole orgId="org-1" />);

    const select = await screen.findByLabelText(/Session d’import|Session d'import/);
    expect(select).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('option', { name: /Balance N/ })).toBeInTheDocument(),
    );
  });

  it('affiche le verdict et les totaux quand le diagnostic est chargé', async () => {
    mockApiGet();
    renderWithClient(<ImportDiagnosticConsole orgId="org-1" />);

    // Verdict « conforme »
    await waitFor(() => expect(screen.getByText('conforme')).toBeInTheDocument());
    // Totaux affichés tels quels (1 500 000,00 en fr-FR)
    expect(screen.getAllByText(/1\s500\s000,00/).length).toBeGreaterThan(0);
    // Statut équilibré
    expect(screen.getByText('Équilibré')).toBeInTheDocument();
  });

  it('affiche un message d’erreur si le téléchargement du PDF rejette', async () => {
    mockApiGet();
    const downloadSpy = vi
      .spyOn(api, 'download')
      .mockRejectedValue(new ApiError(404, { code: 'NOT_FOUND', message: 'PDF introuvable' }));

    renderWithClient(<ImportDiagnosticConsole orgId="org-1" />);

    // Le bouton n'est actif qu'une fois le diagnostic chargé.
    await waitFor(() => expect(screen.getByText('conforme')).toBeInTheDocument());
    const pdfButton = screen.getByRole('button', { name: /Télécharger PDF/ });
    await waitFor(() => expect(pdfButton).toBeEnabled());

    await userEvent.click(pdfButton);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/PDF introuvable/);
    });
    expect(downloadSpy).toHaveBeenCalledTimes(1);
  });
});
