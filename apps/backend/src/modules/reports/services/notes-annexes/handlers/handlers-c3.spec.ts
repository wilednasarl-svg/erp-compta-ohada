/**
 * Smoke tests pour les handlers ajoutés en C3 — N3E, N3F, N15B, N16B,
 * N16Bbis, N27B, N34. Vérifie le shape de retour avec datasets minimaux
 * réalistes (au-delà du test générique « dataset vide » du registry spec).
 */
import { handleN15bAutresFondsPropres } from './note-15b-autres-fonds-propres';
import { handleN16bEngagementsRetraite } from './note-16b-engagements-retraite';
import { handleN16bbisSuretesDonnees } from './note-16bbis-suretes-donnees';
import { handleN27bEffectifs } from './note-27b-effectifs';
import { handleN34FicheSynthese } from './note-34-fiche-synthese';
import { handleN3eReevaluations } from './note-3e-reevaluations';
import { handleN3fChargesImmobilisees } from './note-3f-charges-immobilisees';
import type {
  NoteComputationContext,
  NoteHandlerDependencies,
  NoteSynthesisSnapshot,
} from '../types';

const CTX: NoteComputationContext = {
  organizationId: '00000000-0000-4000-8000-000000000001',
  exerciseId: 'exo-1',
  periodStart: '2026-01-01',
  periodEnd: '2026-12-31',
  fiscalYear: 2026,
};

function depsWithBalances(
  balances: ReadonlyArray<{
    accountCode: string;
    accountLabel: string;
    totalDebit: string;
    totalCredit: string;
  }>,
): NoteHandlerDependencies {
  return {
    reports: {
      accountBalancesAsAt: async () =>
        balances.map((b, i) => ({
          accountId: `id-${i}`,
          accountCode: b.accountCode,
          accountLabel: b.accountLabel,
          accountClass: Number(b.accountCode[0]) || 0,
          isOpposing: false,
          totalDebit: b.totalDebit,
          totalCredit: b.totalCredit,
        })),
    },
    assets: {
      findAllForExercise: async () => [],
      findDepreciationForYear: async () => [],
    },
    inventory: { findAllItems: async () => [] },
    accounts: { findById: async () => null },
    cashFlow: {
      getCashFlow: async (_org, fromDate, toDate) => ({
        fromDate,
        toDate,
        openingCash: '0.00',
        operatingFlows: { code: 'ZB', label: 'ZB', subtotal: '0.00', postes: [] },
        investingFlows: { code: 'ZC', label: 'ZC', subtotal: '0.00', postes: [] },
        financingFlowsEquity: { code: 'ZD', label: 'ZD', subtotal: '0.00', postes: [] },
        financingFlowsDebt: { code: 'ZE', label: 'ZE', subtotal: '0.00', postes: [] },
        financingFlowsTotal: '0.00',
        netCashVariation: '0.00',
        closingCash: '0.00',
        coherenceCheck: '0.00',
      }),
    },
  };
}

describe('Note 3E — Réévaluations', () => {
  it('renvoie une ligne par sous-compte 106 / 152 avec un TOTAL', async () => {
    const deps = depsWithBalances([
      {
        accountCode: '1062',
        accountLabel: 'Écart de réévaluation libre',
        totalDebit: '0.00',
        totalCredit: '50000.00',
      },
      {
        accountCode: '1521',
        accountLabel: 'Provision réglementée',
        totalDebit: '0.00',
        totalCredit: '12000.00',
      },
      { accountCode: '601', accountLabel: 'Achats', totalDebit: '7000.00', totalCredit: '0.00' },
    ]);
    const r = await handleN3eReevaluations(CTX, deps);
    expect(r.applicable).toBe(true);
    expect(r.rows.length).toBe(3); // 1062 + 1521 + TOTAL
    const total = r.rows.find((x) => x.key === 'TOTAL');
    expect(total?.values.total).toBe('62000.00');
  });

  it('renvoie applicable=false si aucun solde', async () => {
    const r = await handleN3eReevaluations(CTX, depsWithBalances([]));
    expect(r.applicable).toBe(false);
    expect(r.rows.length).toBe(0);
  });
});

describe('Note 3F — Charges immobilisées', () => {
  it('agrège les soldes 201/202/203/206/208 par catégorie', async () => {
    const deps = depsWithBalances([
      {
        accountCode: '201',
        accountLabel: "Frais d'établissement",
        totalDebit: '10000.00',
        totalCredit: '0.00',
      },
      {
        accountCode: '2031',
        accountLabel: 'Frais R&D',
        totalDebit: '5000.00',
        totalCredit: '0.00',
      },
    ]);
    const r = await handleN3fChargesImmobilisees(CTX, deps);
    expect(r.applicable).toBe(true);
    expect(r.rows.some((x) => x.key === 'TOTAL')).toBe(true);
    const total = r.rows.find((x) => x.key === 'TOTAL');
    expect(total?.values.brut).toBe('15000.00');
  });
});

