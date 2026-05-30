import { classifyToPoste } from './ohada-classifier';

describe('classifyToPoste — routage par signe des comptes de tiers', () => {
  it('route un compte de tiers à double appartenance selon le SIGNE du solde', () => {
    // 462 (associés) figure dans un poste ACTIF (créance) ET un poste PASSIF
    // (dette). Le signe doit trancher.
    const crediteur = classifyToPoste('46210100', false, 'C');
    expect(crediteur?.side).toBe('PASSIF'); // dette envers l'associé

    const debiteur = classifyToPoste('46210100', false, 'D');
    expect(debiteur?.side).toBe('ACTIF'); // créance sur l'associé
  });

  it('classe les comptes mono-appartenance indépendamment du signe', () => {
    expect(classifyToPoste('41100000', false, 'D')?.side).toBe('ACTIF'); // clients
    expect(classifyToPoste('40100000', false, 'C')?.side).toBe('PASSIF'); // fournisseurs
  });

  it('retourne null pour un compte sans poste lettré (hors référentiel)', () => {
    // 4661 n'est mappé à aucun poste → exclu du bilan officiel.
    expect(classifyToPoste('46610000', false, 'C')).toBeNull();
  });

  it('conserve la déduction pour les amortissements (préfixe le plus long)', () => {
    const amort = classifyToPoste('28110000', false, 'D');
    expect(amort?.asDeduction).toBe(true);
  });

  it('reste rétro-compatible sans signe fourni', () => {
    expect(classifyToPoste('41100000')?.side).toBe('ACTIF');
  });
});
