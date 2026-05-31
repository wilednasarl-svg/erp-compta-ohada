import {
  buildReconciliationRow,
  RECON_PREFIXES_CORP,
  RECON_PREFIXES_INCORP,
} from '../../services/notes-annexes/handlers/_reconciliation';

describe('buildReconciliationRow (contrôle de cohérence 3A/3B — issue 8vny)', () => {
  const cols = ['brutCloture', 'amortCloture', 'vnc'];

  it('retourne null quand registre et comptabilité concordent', () => {
    const balances = [
      { accountCode: '231000', totalDebit: '100000.00', totalCredit: '0.00' },
      { accountCode: '283100', totalDebit: '0.00', totalCredit: '10000.00' },
    ];
    // net comptable = 100000 − 10000 = 90000 = VNC registre → concordant.
    expect(buildReconciliationRow(balances, RECON_PREFIXES_CORP, 90000, cols)).toBeNull();
  });

  it('tolère un écart d’arrondi (≤ 1 unité)', () => {
    const balances = [{ accountCode: '224000', totalDebit: '50000.50', totalCredit: '0.00' }];
    expect(buildReconciliationRow(balances, RECON_PREFIXES_CORP, 50000, cols)).toBeNull();
  });

  it('signale un écart corporel (> 1) avec le net comptable en colonne VNC', () => {
    const balances = [{ accountCode: '244000', totalDebit: '30000.00', totalCredit: '0.00' }];
    const row = buildReconciliationRow(balances, RECON_PREFIXES_CORP, 25000, cols);
    expect(row).not.toBeNull();
    expect(row?.key).toBe('CONTROLE_COHERENCE');
    expect(row?.values.vnc).toBe('30000.00'); // net comptable
    expect(row?.values.brutCloture).toBe(''); // autres colonnes vides
    expect(row?.label).toContain('-5000.00'); // écart 25000 − 30000
  });

  it('isole les comptes incorporels (21x / 281 / 291) des comptes corporels', () => {
    const balances = [
      { accountCode: '213000', totalDebit: '8000.00', totalCredit: '0.00' }, // brut R&D
      { accountCode: '281300', totalDebit: '0.00', totalCredit: '3000.00' }, // amort incorp
      { accountCode: '231000', totalDebit: '999999.00', totalCredit: '0.00' }, // corporel → ignoré
    ];
    // net incorp = 8000 − 3000 = 5000 = VNC registre → concordant
    // (le compte corporel 231000 ne doit PAS être capté par les préfixes incorp).
    expect(buildReconciliationRow(balances, RECON_PREFIXES_INCORP, 5000, cols)).toBeNull();
  });
});
