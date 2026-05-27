import type { CashFlowReport } from '../../services/cash-flow.service';
import type { NoteId } from '../../services/notes-annexes';
import { buildHarness } from './test-helpers';

function buildReport(overrides: Partial<CashFlowReport> = {}): CashFlowReport {
  return {
    fromDate: '2026-01-01',
    toDate: '2026-12-31',
    openingCash: '300.00', // ZA
    operatingFlows: {
      code: 'ZB',
      label: 'Flux de trésorerie provenant des activités opérationnelles',
      subtotal: '1000.00',
      postes: [
        { code: 'FA', label: "Capacité d'Autofinancement Globale (CAFG)", amount: '900.00' },
        { code: 'FB', label: "Variation de l'actif circulant HAO", amount: '0.00' },
        { code: 'FC', label: 'Variation des stocks', amount: '50.00' },
        { code: 'FD', label: 'Variation des créances et emplois assimilés', amount: '20.00' },
        { code: 'FE', label: 'Variation du passif circulant', amount: '30.00' },
      ],
    },
    investingFlows: {
      code: 'ZC',
      label: "Flux de trésorerie provenant des opérations d'investissement",
      subtotal: '-500.00',
      postes: [
        { code: 'FF', label: "Décaissements liés aux acquisitions d'immobilisations", amount: '-700.00' },
        { code: 'FG', label: "Décaissements immobilisations financières", amount: '0.00' },
        { code: 'FH', label: "Encaissements cessions d'immobilisations", amount: '150.00' },
        { code: 'FI', label: 'Encaissements cessions immobilisations financières', amount: '50.00' },
        { code: 'FJ', label: 'Variation des créances sur cessions', amount: '0.00' },
      ],
    },
    financingFlowsEquity: {
      code: 'ZD',
      label: 'Flux de trésorerie provenant des capitaux propres',
      subtotal: '-100.00',
      postes: [
        { code: 'FK', label: 'Augmentations de capital', amount: '0.00' },
        { code: 'FL', label: "Subventions d'investissement reçues", amount: '0.00' },
        { code: 'FM', label: 'Prélèvements sur le capital', amount: '0.00' },
        { code: 'FN', label: 'Dividendes versés', amount: '-100.00' },
      ],
    },
    financingFlowsDebt: {
      code: 'ZE',
      label: 'Flux de trésorerie provenant des capitaux étrangers',
      subtotal: '300.00',
      postes: [
        { code: 'FO', label: 'Emprunts nouveaux', amount: '400.00' },
        { code: 'FP', label: 'Autres dettes financières', amount: '0.00' },
        { code: 'FQ', label: 'Remboursements des emprunts', amount: '-100.00' },
      ],
    },
    financingFlowsTotal: '200.00', // ZF = ZD + ZE
    netCashVariation: '700.00', // ZG = ZB + ZC + ZF
    closingCash: '1000.00', // ZH = ZA + ZG
    coherenceCheck: '0.00',
    ...overrides,
  };
}

describe('Note 31 — Tableau des Flux de Trésorerie (ventilé)', () => {
  it('rend tous les postes FA..FQ + sous-totaux ZB/ZC/ZD/ZE + ZA/ZF/ZG/ZH conformes p.34', async () => {
    const { service, cashFlowMock, request } = buildHarness();
    cashFlowMock.getCashFlow.mockResolvedValue(buildReport());

    const n31 = await service.getNote(request, 'N31' as NoteId);

    expect(n31.applicable).toBe(true);

    const byKey = new Map(n31.rows.map((r) => [r.key, r]));

    // Trésorerie : ZA (ouverture), ZH (clôture).
    expect(byKey.get('ZA')?.values.montantN).toBe('300.00');
    expect(byKey.get('ZA')?.values.kind).toBe('tresorerie');
    expect(byKey.get('ZH')?.values.montantN).toBe('1000.00');
    expect(byKey.get('ZH')?.values.kind).toBe('tresorerie');

    // Sous-totaux de section.
    expect(byKey.get('ZB')?.values.montantN).toBe('1000.00');
    expect(byKey.get('ZB')?.values.kind).toBe('subtotal');
    expect(byKey.get('ZC')?.values.montantN).toBe('-500.00');
    expect(byKey.get('ZD')?.values.montantN).toBe('-100.00');
    expect(byKey.get('ZE')?.values.montantN).toBe('300.00');

    // Sous-total ZF = ZD + ZE.
    expect(byKey.get('ZF')?.values.montantN).toBe('200.00');
    expect(byKey.get('ZF')?.values.kind).toBe('subtotal');

    // ZG = variation totale.
    expect(byKey.get('ZG')?.values.montantN).toBe('700.00');
    expect(byKey.get('ZG')?.values.kind).toBe('total');

    // Postes individuels (échantillon).
    expect(byKey.get('FA')?.values.montantN).toBe('900.00');
    expect(byKey.get('FA')?.values.kind).toBe('poste');
    expect(byKey.get('FE')?.values.montantN).toBe('30.00');
    expect(byKey.get('FF')?.values.montantN).toBe('-700.00');
    expect(byKey.get('FQ')?.values.montantN).toBe('-100.00');

    // Total lignes : 17 postes FA..FQ + 4 sous-totaux ZB/ZC/ZD/ZE
    //                + ZA + ZF + ZG + ZH = 25.
    expect(n31.rows.length).toBe(17 + 4 + 4);

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
          operatingFlow: '800.00',
          investingFlow: '-400.00',
          financingFlowEquity: '-150.00',
          financingFlowDebt: '-100.00',
          financingFlowTotal: '-250.00',
        },
      }),
    );

    const n31 = await service.getNote(request, 'N31' as NoteId);
    const byKey = new Map(n31.rows.map((r) => [r.key, r]));

    expect(byKey.get('ZA')?.values.montantPrecedent).toBe('150.00');
    expect(byKey.get('ZH')?.values.montantPrecedent).toBe('300.00');
    expect(byKey.get('ZG')?.values.montantPrecedent).toBe('150.00');
    expect(byKey.get('ZB')?.values.montantPrecedent).toBe('800.00');
    expect(byKey.get('ZC')?.values.montantPrecedent).toBe('-400.00');
    expect(byKey.get('ZD')?.values.montantPrecedent).toBe('-150.00');
    expect(byKey.get('ZE')?.values.montantPrecedent).toBe('-100.00');
    expect(byKey.get('ZF')?.values.montantPrecedent).toBe('-250.00');
    // Pas de comparatif par poste — la propriété est volontairement absente.
    expect(byKey.get('FA')?.values.montantPrecedent).toBeUndefined();
  });

  it('reporte le coherenceCheck du service sur la ligne ZG', async () => {
    const { service, cashFlowMock, request } = buildHarness();
    cashFlowMock.getCashFlow.mockResolvedValue(
      buildReport({ coherenceCheck: '12.34' }),
    );

    const n31 = await service.getNote(request, 'N31' as NoteId);
    const zg = n31.rows.find((r) => r.key === 'ZG');
    expect(zg?.values.source).toBe('coherenceCheck=12.34');
  });
});
