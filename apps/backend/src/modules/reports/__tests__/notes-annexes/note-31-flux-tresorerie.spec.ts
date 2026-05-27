import type { CashFlowReport } from '../../services/cash-flow.service';
import type { NoteId } from '../../services/notes-annexes';
import { buildHarness } from './test-helpers';

function buildReport(overrides: Partial<CashFlowReport> = {}): CashFlowReport {
  return {
    fromDate: '2026-01-01',
    toDate: '2026-12-31',
    openingCash: '300.00',
    closingCash: '1000.00',
    netCashVariation: '700.00',
    coherenceCheck: '0.00',
    sections: [
      {
        code: 'ZA',
        label: 'FLUX DE TRÉSORERIE PROVENANT DES ACTIVITÉS OPÉRATIONNELLES',
        subtotal: '1000.00',
        postes: [
          { code: 'FA', label: "Capacité d'Autofinancement Globale (CAFG)", amount: '900.00' },
          { code: 'FB', label: '- Variation des stocks', amount: '50.00' },
          { code: 'FC', label: '- Variation des créances ordinaires', amount: '20.00' },
          { code: 'FD', label: '+ Variation des dettes ordinaires', amount: '30.00' },
          { code: 'FE', label: "Variation du BFR liée à l'activité", amount: '100.00' },
        ],
      },
      {
        code: 'ZB',
        label: "FLUX DE TRÉSORERIE PROVENANT DES OPÉRATIONS D'INVESTISSEMENT",
        subtotal: '-500.00',
        postes: [
          { code: 'FF', label: "- Acquisitions d'immobilisations", amount: '-700.00' },
          { code: 'FG', label: '- Charges immobilisées', amount: '0.00' },
          { code: 'FH', label: "+ Cessions d'immobilisations", amount: '150.00' },
          { code: 'FI', label: '+ Encaissements créances cessions', amount: '50.00' },
          { code: 'FJ', label: "+ Subventions d'investissement reçues", amount: '0.00' },
        ],
      },
      {
        code: 'ZC',
        label: 'FLUX DE TRÉSORERIE PROVENANT DU FINANCEMENT',
        subtotal: '200.00',
        postes: [
          { code: 'FK', label: '+ Augmentations de capital', amount: '0.00' },
          { code: 'FL', label: '- Dividendes versés', amount: '-100.00' },
          { code: 'FM', label: '+ Boni de liquidation / apports', amount: '0.00' },
          { code: 'FN', label: 'Sous-total capitaux propres', amount: '-100.00' },
          { code: 'FO', label: '+ Nouveaux emprunts', amount: '400.00' },
          { code: 'FP', label: '- Remboursements emprunts', amount: '-100.00' },
          { code: 'FQ', label: 'Sous-total dettes financières', amount: '300.00' },
        ],
      },
    ],
    ...overrides,
  };
}

describe('Note 31 — Tableau des Flux de Trésorerie (ventilé)', () => {
  it('rend tous les postes FA..FQ + sous-totaux ZA/ZB/ZC + ZD/ZG/ZH', async () => {
    const { service, cashFlowMock, request } = buildHarness();
    cashFlowMock.getCashFlow.mockResolvedValue(buildReport());

    const n31 = await service.getNote(request, 'N31' as NoteId);

    expect(n31.applicable).toBe(true);

    const byKey = new Map(n31.rows.map((r) => [r.key, r]));

    // Trésorerie (ZD ouverture, ZG clôture, ZH variation).
    expect(byKey.get('ZD')?.values.montantN).toBe('300.00');
    expect(byKey.get('ZD')?.values.kind).toBe('tresorerie');
    expect(byKey.get('ZG')?.values.montantN).toBe('1000.00');
    expect(byKey.get('ZG')?.values.kind).toBe('tresorerie');
    expect(byKey.get('ZH')?.values.montantN).toBe('700.00');

    // Sous-totaux de section.
    expect(byKey.get('ZA')?.values.montantN).toBe('1000.00');
    expect(byKey.get('ZA')?.values.kind).toBe('subtotal');
    expect(byKey.get('ZB')?.values.montantN).toBe('-500.00');
    expect(byKey.get('ZC')?.values.montantN).toBe('200.00');

    // Postes individuels (échantillon représentatif).
    expect(byKey.get('FA')?.values.montantN).toBe('900.00');
    expect(byKey.get('FA')?.values.kind).toBe('poste');
    expect(byKey.get('FE')?.values.montantN).toBe('100.00');
    expect(byKey.get('FF')?.values.montantN).toBe('-700.00');
    expect(byKey.get('FQ')?.values.montantN).toBe('300.00');

    // Le handler a propagé chacun des codes (FA..FQ = 17 postes,
    // 3 sous-totaux ZA/ZB/ZC, 1 ZD ouverture, 1 ZG clôture, 1 ZH).
    expect(n31.rows.length).toBe(17 + 3 + 3);

    // Le service de cash-flow doit être appelé avec previous = N-1.
    expect(cashFlowMock.getCashFlow).toHaveBeenCalledWith(
      request.organizationId,
      '2026-01-01',
      '2026-12-31',
      '2025-01-01',
      '2025-12-31',
    );
  });

  it("expose le comparatif N-1 sur la trésorerie et les sous-totaux quand disponible", async () => {
    const { service, cashFlowMock, request } = buildHarness();
    cashFlowMock.getCashFlow.mockResolvedValue(
      buildReport({
        previous: {
          fromDate: '2025-01-01',
          toDate: '2025-12-31',
          openingCash: '150.00',
          closingCash: '300.00',
          netCashVariation: '150.00',
          operationalFlow: '800.00',
          investmentFlow: '-400.00',
          financingFlow: '-250.00',
        },
      }),
    );

    const n31 = await service.getNote(request, 'N31' as NoteId);
    const byKey = new Map(n31.rows.map((r) => [r.key, r]));

    expect(byKey.get('ZD')?.values.montantPrecedent).toBe('150.00');
    expect(byKey.get('ZG')?.values.montantPrecedent).toBe('300.00');
    expect(byKey.get('ZH')?.values.montantPrecedent).toBe('150.00');
    expect(byKey.get('ZA')?.values.montantPrecedent).toBe('800.00');
    expect(byKey.get('ZB')?.values.montantPrecedent).toBe('-400.00');
    expect(byKey.get('ZC')?.values.montantPrecedent).toBe('-250.00');
    // Pas de comparatif par poste — la propriété est volontairement absente.
    expect(byKey.get('FA')?.values.montantPrecedent).toBeUndefined();
  });

  it('reporte le coherenceCheck du service sur la ligne ZH', async () => {
    const { service, cashFlowMock, request } = buildHarness();
    cashFlowMock.getCashFlow.mockResolvedValue(
      buildReport({ coherenceCheck: '12.34' }),
    );

    const n31 = await service.getNote(request, 'N31' as NoteId);
    const zh = n31.rows.find((r) => r.key === 'ZH');
    expect(zh?.values.source).toBe('coherenceCheck=12.34');
  });
});
