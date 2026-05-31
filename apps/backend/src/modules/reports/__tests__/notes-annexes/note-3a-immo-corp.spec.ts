import type { NoteAssetRecord, NoteDepreciationRecord, NoteId } from '../../services/notes-annexes';
import { buildHarness } from './test-helpers';

function asset(
  o: Partial<NoteAssetRecord> & { id: string; assetAccountCode: string },
): NoteAssetRecord {
  const defaults = {
    code: 'A-' + o.id.slice(0, 4),
    label: 'Asset ' + o.id,
    acquisitionDate: '2025-01-15',
    acquisitionCost: '10000.00',
    status: 'active' as const,
    disposalDate: null as string | null,
    disposalValue: null as string | null,
  };
  return { ...defaults, ...o };
}

function sched(o: Partial<NoteDepreciationRecord> & { assetId: string }): NoteDepreciationRecord {
  return {
    fiscalYear: 2026,
    depreciationAmount: '0.00',
    cumulativeDepreciation: '0.00',
    netBookValue: '0.00',
    ...o,
  };
}

describe('Note 3A — Immobilisations corporelles', () => {
  it('ventile en TERRAINS / CONSTRUCTIONS / MATERIEL + TOTAL et somme cohérente', async () => {
    const { service, assetsMock, reportsMock, request } = buildHarness();

    // Comptabilité cohérente avec le registre : brut 170 000 (22/23/24)
    // − amort 4 000 (28x) = net 166 000 = VNC registre → aucune alerte.
    reportsMock.accountBalancesAsAt.mockResolvedValue([
      { accountCode: '224000', totalDebit: '50000.00', totalCredit: '0.00' },
      { accountCode: '231000', totalDebit: '120000.00', totalCredit: '0.00' },
      { accountCode: '283100', totalDebit: '0.00', totalCredit: '4000.00' },
    ]);

    // Terrain (22x) acquis avant exercice.
    const a1 = asset({
      id: 'a1',
      assetAccountCode: '224000',
      acquisitionCost: '50000.00',
      acquisitionDate: '2023-06-01',
    });
    // Bâtiment (23x) acquis dans l'exercice.
    const a2 = asset({
      id: 'a2',
      assetAccountCode: '231000',
      acquisitionCost: '120000.00',
      acquisitionDate: '2026-04-10',
    });
    // Matériel (24x) cédé dans l'exercice.
    const a3 = asset({
      id: 'a3',
      assetAccountCode: '244000',
      acquisitionCost: '20000.00',
      acquisitionDate: '2022-01-01',
      status: 'disposed',
      disposalDate: '2026-09-30',
      disposalValue: '5000.00',
    });
    assetsMock.findAllForExercise.mockResolvedValue([a1, a2, a3]);

    // Schedules : matériel a3 amorti à 80%, bâtiment a2 amorti 1 an, terrain pas d'amort.
    assetsMock.findDepreciationForYear.mockResolvedValue([
      sched({
        assetId: 'a2',
        depreciationAmount: '4000.00',
        cumulativeDepreciation: '4000.00',
        netBookValue: '116000.00',
      }),
      sched({
        assetId: 'a3',
        depreciationAmount: '4000.00',
        cumulativeDepreciation: '16000.00',
        netBookValue: '4000.00',
      }),
    ]);

    const n3a = await service.getNote(request, 'N3A' as NoteId);

    expect(n3a.applicable).toBe(true);
    const byKey = new Map(n3a.rows.map((r) => [r.key, r]));

    // TERRAINS
    expect(byKey.get('TERRAINS')?.values.brutOuverture).toBe('50000.00');
    expect(byKey.get('TERRAINS')?.values.acquisitions).toBe('0.00');
    expect(byKey.get('TERRAINS')?.values.brutCloture).toBe('50000.00');
    expect(byKey.get('TERRAINS')?.values.amortCloture).toBe('0.00');

    // CONSTRUCTIONS (acquisition exercice)
    expect(byKey.get('CONSTRUCTIONS')?.values.brutOuverture).toBe('0.00');
    expect(byKey.get('CONSTRUCTIONS')?.values.acquisitions).toBe('120000.00');
    expect(byKey.get('CONSTRUCTIONS')?.values.brutCloture).toBe('120000.00');
    expect(byKey.get('CONSTRUCTIONS')?.values.dotation).toBe('4000.00');

    // MATERIEL (cession)
    expect(byKey.get('MATERIEL')?.values.brutOuverture).toBe('20000.00');
    expect(byKey.get('MATERIEL')?.values.cessions).toBe('20000.00');
    expect(byKey.get('MATERIEL')?.values.brutCloture).toBe('0.00');
    // Reprise sur cessions = cumul du schedule
    expect(byKey.get('MATERIEL')?.values.repriseCessions).toBe('16000.00');

    // TOTAL
    const total = byKey.get('TOTAL')!;
    // Brut clôture : 50000 (terrain) + 120000 (bât.) + 0 (mat. cédé) = 170000
    expect(total.values.brutCloture).toBe('170000.00');
    // Amort clôture :
    //   - TERRAINS = 0
    //   - CONSTRUCTIONS : amortOuv (4000-4000=0) + dot 4000 - reprise 0 = 4000
    //   - MATERIEL : amortOuv (16000-4000=12000) + dot 4000 - reprise 16000 = 0
    //   Total = 0 + 4000 + 0 = 4000.
    expect(total.values.amortCloture).toBe('4000.00');
    // VNC = brutCloture - amortCloture = 170000 - 4000 = 166000
    expect(total.values.vnc).toBe('166000.00');

    // Registre et comptabilité concordants → pas de ligne de contrôle.
    expect(byKey.has('CONTROLE_COHERENCE')).toBe(false);
  });

  it('signale un écart registre/comptabilité (contrôle de cohérence 8vny)', async () => {
    const { service, assetsMock, reportsMock, request } = buildHarness();

    // Registre : un terrain à 50 000, non amorti → VNC registre = 50 000.
    assetsMock.findAllForExercise.mockResolvedValue([
      asset({
        id: 'a1',
        assetAccountCode: '224000',
        acquisitionCost: '50000.00',
        acquisitionDate: '2023-06-01',
      }),
    ]);
    // Comptabilité : le compte 224 ne porte que 40 000 → écart de 10 000.
    reportsMock.accountBalancesAsAt.mockResolvedValue([
      { accountCode: '224000', totalDebit: '40000.00', totalCredit: '0.00' },
    ]);

    const n3a = await service.getNote(request, 'N3A' as NoteId);
    const byKey = new Map(n3a.rows.map((r) => [r.key, r]));

    const controle = byKey.get('CONTROLE_COHERENCE');
    expect(controle).toBeDefined();
    // La colonne VNC porte le net comptable du bilan (40 000).
    expect(controle?.values.vnc).toBe('40000.00');
    // L'écart (50 000 − 40 000 = 10 000) est mentionné dans le libellé.
    expect(controle?.label).toContain('10000.00');
  });

  it('renvoie applicable=false si aucun asset corporel', async () => {
    const { service, request } = buildHarness();
    const n3a = await service.getNote(request, 'N3A' as NoteId);
    expect(n3a.applicable).toBe(false);
  });
});
