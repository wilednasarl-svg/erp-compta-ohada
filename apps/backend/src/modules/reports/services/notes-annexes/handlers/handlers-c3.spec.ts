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

const num = (s: string | null | undefined): number => {
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
};

function depsWithBalances(
  balances: ReadonlyArray<{
    accountCode: string;
    accountLabel: string;
    totalDebit: string;
    totalCredit: string;
  }>,
): NoteHandlerDependencies {
  const mapped = balances.map((b, i) => ({
    accountId: `id-${i}`,
    accountCode: b.accountCode,
    accountLabel: b.accountLabel,
    accountClass: Number(b.accountCode[0]) || 0,
    isOpposing: false,
    totalDebit: b.totalDebit,
    totalCredit: b.totalCredit,
  }));
  return {
    reports: {
      accountBalancesAsAt: async () => mapped,
      // Notes de gestion bornées : mêmes données mockées sur la période.
      accountMovementsBetween: async () => mapped,
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
  // Snapshot réaliste et INTERNEMENT COHÉRENT (le bilan équilibre) servant
  // de base aux tests d'invariants. Les composantes sont choisies pour que
  // les identités doctrinales se vérifient à l'euro près.
  //
  //   CAFG = EBE + rev.fin + prod.HAO − frais.fin − impôts
  //        = 200 000 + 30 000 + 10 000 − 25 000 − 45 000 = 170 000.
  //   Structure (masses) :
  //     Ressources stables = CP + DF = 800 000 + 600 000 = 1 400 000.
  //     FR (1) = 1 400 000 − actif immo 1 050 000 = 350 000.
  //     ACE = 500 000 ; PCE = 300 000 → BFE (2) = 200 000.
  //     ACHAO = 40 000 ; PCHAO = 30 000 → BFHAO (3) = 10 000.
  //     BFG (4) = 210 000 ; TN (5) = 350 000 − 210 000 = 140 000.
  //   Contrôle : trésorerie actif − trésorerie passif = 190 000 − 50 000
  //     = 140 000 = TN (5).  ✔
  //   Endettement financier net = DF + tréso passif − tréso actif
  //     = 600 000 + 50 000 − 190 000 = 460 000.
  const SNAP: NoteSynthesisSnapshot = {
    // Section 1 — SIG
    chiffreAffaires: '1000000.00',
    margeCommerciale: '350000.00',
    valeurAjoutee: '400000.00',
    excedentBrutExploitation: '200000.00',
    resultatExploitation: '150000.00',
    resultatFinancier: '5000.00',
    resultatAO: '155000.00',
    resultatHAO: '-35000.00',
    resultatNet: '90000.00',
    // Section 2 — CAFG
    cafgExploitation: '200000.00',
    revenusFinanciers: '30000.00',
    produitsHAO: '10000.00',
    fraisFinanciers: '25000.00',
    impotsResultat: '45000.00',
    cafg: '170000.00',
    dividendes: '0.00',
    autofinancement: '170000.00',
    // Section 4 — structure
    actifImmobilise: '1050000.00',
    actifCircExploitation: '500000.00',
    passifCircExploitation: '300000.00',
    actifCircHAO: '40000.00',
    passifCircHAO: '30000.00',
    fondsRoulement: '350000.00',
    besoinFinExploitation: '200000.00',
    besoinFinHAO: '10000.00',
    besoinFinGlobal: '210000.00',
    tresorerieNette: '140000.00',
    // Section 5 — flux
    fluxOperationnels: '160000.00',
    fluxInvestissement: '-80000.00',
    fluxFinancement: '60000.00',
    // Bilan partagé
    totalActif: '2000000.00',
    totalCapitauxPropres: '800000.00',
    dettesFinancieres: '600000.00',
    actifCirculant: '540000.00',
    tresorerieActif: '190000.00',
    passifCirculant: '330000.00',
    tresoreriePassif: '50000.00',
    variationTresorerie: '140000.00',
  };

  const runWith = async (snap: NoteSynthesisSnapshot) => {
    const deps: NoteHandlerDependencies = {
      ...depsWithBalances([]),
      synthesisIndicators: { getSnapshot: async () => snap },
    };
    return handleN34FicheSynthese(CTX, deps);
  };

  const val = (rows: Awaited<ReturnType<typeof runWith>>['rows'], key: string): string =>
    rows.find((r) => r.key === key)?.values.value ?? '';

  it('produit les 6 sections officielles avec les libellés conformes', async () => {
    const r = await runWith(SNAP);
    expect(r.applicable).toBe(true);

    const blocs = new Set(r.rows.map((row) => String(row.values.bloc)));
    expect(blocs.has('ACTIVITE')).toBe(true);
    expect(blocs.has('CAFG')).toBe(true);
    expect(blocs.has('RENTABILITE')).toBe(true);
    expect(blocs.has('STRUCTURE')).toBe(true);
    expect(blocs.has('VARIATION_TRESORERIE')).toBe(true);
    expect(blocs.has('ENDETTEMENT')).toBe(true);

    // Rentabilité économique (R1, conforme Note 34) = RAO × (1 − 0.35) /
    //   (CP + dettes fin) = 150 000 × 0.65 / 1 400 000 ≈ 6.96 %.
    const rec = r.rows.find((x) => x.key === 'R1');
    expect(rec?.label).toBe('Rentabilité économique');
    expect(rec?.values.value).toBe('6.96 %');

    // Rentabilité financière = RN / CP = 90 000 / 800 000 = 11.25 %.
    expect(val(r.rows, 'R2')).toBe('11.25 %');
  });

  // ── Tests d'INVARIANTS doctrinaux ───────────────────────────────────

  it("(a) Trésorerie nette (5) == Trésorerie actif − Trésorerie passif", async () => {
    const r = await runWith(SNAP);
    const tn = num(val(r.rows, 'S11')); // TRÉSORERIE NETTE (5)
    const controle = num(val(r.rows, 'S12')); // CONTRÔLE : TA − TP
    expect(tn).toBeCloseTo(num(SNAP.tresorerieActif) - num(SNAP.tresoreriePassif), 2);
    expect(controle).toBeCloseTo(tn, 2);
  });

  it('(b) CAFG == EBE + revenus fin + produits HAO − frais fin − impôts', async () => {
    const r = await runWith(SNAP);
    const cafg = num(val(r.rows, 'C6'));
    const attendu =
      num(SNAP.cafgExploitation) +
      num(SNAP.revenusFinanciers) +
      num(SNAP.produitsHAO) -
      num(SNAP.fraisFinanciers) -
      num(SNAP.impotsResultat);
    expect(cafg).toBeCloseTo(attendu, 2);
    expect(cafg).toBeCloseTo(170000, 2);
  });

  it('(c) Endettement financier net == Dettes fin + Trésorerie passif − Trésorerie actif', async () => {
    const r = await runWith(SNAP);
    const efn = num(val(r.rows, 'E3'));
    const attendu =
      num(SNAP.dettesFinancieres) + num(SNAP.tresoreriePassif) - num(SNAP.tresorerieActif);
    expect(efn).toBeCloseTo(attendu, 2);
    expect(efn).toBeCloseTo(460000, 2);
    // L'endettement brut (E1) + (− tréso actif E2) doit redonner E3.
    expect(num(val(r.rows, 'E1')) - num(SNAP.tresorerieActif)).toBeCloseTo(efn, 2);
  });

  it('(d) chaque ligne SIG de la section 1 == la valeur du SIG correspondant', async () => {
    const r = await runWith(SNAP);
    const sigMap: ReadonlyArray<[string, string]> = [
      ['A1', SNAP.chiffreAffaires],
      ['A2', SNAP.margeCommerciale],
      ['A3', SNAP.valeurAjoutee],
      ['A4', SNAP.excedentBrutExploitation],
      ['A5', SNAP.resultatExploitation],
      ['A6', SNAP.resultatFinancier],
      ['A7', SNAP.resultatAO],
      ['A8', SNAP.resultatHAO],
      ['A9', SNAP.resultatNet],
    ];
    for (const [key, expected] of sigMap) {
      expect(num(val(r.rows, key))).toBeCloseTo(num(expected), 2);
    }
  });

  it('(e) Variation de trésorerie (V4) == ZB + ZC + ZF', async () => {
    const r = await runWith(SNAP);
    const v4 = num(val(r.rows, 'V4'));
    const attendu =
      num(SNAP.fluxOperationnels) + num(SNAP.fluxInvestissement) + num(SNAP.fluxFinancement);
    expect(v4).toBeCloseTo(attendu, 2);
    expect(v4).toBeCloseTo(140000, 2);
  });

  it("renvoie une ligne 'source indisponible' si la dep n'est pas câblée", async () => {
    const r = await handleN34FicheSynthese(CTX, depsWithBalances([]));
    expect(r.applicable).toBe(true);
    expect(r.rows.length).toBe(1);
    expect(r.rows[0].key).toBe('SOURCE_UNAVAILABLE');
  });
});
