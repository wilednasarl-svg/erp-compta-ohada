import { AppException } from '../../../../common/errors/app-exception';
import { asTenantId } from '../../../../common/persistence/tenant-scope';
import type {
  OpenReceivableLine,
  OpenReceivablesRepository,
} from '../../repositories/open-receivables.repository';
import { CollectionsService } from '../collections.service';

const ORG = asTenantId('22222222-2222-4222-8222-222222222222');
const REF = '2026-06-01';

function line(partial: Partial<OpenReceivableLine>): OpenReceivableLine {
  return {
    partnerAccountId: 'p1',
    partnerCode: '411DUP',
    partnerLabel: '411DUP Dupont SARL',
    invoiceNumber: 'FA-1',
    dueDate: '2026-04-30',
    amount: '1000000.00',
    ...partial,
  };
}

function makeService(lines: OpenReceivableLine[]): {
  service: CollectionsService;
  list: jest.Mock;
} {
  const list = jest.fn().mockResolvedValue(lines);
  const repo = { listOpenClientLines: list } as unknown as OpenReceivablesRepository;
  return { service: new CollectionsService(repo), list };
}

describe('CollectionsService', () => {
  describe('getReceivablesDetail', () => {
    it('calcule le retard et la tranche par ligne', async () => {
      const { service } = makeService([line({ dueDate: '2026-04-30' })]);
      const rows = await service.getReceivablesDetail(ORG, { referenceDate: REF });
      expect(rows[0].overdueDays).toBe(32);
      expect(rows[0].bucket).toBe('d31_60');
    });

    it('filtre les non-échues quand overdueOnly est vrai', async () => {
      const { service } = makeService([
        line({ invoiceNumber: 'A', dueDate: '2026-04-30' }), // échu
        line({ invoiceNumber: 'B', dueDate: '2026-07-15' }), // à échoir
      ]);
      const all = await service.getReceivablesDetail(ORG, { referenceDate: REF });
      const overdue = await service.getReceivablesDetail(ORG, {
        referenceDate: REF,
        overdueOnly: true,
      });
      expect(all).toHaveLength(2);
      expect(overdue).toHaveLength(1);
      expect(overdue[0].invoiceNumber).toBe('A');
    });
  });

  describe('getDunningCandidates', () => {
    it('regroupe par client, calcule le palier et trie par retard décroissant', async () => {
      const { service } = makeService([
        line({ partnerAccountId: 'p1', partnerCode: '411A', dueDate: '2026-05-20', amount: '500000.00' }), // 12 j -> reminder
        line({ partnerAccountId: 'p2', partnerCode: '411B', dueDate: '2026-01-01', amount: '800000.00' }), // >90 -> formal_notice
        line({ partnerAccountId: 'p3', partnerCode: '411C', dueDate: '2026-07-01', amount: '300000.00' }), // futur -> exclu
      ]);
      const candidates = await service.getDunningCandidates(ORG, REF);
      expect(candidates).toHaveLength(2);
      expect(candidates[0].partnerCode).toBe('411B'); // plus gros retard en tête
      expect(candidates[0].level).toBe('formal_notice');
      expect(candidates[1].level).toBe('reminder');
    });

    it('sépare total ouvert et total échu', async () => {
      const { service } = makeService([
        line({ partnerAccountId: 'p1', partnerCode: '411A', invoiceNumber: 'X', dueDate: '2026-04-01', amount: '600000.00' }),
        line({ partnerAccountId: 'p1', partnerCode: '411A', invoiceNumber: 'Y', dueDate: '2026-07-30', amount: '400000.00' }),
      ]);
      const [c] = await service.getDunningCandidates(ORG, REF);
      expect(c.totalOpen).toBe('1000000.00');
      expect(c.totalOverdue).toBe('600000.00');
      expect(c.overdueInvoiceCount).toBe(1);
      expect(c.invoiceCount).toBe(2);
    });
  });

  describe('buildLetter', () => {
    it('lève COLLECTIONS_NO_OVERDUE si rien n\'est échu', async () => {
      const { service } = makeService([line({ dueDate: '2026-09-01' })]);
      await expect(
        service.buildLetter(ORG, 'p1', { referenceDate: REF, creditorName: 'Gravel' }),
      ).rejects.toBeInstanceOf(AppException);
    });

    it('génère la lettre avec le total échu', async () => {
      const { service } = makeService([
        line({ invoiceNumber: 'FA-1', dueDate: '2026-04-30', amount: '1000000.00' }),
        line({ invoiceNumber: 'FA-2', dueDate: '2026-05-31', amount: '500000.00' }),
      ]);
      const letter = await service.buildLetter(ORG, 'p1', {
        referenceDate: REF,
        creditorName: 'Gravel Ivoire SA',
      });
      expect(letter.body).toContain('Total dû : 1500000.00 XOF');
      expect(letter.body).toContain('FA-1');
      expect(letter.body).toContain('FA-2');
    });
  });

  describe('exportReceivablesCsv', () => {
    it('produit un CSV avec BOM et en-tête', async () => {
      const { service } = makeService([line({})]);
      const csv = await service.exportReceivablesCsv(ORG, { referenceDate: REF });
      expect(csv.charCodeAt(0)).toBe(0xfeff);
      expect(csv).toContain('Compte tiers;Tiers;Pièce / Facture');
      expect(csv).toContain('411DUP Dupont SARL');
    });
  });
});
