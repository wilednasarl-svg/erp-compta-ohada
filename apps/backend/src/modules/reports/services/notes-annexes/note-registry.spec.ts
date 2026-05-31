/**
 * Garde-fous structurels sur le registre des notes annexes SYSCOHADA
 * Tome 3 (pages 35-70 — voir l'en-tête de `note-registry.ts` pour la
 * doctrine et le tableau de remapping).
 *
 * Vérifie :
 *   - les NoteId canoniques de la doctrine sont présents (N1, N2, N3A..F,
 *     N4..N14, N15A/B, N16A/B/Bbis/C, N17..N19, N21..N26, N27A/B,
 *     N28..N36)
 *   - chaque entrée a une métadonnée bien formée et un handler appelable
 *   - les handlers branchés retournent { rows, applicable } sans planter
 *     sur un dataset vide
 *   - la coverage doctrine ne régresse pas (≥ 45 entrées)
 */
import { ALL_NOTE_IDS, NOTE_REGISTRY } from './note-registry';
import type { NoteHandlerDependencies, NoteId } from './types';

/**
 * Liste figée des NoteIds doctrine. NOTE : N20 est volontairement omis
 * (la grille R4 du Tome 3 ne le réserve pas).
 */
const EXPECTED_NOTE_IDS: ReadonlyArray<NoteId> = [
  'N1',
  'N2',
  'N3A',
  'N3B',
  'N3C',
  'N3D',
  'N3E',
  'N3F',
  'N4',
  'N5',
  'N6',
  'N7',
  'N8',
  'N9',
  'N10',
  'N11',
  'N12',
  'N13',
  'N14',
  'N15A',
  'N15B',
  'N16A',
  'N16B',
  'N16Bbis',
  'N16C',
  'N17',
  'N18',
  'N19',
  'N21',
  'N22',
  'N23',
  'N24',
  'N25',
  'N26',
  'N27A',
  'N27B',
  'N28',
  'N29',
  'N30',
  'N31',
  'N32',
  'N33',
  'N34',
  'N35',
  'N36',
] as ReadonlyArray<NoteId>;

/**
 * W2.4.c — toutes les notes sont implémentées (N31 inclus, branché sur
 * `CashFlowService`). Plus aucun handler en stub : la liste reste
 * vide volontairement comme garde-fou anti-régression.
 */
const STILL_STUB: ReadonlyArray<NoteId> = [] as ReadonlyArray<NoteId>;

function emptyDeps(): NoteHandlerDependencies {
  return {
    reports: { accountBalancesAsAt: async () => [], accountMovementsBetween: async () => [] },
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

describe('notes-annexes registry — structure', () => {
  it('contient toutes les NoteIds doctrine SYSCOHADA Tome 3 (45 entrées, N20 omis)', () => {
    const present = new Set(ALL_NOTE_IDS);
    for (const expected of EXPECTED_NOTE_IDS) {
      expect(present.has(expected)).toBe(true);
    }
    expect(ALL_NOTE_IDS.length).toBe(EXPECTED_NOTE_IDS.length);
  });

  it('every entry has well-formed metadata', () => {
    for (const [id, entry] of NOTE_REGISTRY.entries()) {
      expect(entry.metadata.id).toBe(id);
      expect(entry.metadata.label).toMatch(/^Note /);
      expect(['IDENTIFICATION', 'BILAN', 'CR', 'TFT', 'GENERAL']).toContain(entry.metadata.section);
      expect(typeof entry.metadata.applicableByDefault).toBe('boolean');
    }
  });

  it('exposes a callable handler on every entry', () => {
    for (const entry of NOTE_REGISTRY.values()) {
      expect(typeof entry.handler).toBe('function');
    }
  });
});

describe('notes-annexes registry — handlers implémentés', () => {
  const implementedIds = ALL_NOTE_IDS.filter((id) => !STILL_STUB.includes(id));

  it('a au moins 45 entrées doctrine branchées (handler ou freeComment)', () => {
    expect(implementedIds.length).toBeGreaterThanOrEqual(45);
  });

  it.each(implementedIds)(
    '%s — handler renvoie { rows, applicable } sur dataset vide sans throw',
    async (id) => {
      const entry = NOTE_REGISTRY.get(id);
      if (!entry) throw new Error(`missing ${id}`);
      const result = await entry.handler(
        {
          organizationId: '00000000-0000-4000-8000-000000000001',
          exerciseId: 'exo-1',
          periodStart: '2026-01-01',
          periodEnd: '2026-12-31',
          fiscalYear: 2026,
        },
        emptyDeps(),
      );
      expect(Array.isArray(result.rows)).toBe(true);
      expect(typeof result.applicable).toBe('boolean');
    },
  );
});

describe('notes-annexes registry — stubs explicites', () => {
  it('aucun handler ne reste en stub (W2.4.c — toutes notes branchées)', () => {
    expect(STILL_STUB.length).toBe(0);
  });
});
