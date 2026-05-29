import { describe, expect, it } from 'vitest';

import { buildImportPlan } from './plan';

describe('buildImportPlan', () => {
  it('résout le parent comme le plus long code existant préfixant le code', () => {
    const plan = buildImportPlan(['4011', '604'], [
      { code: '40110000', label: 'Fournisseurs locaux' },
      { code: '60420000', label: 'Achats' },
    ]);
    expect(plan.toCreate).toBe(2);
    const a = plan.items.find((i) => i.code === '40110000')!;
    const b = plan.items.find((i) => i.code === '60420000')!;
    expect(a).toMatchObject({ status: 'create', parentCode: '4011' });
    expect(b).toMatchObject({ status: 'create', parentCode: '604' });
  });

  it('marque « exists » un code déjà présent', () => {
    const plan = buildImportPlan(['4011'], [{ code: '4011', label: 'x' }]);
    expect(plan.existing).toBe(1);
    expect(plan.toCreate).toBe(0);
    expect(plan.items[0]!.status).toBe('exists');
  });

  it('crée les parents avant les enfants (tri par longueur) en chaîne', () => {
    // Aucun préfixe existant sauf « 6 » : 60 → 602 → 60213000 se créent en cascade.
    const plan = buildImportPlan(['6'], [
      { code: '60213000', label: 'feuille' },
      { code: '602', label: 'parent' },
      { code: '60', label: 'grand-parent' },
    ]);
    expect(plan.toCreate).toBe(3);
    expect(plan.items.map((i) => i.code)).toEqual(['60', '602', '60213000']);
    expect(plan.items.find((i) => i.code === '60213000')!.parentCode).toBe('602');
  });

  it('bloque une ligne dont aucun parent n’est connu', () => {
    const plan = buildImportPlan([], [{ code: '60213000', label: 'orphelin' }]);
    expect(plan.blocked).toBe(1);
    expect(plan.items[0]!.status).toBe('no-parent');
  });

  it('respecte un parent explicite valide du fichier', () => {
    const plan = buildImportPlan(['401', '4011'], [
      { code: '40110000', label: 'x', parentCode: '4011' },
    ]);
    expect(plan.items[0]).toMatchObject({ status: 'create', parentCode: '4011' });
  });

  it('ignore un parent explicite invalide (non préfixe) et retombe sur la résolution', () => {
    const plan = buildImportPlan(['401'], [{ code: '40110000', label: 'x', parentCode: '999' }]);
    expect(plan.items[0]).toMatchObject({ status: 'create', parentCode: '401' });
  });
});
