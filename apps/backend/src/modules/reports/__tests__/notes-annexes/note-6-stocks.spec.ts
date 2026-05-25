import type { NoteId, NoteInventoryItem } from '../../services/notes-annexes';
import { buildHarness } from './test-helpers';

function item(o: Partial<NoteInventoryItem> & { id: string; family: NoteInventoryItem['family'] }): NoteInventoryItem {
  return {
    code: 'SKU-' + o.id,
    label: 'Item ' + o.id,
    currentQty: '0.0000',
    currentCmp: '0.0000',
    ...o,
  };
}

describe('Note 6 — Stocks', () => {
  it('ventile par famille et calcule la valeur = qty × cmp', async () => {
    const { service, inventoryMock, request } = buildHarness();
    inventoryMock.findAllItems.mockResolvedValue([
      item({ id: '1', family: 'marchandises', currentQty: '10.0000', currentCmp: '100.0000' }),
      item({ id: '2', family: 'marchandises', currentQty: '5.0000', currentCmp: '200.0000' }),
      item({ id: '3', family: 'matieres', currentQty: '50.0000', currentCmp: '4.0000' }),
      item({ id: '4', family: 'produits_finis', currentQty: '2.0000', currentCmp: '500.0000' }),
      item({ id: '5', family: 'fournitures', currentQty: '0.0000', currentCmp: '99.0000' }),
    ]);

    const n6 = await service.getNote(request, 'N6' as NoteId);
    expect(n6.applicable).toBe(true);

    const byKey = new Map(n6.rows.map((r) => [r.key, r]));
    // Marchandises = 10*100 + 5*200 = 1000 + 1000 = 2000
    expect(byKey.get('MARCHANDISES')?.values.valeur).toBe('2000.00');
    expect(byKey.get('MARCHANDISES')?.values.nbArticles).toBe('2');
    // Matieres = 50*4 = 200
    expect(byKey.get('MATIERES')?.values.valeur).toBe('200.00');
    // PF = 2*500 = 1000
    expect(byKey.get('PRODUITS_FINIS')?.values.valeur).toBe('1000.00');
    // Fournitures qty 0 -> 0
    expect(byKey.get('FOURNITURES')?.values.valeur).toBe('0.00');

    expect(byKey.get('TOTAL')?.values.valeur).toBe('3200.00');
    expect(byKey.get('TOTAL')?.values.nbArticles).toBe('5');
  });

  it('renvoie applicable=false si aucun item', async () => {
    const { service, request } = buildHarness();
    const n6 = await service.getNote(request, 'N6' as NoteId);
    expect(n6.applicable).toBe(false);
  });
});
