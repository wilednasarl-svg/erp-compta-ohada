/**
 * Garde-fous structurels sur le registry des 36 notes annexes SYSCOHADA.
 *
 * Vérifie :
 *   - les 36 NoteId canoniques sont présents (N1..N36 avec sous-notes 3A/B/C/D)
 *   - chaque entrée a une métadonnée bien formée et un handler appelable
 *   - les handlers non-stub retournent { rows, applicable } sans planter
 *     sur un dataset vide
 *   - la coverage W2.4 (>=31 notes implémentées) ne régresse pas
 */
import { ALL_NOTE_IDS, NOTE_REGISTRY } from './note-registry';
import { NotImplementedError, type NoteHandlerDependencies, type NoteId } from './types';

const EXPECTED_NOTE_IDS: ReadonlyArray<NoteId> = [
  'N1', 'N2',
  'N3A', 'N3B', 'N3C', 'N3D',
  'N4', 'N5', 'N6', 'N7', 'N8', 'N9',
  'N10', 'N11', 'N12', 'N13', 'N14', 'N15', 'N16', 'N17', 'N18', 'N19',
  'N20', 'N21', 'N22', 'N23', 'N24', 'N25', 'N26', 'N27', 'N28', 'N29',
  'N30', 'N31', 'N32', 'N33', 'N34', 'N35', 'N36',
] as ReadonlyArray<NoteId>;

const STILL_STUB: ReadonlyArray<NoteId> = [
  'N31',
] as ReadonlyArray<NoteId>;

function emptyDeps(): NoteHandlerDependencies {
  return {
    reports: { accountBalancesAsAt: async () => [] },
    assets: {
      findAllForExercise: async () => [],
      findDepreciationForYear: async () => [],
    },
    inventory: { findAllItems: async () => [] },
    accounts: { findById: async () => null },
  };
}

describe('notes-annexes registry — structure', () => {
  it('contains all 39 expected NoteIds (N1..N36 + 3A/B/C/D)', () => {
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

  it(`a au moins 38 notes implémentées (livraison W2.4.c)`, () => {
    expect(implementedIds.length).toBeGreaterThanOrEqual(38);
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
  it.each(STILL_STUB)(
    '%s — handler stub doit lever NotImplementedError',
    async (id) => {
      const entry = NOTE_REGISTRY.get(id);
      if (!entry) throw new Error(`missing ${id}`);
      await expect(
        entry.handler(
          {
            organizationId: '00000000-0000-4000-8000-000000000001',
            exerciseId: 'exo-1',
            periodStart: '2026-01-01',
            periodEnd: '2026-12-31',
            fiscalYear: 2026,
          },
          emptyDeps(),
        ),
      ).rejects.toBeInstanceOf(NotImplementedError);
    },
  );
});
