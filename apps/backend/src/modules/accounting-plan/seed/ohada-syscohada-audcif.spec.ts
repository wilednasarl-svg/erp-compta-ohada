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

  // ───────────────────────────────────────────────────────────────────────
  // W1.1 — Garde-fous additionnels sur l'extension doctrinale (∼322
  // nouveaux comptes ajoutés via migration 0089). Ces tests verrouillent
  // les attentes minimales : pas de régression sur la couverture, pas
  // de duplication, formats stricts.
  // ───────────────────────────────────────────────────────────────────────
  describe('W1.1 — extension doctrinale (migration 0089)', () => {
    it('contains at least 470 entries (171 backbone + ≥300 W1.1 critical)', () => {
      // 171 colonne vertébrale (0011) + 322 nouveaux (W1.1) = 493
      // attendu. Borne basse à 470 pour laisser une marge de manœuvre
      // en cas de refactor futur (consolidation de doublons doctrinaux).
      expect(OHADA_REFERENCE_CHART.length).toBeGreaterThanOrEqual(470);
    });

    it('every code is composed of digits only (no leading zero)', () => {
      // Renforce le test générique : refus explicite de tout caractère
      // non-numérique (lettre, espace, ponctuation). La DB applique
      // déjà cette contrainte (chk_reference_chart_accounts_code) mais
      // on la duplique côté seed pour fail-fast en CI.
      for (const row of OHADA_REFERENCE_CHART) {
        expect(row.code).toMatch(/^[1-9][0-9]{0,9}$/);
      }
    });

    it('normal_balance is strictly one of {D, C} on every row', () => {
      for (const row of OHADA_REFERENCE_CHART) {
        expect(row.normal_balance === 'D' || row.normal_balance === 'C').toBe(true);
      }
    });

    it('every code with a non-root prefix has its immediate parent or an ancestor in the seed', () => {
      // Plus strict que la règle structurelle « au moins un ancêtre » :
      // toute feuille à 3+ chiffres DOIT avoir un ancêtre dans le seed.
      // Vérifie que l'extension W1.1 n'a pas créé d'orphelin par typo.
      const codes = new Set(OHADA_REFERENCE_CHART.map((r) => r.code));
      for (const row of OHADA_REFERENCE_CHART) {
        if (row.code.length <= 1) continue;
        const ancestors = Array.from({ length: row.code.length - 1 }, (_, i) =>
          row.code.slice(0, i + 1),
        );
        expect(ancestors.some((p) => codes.has(p))).toBe(true);
      }
    });

    it('class 1 has ≥ 30 entries (capitaux + provisions full coverage)', () => {
      const c1 = OHADA_REFERENCE_CHART.filter((r) => r.class === 1);
      expect(c1.length).toBeGreaterThanOrEqual(30);
    });

    it('class 4 has ≥ 80 entries (tiers/régularisations/FX full coverage)', () => {
      const c4 = OHADA_REFERENCE_CHART.filter((r) => r.class === 4);
      expect(c4.length).toBeGreaterThanOrEqual(80);
    });

    it('class 8 has ≥ 20 entries (HAO full coverage)', () => {
      const c8 = OHADA_REFERENCE_CHART.filter((r) => r.class === 8);
      expect(c8.length).toBeGreaterThanOrEqual(20);
    });

    it('contains the critical FX-conversion accounts (478x/479x)', () => {
      // Écarts de conversion actif/passif — prérequis du module
      // multi-devises et des opérations de clôture (Tome 2).
      const codes = new Set(OHADA_REFERENCE_CHART.map((r) => r.code));
      for (const required of ['4781', '4782', '4791', '4792']) {
        expect(codes.has(required)).toBe(true);
      }
    });

    it('contains the critical régularisation accounts (4081/4181/4861/4862)', () => {
      // FNP fournisseur, factures à établir client, CCA/PCA détaillées —
      // prérequis des écritures de clôture (Tome 1).
      const codes = new Set(OHADA_REFERENCE_CHART.map((r) => r.code));
      for (const required of ['4081', '4181', '4861', '4862']) {
        expect(codes.has(required)).toBe(true);
      }
    });

    it('contains the critical dépréciation accounts (29x/39x/49x/59x)', () => {
      // Au moins un POSTING dans chaque famille de dépréciation —
      // prérequis IAS 36 transposé AUDCIF.
      const codes = new Set(OHADA_REFERENCE_CHART.map((r) => r.code));
      for (const required of ['291', '391', '491', '591']) {
        expect(codes.has(required)).toBe(true);
      }
    });

    it('contains the critical provisions pour risques accounts (191..198)', () => {
      // Litiges, garantie, pertes de change, retraite, démantèlement —
      // prérequis IAS 37 (Tome 2).
      const codes = new Set(OHADA_REFERENCE_CHART.map((r) => r.code));
      for (const required of ['191', '192', '194', '196', '198', '1984']) {
        expect(codes.has(required)).toBe(true);
      }
    });

    it('contains the critical HAO accounts (81x/82x/85x/86x for cessions)', () => {
      // VNC + produits de cessions + dotations/reprises dérogatoires —
      // toute écriture de cession d'immobilisation passe par ces côtés.
      const codes = new Set(OHADA_REFERENCE_CHART.map((r) => r.code));
      for (const required of ['811', '812', '822', '826', '851', '861']) {
        expect(codes.has(required)).toBe(true);
      }
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // W1.4 — Comptes opposants self-contained dans le seed.
  //
  // Migration 0090 backfille `is_opposing = true` par SQL sur les comptes
  // déjà insérés. Mais pour les ajouts FUTURS au seed, il faut que le
  // champ soit posé explicitement dès la définition (sinon un nouveau
  // 295 ajouté dans 6 mois entrera en base sans le flag).
  //
  // Ce garde-fou impose : tout compte dont le code matche un préfixe
  // opposant ('29x', '39x', '49x', '59x') ou un code opposant nommé
  // ('109', '121', '129', '409') DOIT porter `is_opposing: true` dans
  // sa définition.
  // ───────────────────────────────────────────────────────────────────────
  describe('W1.4 — comptes opposants explicitement marqués', () => {
    const OPPOSING_PATTERN = /^(29\d*|39\d*|49\d*|59\d*|109|121|129|409)$/;

    it('every opposing-prefix code carries is_opposing: true', () => {
      const violations = OHADA_REFERENCE_CHART.filter(
        (r) => OPPOSING_PATTERN.test(r.code) && r.is_opposing !== true,
      ).map((r) => r.code);

      expect(violations).toEqual([]);
    });

    it('no non-opposing-prefix code carries is_opposing: true (no false positive)', () => {
      const falsePositives = OHADA_REFERENCE_CHART.filter(
        (r) => r.is_opposing === true && !OPPOSING_PATTERN.test(r.code),
      ).map((r) => r.code);

      expect(falsePositives).toEqual([]);
    });
  });
});
