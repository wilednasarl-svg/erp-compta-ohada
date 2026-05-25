import { classifyForBilan } from '../services/ohada-classifier';

describe('classifyForBilan', () => {
  it('class 2 → ACTIF immobilisé regardless of sign', () => {
    expect(classifyForBilan('211000', 2, 'D')).toEqual({
      side: 'ACTIF',
      key: 'IMMOBILISE',
      contraSign: 1,
    });
    // Cumulated depreciation (28x) is on credit but still actif immobilisé
    // by SYSCOHADA convention — netted off against the gross immo.
    expect(classifyForBilan('281000', 2, 'C')).toEqual({
      side: 'ACTIF',
      key: 'IMMOBILISE',
      contraSign: 1,
    });
  });

  it('class 1 with prefix 10-15 → capitaux propres', () => {
    expect(classifyForBilan('101000', 1, 'C')).toEqual({
      side: 'PASSIF',
      key: 'CAPITAUX_PROPRES',
      contraSign: 1,
    });
    expect(classifyForBilan('151000', 1, 'C')).toEqual({
      side: 'PASSIF',
      key: 'CAPITAUX_PROPRES',
      contraSign: 1,
    });
  });

  it('class 1 with prefix ≥16 → dettes financières', () => {
    expect(classifyForBilan('161000', 1, 'C')).toEqual({
      side: 'PASSIF',
      key: 'DETTES_FINANCIERES',
      contraSign: 1,
    });
    expect(classifyForBilan('181000', 1, 'C')).toEqual({
      side: 'PASSIF',
      key: 'DETTES_FINANCIERES',
      contraSign: 1,
    });
  });

  it('class 3 → ACTIF circulant (stocks)', () => {
    expect(classifyForBilan('311000', 3, 'D')).toEqual({
      side: 'ACTIF',
      key: 'CIRCULANT',
      contraSign: 1,
    });
  });

  it('class 4 debit → ACTIF circulant (créance)', () => {
    expect(classifyForBilan('411000', 4, 'D')).toEqual({
      side: 'ACTIF',
      key: 'CIRCULANT',
      contraSign: 1,
    });
  });

  it('class 4 credit → PASSIF circulant (dette)', () => {
    expect(classifyForBilan('401000', 4, 'C')).toEqual({
      side: 'PASSIF',
      key: 'PASSIF_CIRCULANT',
      contraSign: 1,
    });
  });

  it('class 5 debit → trésorerie actif', () => {
    expect(classifyForBilan('512000', 5, 'D')).toEqual({
      side: 'ACTIF',
      key: 'TRESORERIE_ACTIF',
      contraSign: 1,
    });
  });

  it('class 5 credit → trésorerie passif (découvert bancaire)', () => {
    expect(classifyForBilan('512000', 5, 'C')).toEqual({
      side: 'PASSIF',
      key: 'TRESORERIE_PASSIF',
      contraSign: 1,
    });
  });

  it.each([6, 7, 8, 9])('class %i → null (P&L / HAO / analytique, not Bilan)', (klass) => {
    expect(classifyForBilan('600000', klass, 'D')).toBeNull();
  });

  it('class 0 / class 10 → null (out of OHADA range)', () => {
    expect(classifyForBilan('000000', 0, 'D')).toBeNull();
    expect(classifyForBilan('xxxxxx', 10, 'D')).toBeNull();
  });

  // ── Opposing accounts (Tome 1 G02) ────────────────────────────────
  describe('opposing accounts (is_opposing = true)', () => {
    it('4912 (dépréciation client) credit → ACTIF circulant with contraSign=-1', () => {
      // Une dépréciation client a un solde créditeur naturel ;
      // l'inversion la place dans la même section que le 411
      // (Actif circulant) avec contraSign=-1 pour soustraire au total.
      expect(classifyForBilan('491200', 4, 'C', true)).toEqual({
        side: 'ACTIF',
        key: 'CIRCULANT',
        contraSign: -1,
      });
    });

    it('291xx (dépréciation immo) credit → ACTIF immobilisé avec contraSign=-1', () => {
      expect(classifyForBilan('291000', 2, 'C', true)).toEqual({
        side: 'ACTIF',
        key: 'IMMOBILISE',
        contraSign: -1,
      });
    });

    it('391xx (dépréciation stocks) credit → ACTIF circulant avec contraSign=-1', () => {
      expect(classifyForBilan('391000', 3, 'C', true)).toEqual({
        side: 'ACTIF',
        key: 'CIRCULANT',
        contraSign: -1,
      });
    });

    it('591xx (dépréciation placement) credit → Trésorerie actif avec contraSign=-1', () => {
      expect(classifyForBilan('591000', 5, 'C', true)).toEqual({
        side: 'ACTIF',
        key: 'TRESORERIE_ACTIF',
        contraSign: -1,
      });
    });

    it('129 (résultat déficitaire) debit → Capitaux propres avec contraSign=-1', () => {
      // Classe 1 créditrice ; 129 débiteur (perte) → soustraction des capitaux propres.
      expect(classifyForBilan('129', 1, 'D', true)).toEqual({
        side: 'PASSIF',
        key: 'CAPITAUX_PROPRES',
        contraSign: -1,
      });
    });

    it('109 (capital non appelé) debit → Capitaux propres avec contraSign=-1', () => {
      expect(classifyForBilan('109', 1, 'D', true)).toEqual({
        side: 'PASSIF',
        key: 'CAPITAUX_PROPRES',
        contraSign: -1,
      });
    });

    it('409 (avances fournisseurs versées) debit → ACTIF circulant avec contraSign=-1', () => {
      // Classe 4 normalement créditrice côté fournisseur ; 409 débiteur
      // → on inverse le sens (créditeur fictif) → classé en Passif
      // circulant avec contraSign=-1 (= en déduction des dettes fourn.).
      // C'est volontaire : la présentation OHADA reclasse 409 comme
      // une avance, qui réduit la dette fournisseur nette.
      expect(classifyForBilan('409', 4, 'D', true)).toEqual({
        side: 'PASSIF',
        key: 'PASSIF_CIRCULANT',
        contraSign: -1,
      });
    });

    it('default isOpposing=false preserves legacy classifier behaviour', () => {
      // Sanity: passer une 4912 sans flag opposing tombe dans la branche
      // standard (solde créditeur → Passif circulant). C'est exactement
      // le bug que la flag corrige.
      expect(classifyForBilan('491200', 4, 'C')).toEqual({
        side: 'PASSIF',
        key: 'PASSIF_CIRCULANT',
        contraSign: 1,
      });
    });
  });
});
