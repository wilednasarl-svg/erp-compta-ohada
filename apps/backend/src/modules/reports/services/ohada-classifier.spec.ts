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

  it('route le compte courant associé 466 par le signe (Guide T3, comme 462/463)', () => {
    // 466 « Associés/Groupe, comptes courants » : créditeur = dette → poste
    // passif DM « Autres dettes » (Note 19) ; débiteur = créance → actif BJ.
    // (Auparavant 466 n'était dans aucun poste → solde exclu du total et
    // bilan déséquilibré sur une balance pourtant juste.)
    const crediteur = classifyToPoste('46610000', false, 'C');
    expect(crediteur?.side).toBe('PASSIF');
    expect(crediteur?.posteCode).toBe('DM');
    expect(classifyToPoste('46610000', false, 'D')?.side).toBe('ACTIF');
  });

  it('retourne null pour un compte hors bilan (classe 6 = compte de résultat)', () => {
    // Une charge (classe 6) n'appartient pas au bilan → aucun poste lettré.
    expect(classifyToPoste('60110000', false, 'D')).toBeNull();
  });

  it('conserve la déduction pour les amortissements (préfixe le plus long)', () => {
    const amort = classifyToPoste('28110000', false, 'D');
    expect(amort?.asDeduction).toBe(true);
  });

  it('garde les amortissements OPPOSANTS créditeurs en déduction de l’actif (pas au passif)', () => {
    // Un amortissement a un solde créditeur ; le routage par signe ne doit
    // PAS l'envoyer au passif — il reste en déduction du poste actif.
    const amort = classifyToPoste('28110000', true, 'C');
    expect(amort?.side).toBe('ACTIF');
    expect(amort?.asDeduction).toBe(true);
  });

  it('reste rétro-compatible sans signe fourni', () => {
    expect(classifyToPoste('41100000')?.side).toBe('ACTIF');
  });
});
