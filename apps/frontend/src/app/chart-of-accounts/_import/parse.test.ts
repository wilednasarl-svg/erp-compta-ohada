import { describe, expect, it } from 'vitest';

import { detectColumns, normalizeRows } from './parse';

describe('detectColumns', () => {
  it('détecte code / libellé / parent malgré accents et casse', () => {
    expect(detectColumns(['N° Compte', 'Libellé', 'Parent'])).toEqual({
      codeKey: 'N° Compte',
      labelKey: 'Libellé',
      parentKey: 'Parent',
    });
  });

  it('renvoie null pour les colonnes absentes', () => {
    const m = detectColumns(['Foo', 'Bar']);
    expect(m.codeKey).toBeNull();
    expect(m.labelKey).toBeNull();
    expect(m.parentKey).toBeNull();
  });

  it('ne confond pas « parentCode » avec la colonne code', () => {
    const m = detectColumns(['parentCode', 'code', 'label']);
    expect(m.parentKey).toBe('parentCode');
    expect(m.codeKey).toBe('code');
    expect(m.labelKey).toBe('label');
  });
});

describe('normalizeRows', () => {
  it('nettoie le code (chiffres seuls) et conserve le libellé', () => {
    const res = normalizeRows([{ Code: ' 4011 ', Libellé: 'Fournisseurs locaux' }]);
    expect(res.rows).toEqual([{ code: '4011', label: 'Fournisseurs locaux' }]);
    expect(res.dropped).toBe(0);
  });

  it('inclut le parent quand la colonne existe', () => {
    const res = normalizeRows([{ code: '40110000', label: 'Fourn.', parent: '4011' }]);
    expect(res.rows[0]).toEqual({ code: '40110000', label: 'Fourn.', parentCode: '4011' });
  });

  it('ignore les lignes sans code ou libellé valides', () => {
    const res = normalizeRows([
      { code: '', label: 'x' },
      { code: '4011', label: '' },
      { code: '60410000', label: 'OK' },
    ]);
    expect(res.rows).toHaveLength(1);
    expect(res.dropped).toBe(2);
  });

  it('tout droppé si aucune colonne code/libellé détectée', () => {
    const res = normalizeRows([{ Foo: '1', Bar: '2' }]);
    expect(res.rows).toHaveLength(0);
    expect(res.dropped).toBe(1);
  });
});
