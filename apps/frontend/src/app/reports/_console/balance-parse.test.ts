import { describe, expect, it } from 'vitest';

import { parseBalanceCsv } from './balance-parse';

/**
 * Non-régression : l'apostrophe simple ne doit PAS être traitée comme un
 * guillemet CSV. Des libellés FR très courants en contiennent
 * (« RESULTAT INST D'AFFECTATION », « PRIME D'ASSURANCE »…). Bug historique :
 * chaque apostrophe décalait les colonnes → soldes débiteurs perdus → faux
 * déséquilibre (~140 M sur une balance réelle pourtant équilibrée). Ce test
 * garde le correctif appliqué (il avait déjà sauté du monolithe).
 */
describe('parseBalanceCsv — apostrophe', () => {
  it('préserve l’équilibre malgré des apostrophes dans les libellés', () => {
    const csv = [
      'COMPTE;INTITULE;SOLDE DEBITEUR;SOLDE CREDITEUR',
      "24110000;MATERIEL INDUSTRIEL;1000;",
      "13010000;RESULTAT INST D'AFFECTATION;500;",
      "62700000;PRIME D'ASSURANCE;1500;",
      "40100000;FOURNISSEURS;;3000",
    ].join('\n');

    const parsed = parseBalanceCsv(csv);

    // Les 3 comptes débiteurs (dont 2 à apostrophe) doivent être retenus.
    expect(parsed.rows).toHaveLength(4);
    expect(parsed.totalDebit).toBe(3000);
    expect(parsed.totalCredit).toBe(3000);
    expect(parsed.totalDebit - parsed.totalCredit).toBe(0);

    // Le libellé à apostrophe est conservé intact (pas tronqué).
    const affectation = parsed.rows.find((r) => r.code === '13010000');
    expect(affectation?.label).toContain("D'AFFECTATION");
    expect(affectation?.debit).toBe('500.00');
  });

  it('parse les montants au format US entier (100,000,000) sans les diviser', () => {
    const csv = [
      'COMPTE;INTITULE;SOLDE DEBITEUR;SOLDE CREDITEUR',
      '24110000;MATERIEL;100,000,000;',
      '10130000;CAPITAL;;100,000,000',
    ].join('\n');

    const parsed = parseBalanceCsv(csv);

    expect(parsed.totalDebit).toBe(100_000_000);
    expect(parsed.totalCredit).toBe(100_000_000);
  });
});
