import {
  accountClassFromCode,
  effectiveNormalBalance,
  inferBudgetType,
  orientActualAmount,
} from '../budget-actuals-mapping';

describe('budget-actuals-mapping', () => {
  describe('effectiveNormalBalance', () => {
    it('garde le sens normal quand le compte n\'est pas opposé', () => {
      expect(effectiveNormalBalance('D', false)).toBe('D');
      expect(effectiveNormalBalance('C', false)).toBe('C');
    });

    it('inverse le sens normal pour un compte opposé (ex. 49x)', () => {
      expect(effectiveNormalBalance('D', true)).toBe('C');
      expect(effectiveNormalBalance('C', true)).toBe('D');
    });
  });

  describe('orientActualAmount', () => {
    it('rend une charge consommée positive (compte 6x débiteur)', () => {
      // 1 200 000 de charge au débit, rien au crédit.
      expect(orientActualAmount('1200000.00', '0.00', 'D', false)).toBe('1200000.00');
    });

    it('rend un produit constaté positif (compte 7x créditeur)', () => {
      expect(orientActualAmount('0.00', '3500000.00', 'C', false)).toBe('3500000.00');
    });

    it('rend un avoir/extourne sur charge négatif', () => {
      // Crédit sur un compte de charge (annulation) → réalisé négatif.
      expect(orientActualAmount('0.00', '50000.00', 'D', false)).toBe('-50000.00');
    });

    it('compense débit et crédit sur la période (solde net)', () => {
      expect(orientActualAmount('800000.00', '300000.00', 'D', false)).toBe('500000.00');
    });

    it('respecte l\'inversion is_opposing (D opposé → sens créditeur effectif)', () => {
      // Compte déclaré 'D' mais opposé → se comporte en créditeur :
      // un crédit est dans son sens normal (positif), un débit l'inverse.
      expect(orientActualAmount('0.00', '90000.00', 'D', true)).toBe('90000.00');
      expect(orientActualAmount('90000.00', '0.00', 'D', true)).toBe('-90000.00');
    });
  });

  describe('inferBudgetType', () => {
    it('mappe les classes de gestion vers OPEX', () => {
      expect(inferBudgetType(6)).toBe('OPEX');
      expect(inferBudgetType(7)).toBe('OPEX');
    });

    it('mappe la classe 2 vers CAPEX et la classe 5 vers TRESO', () => {
      expect(inferBudgetType(2)).toBe('CAPEX');
      expect(inferBudgetType(5)).toBe('TRESO');
    });

    it('retourne null pour les classes de bilan hors pilotage budget', () => {
      for (const cls of [1, 3, 4, 8, 9]) {
        expect(inferBudgetType(cls)).toBeNull();
      }
    });
  });

  describe('accountClassFromCode', () => {
    it('déduit la classe du premier chiffre du code', () => {
      expect(accountClassFromCode('601100')).toBe(6);
      expect(accountClassFromCode('2441')).toBe(2);
      expect(accountClassFromCode('521')).toBe(5);
    });

    it('retourne 0 pour un code non numérique', () => {
      expect(accountClassFromCode('')).toBe(0);
      expect(accountClassFromCode('X12')).toBe(0);
    });
  });
});
