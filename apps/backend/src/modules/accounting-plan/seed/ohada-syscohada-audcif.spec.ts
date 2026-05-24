import { ACCOUNTING_SYSTEMS } from '../types/accounting-system';
import { OHADA_REFERENCE_CHART } from './ohada-syscohada-audcif';

/**
 * Garde-fous structurels sur le seed du plan comptable OHADA. Ces tests
 * ne valident PAS l'exactitude métier des libellés et systèmes
 * applicables (revue par expert-comptable hors-bande, cf. tasks.md
 * 11.1) — ils valident uniquement les invariants techniques que toute
 * ligne du seed doit respecter pour que le clonage en plan d'org
 * fonctionne.
 */
describe('OHADA SYSCOHADA AUDCIF reference chart (seed)', () => {
  describe('code format', () => {
    it('every code matches /^\\d{2,10}$/ except the 1-char class roots', () => {
      for (const row of OHADA_REFERENCE_CHART) {
        const isRoot = row.code.length === 1;
        if (isRoot) {
          expect(row.code).toMatch(/^[1-9]$/);
        } else {
          expect(row.code).toMatch(/^\d{2,10}$/);
        }
      }
    });

    it('every code is unique within the seed', () => {
      const seen = new Set<string>();
      for (const row of OHADA_REFERENCE_CHART) {
        expect(seen.has(row.code)).toBe(false);
        seen.add(row.code);
      }
    });
  });

  describe('class coherence', () => {
    it('the first digit of every code equals its `class` field', () => {
      for (const row of OHADA_REFERENCE_CHART) {
        expect(Number(row.code[0])).toBe(row.class);
      }
    });

    it('every class from 1 to 9 has at least one entry', () => {
      const classesSeen = new Set(OHADA_REFERENCE_CHART.map((r) => r.class));
      for (const c of [1, 2, 3, 4, 5, 6, 7, 8, 9] as const) {
        expect(classesSeen.has(c)).toBe(true);
      }
    });
  });

  describe('normal_balance and account_type', () => {
    it('normal_balance is D or C on every row', () => {
      for (const row of OHADA_REFERENCE_CHART) {
        expect(['D', 'C']).toContain(row.normal_balance);
      }
    });

    it('account_type is TITLE or POSTING on every row', () => {
      for (const row of OHADA_REFERENCE_CHART) {
        expect(['TITLE', 'POSTING']).toContain(row.account_type);
      }
    });
  });

  describe('applicable_systems', () => {
    it('every row lists at least one applicable system', () => {
      for (const row of OHADA_REFERENCE_CHART) {
        expect(row.applicable_systems.length).toBeGreaterThan(0);
      }
    });

    it('every listed system is part of the canonical AccountingSystem union', () => {
      for (const row of OHADA_REFERENCE_CHART) {
        for (const system of row.applicable_systems) {
          expect(ACCOUNTING_SYSTEMS).toContain(system);
        }
      }
    });

    it('every applicable_systems array has unique members', () => {
      for (const row of OHADA_REFERENCE_CHART) {
        const unique = new Set(row.applicable_systems);
        expect(unique.size).toBe(row.applicable_systems.length);
      }
    });
  });

  describe('hierarchy by prefix', () => {
    it('every non-root code has at least one ancestor in the seed (by strict prefix)', () => {
      const codes = new Set(OHADA_REFERENCE_CHART.map((r) => r.code));
      for (const row of OHADA_REFERENCE_CHART) {
        if (row.code.length === 1) continue;
        // At least one strict prefix of the code must also be in the seed.
        // (We don't require *every* prefix length to be present here
        // because intermediate divisional codes may be optional in the
        // AUDCIF — the structural invariant is "at least one ancestor",
        // not "fully dense ancestry chain".)
        const hasAncestor = Array.from({ length: row.code.length - 1 }, (_, i) =>
          row.code.slice(0, i + 1),
        ).some((prefix) => codes.has(prefix));
        expect(hasAncestor).toBe(true);
      }
    });
  });

  describe('postability — Module 3 prerequisite', () => {
    /**
     * Module 3 (Journaux & écritures) cannot post to a TITLE account.
     * If a class has TITLE rows but zero POSTING leaves, every
     * écriture targeting that class would be rejected as "no terminal
     * account". This guard catches a seed-regression where someone
     * deletes all POSTING rows of a class without realising.
     *
     * Classes 6 and 7 are the bare minimum: every business books
     * charges (6) and produces revenue (7). Classes 4 and 5 are also
     * required for VAT, banks, suppliers, customers. Classes 1/2/3/8
     * are looser — a brand-new entity may not need them on day 1.
     */
    it.each([[4], [5], [6], [7]])(
      'class %i has at least one POSTING account (Module 3 prerequisite)',
      (cls) => {
        const postings = OHADA_REFERENCE_CHART.filter(
          (r) => r.class === cls && r.account_type === 'POSTING',
        );
        expect(postings.length).toBeGreaterThan(0);
      },
    );

    it('the catalogue is not empty (sanity)', () => {
      expect(OHADA_REFERENCE_CHART.length).toBeGreaterThan(50);
    });
  });
});
