/**
 * Tests de cohérence du référentiel des postes lettrés SYSCOHADA AUDCIF.
 *
 * Ces tests garantissent que :
 *   - aucun code n'est dupliqué (Bilan et Compte de résultat) ;
 *   - tous les `parentGroup` référencés existent dans leur tableau ;
 *   - tous les SIG (Compte de résultat) portent une formule non vide ;
 *   - le référentiel atteint les seuils minimaux exigés par la doctrine
 *     (≥ 30 postes Bilan, ≥ 30 postes CR hors SIG, exactement 9 SIG) ;
 *   - tous les SIG sont en section « Soldes intermédiaires » ;
 *   - aucun `sourceAccountPrefixes` ne contient de doublon interne ;
 *   - aucun préfixe ne commence par autre chose qu'un chiffre 1-9.
 *
 * Ce fichier ne teste AUCUNE logique d'agrégation : il valide
 * uniquement l'intégrité structurelle du référentiel statique.
 */

import { BILAN_POSTES, type BilanPosteRef } from './bilan-postes';
import { PL_POSTES, type PlPosteRef } from './pl-postes';

const SIG_SECTION_LABEL = 'Soldes intermédiaires' as const;

describe('Référentiel des postes SYSCOHADA — intégrité structurelle', () => {
  describe('BILAN_POSTES', () => {
    it("n'a aucun doublon de code", () => {
      const codes = BILAN_POSTES.map((p) => p.code);
      const unique = new Set(codes);
      expect(unique.size).toBe(codes.length);
    });

    it('a tous ses parentGroup pointant vers un code existant', () => {
      const codes = new Set(BILAN_POSTES.map((p) => p.code));
      const orphans = BILAN_POSTES.filter(
        (p): p is BilanPosteRef & { parentGroup: string } =>
          p.parentGroup !== undefined,
      )
        .filter((p) => !codes.has(p.parentGroup))
        .map((p) => `${p.code} -> ${p.parentGroup}`);

      expect(orphans).toEqual([]);
    });

    it('contient au moins 30 postes (smoke test)', () => {
      expect(BILAN_POSTES.length).toBeGreaterThanOrEqual(30);
    });

    /**
     * Spot-check des libellés doctrinaux SYSCOHADA Tome 3 p. 32.
     * Vérifie mot pour mot un échantillon des postes critiques pour
     * une DSF déposable (libellés affichés dans le rendu PDF/XLSX).
     */
    it('a les libellés officiels exacts du Tome 3 p. 32 (spot-check 10 postes)', () => {
      const byCode = new Map(BILAN_POSTES.map((p) => [p.code, p.label]));
      expect(byCode.get('AE')).toBe('Frais de développement et de prospection');
      expect(byCode.get('AF')).toBe(
        'Brevets, licences, logiciels et droits similaires',
      );
      expect(byCode.get('AI')).toBe('IMMOBILISATIONS CORPORELLES');
      expect(byCode.get('AP')).toBe(
        'AVANCES ET ACOMPTES VERSÉS SUR IMMOBILISATIONS',
      );
      expect(byCode.get('BI')).toBe('Clients');
      expect(byCode.get('BS')).toBe(
        'Banques, chèques postaux, caisse et assimilés',
      );
      expect(byCode.get('CA')).toBe('Capital');
      expect(byCode.get('CJ')).toBe(
        "Résultat net de l'exercice (bénéfice + / perte −)",
      );
      expect(byCode.get('DJ')).toBe("Fournisseurs d'exploitation");
      expect(byCode.get('DR')).toBe(
        'Banques, établissements financiers et crédits de trésorerie',
      );
    });

    /**
     * Mapping note ↔ poste (Tome 3 p. 32 colonne « Note »).
     * Les postes critiques doivent porter un code de note annexe pour
     * que le rendu DSF affiche la liaison bilan ↔ annexes.
     */
    it('porte les codes de notes annexes attendus par la doctrine', () => {
      const byCode = new Map(BILAN_POSTES.map((p) => [p.code, p.note]));
      // Immobilisations → Note 3 ; Financières → Note 4
      expect(byCode.get('AD')).toBe('3');
      expect(byCode.get('AI')).toBe('3');
      expect(byCode.get('AP')).toBe('3');
      expect(byCode.get('AQ')).toBe('4');
      // Circulant
      expect(byCode.get('BA')).toBe('5');
      expect(byCode.get('BB')).toBe('6');
      expect(byCode.get('BI')).toBe('7');
      expect(byCode.get('BJ')).toBe('8');
      // Trésorerie + écarts
      expect(byCode.get('BS')).toBe('11');
      expect(byCode.get('BU')).toBe('12');
      expect(byCode.get('DV')).toBe('12');
      // Capitaux propres + dettes
      expect(byCode.get('CA')).toBe('13');
      expect(byCode.get('CB')).toBe('13');
      expect(byCode.get('DA')).toBe('16');
      expect(byCode.get('DJ')).toBe('17');
      expect(byCode.get('DK')).toBe('18');
    });
  });

  describe('PL_POSTES', () => {
    it("n'a aucun doublon de code", () => {
      const codes = PL_POSTES.map((p) => p.code);
      const unique = new Set(codes);
      expect(unique.size).toBe(codes.length);
    });

    it('a tous ses parentGroup pointant vers un code existant', () => {
      const codes = new Set(PL_POSTES.map((p) => p.code));
      const orphans = PL_POSTES.filter(
        (p): p is PlPosteRef & { parentGroup: string } =>
          p.parentGroup !== undefined,
      )
        .filter((p) => !codes.has(p.parentGroup))
        .map((p) => `${p.code} -> ${p.parentGroup}`);

      expect(orphans).toEqual([]);
    });

    it('contient au moins 30 postes de flux (hors SIG)', () => {
      const flux = PL_POSTES.filter((p) => p.kind !== 'SIG');
      expect(flux.length).toBeGreaterThanOrEqual(30);
    });

    it('contient exactement 9 SIG (XA, XB, XC, XD, XE, XF, XG, XH, XI)', () => {
      const sigs = PL_POSTES.filter((p) => p.kind === 'SIG');
      expect(sigs).toHaveLength(9);

      const sigCodes = sigs.map((p) => p.code).sort();
      expect(sigCodes).toEqual([
        'XA',
        'XB',
        'XC',
        'XD',
        'XE',
        'XF',
        'XG',
        'XH',
        'XI',
      ]);
    });

    it('a une computationFormula non vide pour chaque SIG', () => {
      const sigs = PL_POSTES.filter((p) => p.kind === 'SIG');
      const missing = sigs
        .filter(
          (p) =>
            p.computationFormula === undefined ||
            p.computationFormula.trim() === '',
        )
        .map((p) => p.code);

      expect(missing).toEqual([]);
    });

    it("classe tous les SIG dans la section « Soldes intermédiaires »", () => {
      const sigs = PL_POSTES.filter((p) => p.kind === 'SIG');
      const misplaced = sigs
        .filter((p) => p.section !== SIG_SECTION_LABEL)
        .map((p) => `${p.code} (section=${p.section})`);

      expect(misplaced).toEqual([]);
    });

    it('utilise sign=+1 pour les PRODUITS et SIG, sign=-1 pour les CHARGES', () => {
      const wrongSign = PL_POSTES.filter((p) => {
        if (p.kind === 'PRODUIT' || p.kind === 'SIG') {
          return p.sign !== 1;
        }
        if (p.kind === 'CHARGE') {
          return p.sign !== -1;
        }
        return false;
      }).map((p) => `${p.code} (kind=${p.kind}, sign=${p.sign})`);

      expect(wrongSign).toEqual([]);
    });
  });

  describe('Cohérence transverse Bilan + Compte de résultat', () => {
    it("n'a aucun doublon interne dans sourceAccountPrefixes (Bilan)", () => {
      const offenders = BILAN_POSTES.filter(
        (p) => new Set(p.sourceAccountPrefixes).size !== p.sourceAccountPrefixes.length,
      ).map((p) => p.code);

      expect(offenders).toEqual([]);
    });

    it("n'a aucun doublon interne dans sourceAccountPrefixes (CR)", () => {
      const offenders = PL_POSTES.filter(
        (p) => new Set(p.sourceAccountPrefixes).size !== p.sourceAccountPrefixes.length,
      ).map((p) => p.code);

      expect(offenders).toEqual([]);
    });

    it("n'autorise aucun préfixe ne commençant pas par un chiffre 1-9 (Bilan)", () => {
      const validFirstChar = /^[1-9]/;
      const offenders: string[] = [];

      for (const poste of BILAN_POSTES) {
        const bad = [
          ...poste.sourceAccountPrefixes,
          ...poste.deductionPrefixes,
        ].filter((prefix) => !validFirstChar.test(prefix));

        if (bad.length > 0) {
          offenders.push(`${poste.code}: [${bad.join(', ')}]`);
        }
      }

      expect(offenders).toEqual([]);
    });

    it("n'autorise aucun préfixe ne commençant pas par un chiffre 1-9 (CR)", () => {
      const validFirstChar = /^[1-9]/;
      const offenders: string[] = [];

      for (const poste of PL_POSTES) {
        const bad = [
          ...poste.sourceAccountPrefixes,
          ...poste.deductionPrefixes,
        ].filter((prefix) => !validFirstChar.test(prefix));

        if (bad.length > 0) {
          offenders.push(`${poste.code}: [${bad.join(', ')}]`);
        }
      }

      expect(offenders).toEqual([]);
    });
  });
});