describe('Note 15B — Autres fonds propres', () => {
  it('agrège 104/105/108/109/17 sans inclure les comptes 11/12/13', async () => {
    const deps = depsWithBalances([
      {
        accountCode: '1041',
        accountLabel: 'Primes émission',
        totalDebit: '0.00',
        totalCredit: '30000.00',
      },
      {
        accountCode: '17',
        accountLabel: 'Dettes assimilées',
        totalDebit: '0.00',
        totalCredit: '8000.00',
      },
      {
        accountCode: '111',
        accountLabel: 'Réserve légale',
        totalDebit: '0.00',
        totalCredit: '99999.00',
      }, // ignored
    ]);
    const r = await handleN15bAutresFondsPropres(CTX, deps);
    expect(r.applicable).toBe(true);
    const total = r.rows.find((x) => x.key === 'TOTAL');
    expect(total).toBeDefined();
  });
});

describe('Note 16B — Engagements retraite', () => {
  it('agrège le compte 196 et reste applicable même vide', async () => {
    const withProv = await handleN16bEngagementsRetraite(
      CTX,
      depsWithBalances([
        {
          accountCode: '1962',
          accountLabel: 'Provision IFC',
          totalDebit: '0.00',
          totalCredit: '45000.00',
        },
      ]),
    );
    expect(withProv.applicable).toBe(true);
    expect(withProv.rows.some((r) => r.key === 'TOTAL')).toBe(true);

    const empty = await handleN16bEngagementsRetraite(CTX, depsWithBalances([]));
    expect(empty.applicable).toBe(true); // applicable même sans provision (déclaration néant)
    expect(empty.rows.length).toBe(0);
  });
});

describe('Note 16B bis — Sûretés données', () => {
  it('rend une note applicable vide (commentaire libre)', async () => {
    const r = await handleN16bbisSuretesDonnees(CTX, depsWithBalances([]));
    expect(r.applicable).toBe(true);
    expect(r.rows.length).toBe(0);
  });
});

describe('Note 27B — Effectifs', () => {
  it('liste les qualifications triées + TOTAL quand la dep est câblée', async () => {
    const deps: NoteHandlerDependencies = {
      ...depsWithBalances([]),
      dsfProfile: {
        getWorkforceByQualification: async () => ({
          'YC Employés': 12,
          'YA Cadres': 3,
          'YB Maîtrise': 7,
        }),
      },
    };
    const r = await handleN27bEffectifs(CTX, deps);
    expect(r.applicable).toBe(true);
    expect(r.rows.length).toBe(4); // 3 qualifications + TOTAL
    expect(r.rows[0].key).toBe('YA Cadres'); // tri alphabétique
    const total = r.rows.find((x) => x.key === 'TOTAL');
    expect(total?.values.effectif).toBe('22');
  });

  it("rend une note vide applicable si la dep n'est pas câblée", async () => {
    const r = await handleN27bEffectifs(CTX, depsWithBalances([]));
    expect(r.applicable).toBe(true);
    expect(r.rows.length).toBe(0);
  });
});

describe('Note 34 — Fiche de synthèse', () => {
  it('produit 5 blocs avec ratios calculés quand la dep est câblée', async () => {
    const snapshot: NoteSynthesisSnapshot = {
      chiffreAffaires: '1000000.00',
      valeurAjoutee: '400000.00',
      excedentBrutExploitation: '200000.00',
      resultatExploitation: '150000.00',
      resultatNet: '90000.00',
      totalActif: '2000000.00',
      totalCapitauxPropres: '800000.00',
      dettesFinancieres: '600000.00',
      actifCirculant: '500000.00',
      tresorerieActif: '100000.00',
      passifCirculant: '300000.00',
      tresoreriePassif: '50000.00',
      variationTresorerie: '50000.00',
    };
    const deps: NoteHandlerDependencies = {
      ...depsWithBalances([]),
      synthesisIndicators: { getSnapshot: async () => snapshot },
    };
    const r = await handleN34FicheSynthese(CTX, deps);
    expect(r.applicable).toBe(true);

    const blocs = new Set(r.rows.map((row) => String(row.values.bloc)));
    expect(blocs.has('ACTIVITE')).toBe(true);
    expect(blocs.has('STRUCTURE')).toBe(true);
    expect(blocs.has('RENTABILITE')).toBe(true);
    expect(blocs.has('LIQUIDITE')).toBe(true);
    expect(blocs.has('ENDETTEMENT')).toBe(true);

    // Indépendance financière = 800 000 / 2 000 000 = 40 %
    const indep = r.rows.find((x) => x.key === 'S3');
    expect(indep?.values.value).toBe('40.00 %');

    // Liquidité générale = (500 000 + 100 000) / (300 000 + 50 000) = 1.71
    const lg = r.rows.find((x) => x.key === 'L1');
    expect(lg?.values.value).toBe('1.71');
  });

  it("renvoie une ligne 'source indisponible' si la dep n'est pas câblée", async () => {
    const r = await handleN34FicheSynthese(CTX, depsWithBalances([]));
    expect(r.applicable).toBe(true);
    expect(r.rows.length).toBe(1);
    expect(r.rows[0].key).toBe('SOURCE_UNAVAILABLE');
  });
});
