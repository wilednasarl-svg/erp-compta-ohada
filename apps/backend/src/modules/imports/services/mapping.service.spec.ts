import { MappingService } from './mapping.service';

describe('MappingService', () => {
  let service: MappingService;

  beforeEach(() => {
    service = new MappingService();
  });

  describe('autoMap', () => {
    it('maps standard French headers to canonical targets', () => {
      const proposal = service.autoMap(['Compte', 'Journal', 'Date', 'Débit', 'Crédit', 'Libellé']);

      expect(proposal.headerToTarget).toEqual({
        Compte: 'account',
        Journal: 'journal',
        Date: 'date',
        Débit: 'debit',
        Crédit: 'credit',
        Libellé: 'label',
      });
      expect(proposal.unmappedTargets).toEqual(expect.arrayContaining(['partner', 'currency']));
    });

    it('normalises case, accents and surrounding whitespace', () => {
      const proposal = service.autoMap(['  COMPTE GENERAL  ', 'DATE ÉCRITURE', 'tiers', 'devise']);

      expect(proposal.headerToTarget).toEqual({
        '  COMPTE GENERAL  ': 'account',
        'DATE ÉCRITURE': 'date',
        tiers: 'partner',
        devise: 'currency',
      });
    });

    it('keeps the first match when multiple headers normalise to the same synonym', () => {
      const proposal = service.autoMap(['compte', 'COMPTE', 'compte general']);

      // First "compte" wins, the second and third are ignored because the
      // `account` target is already taken.
      expect(proposal.headerToTarget).toEqual({ compte: 'account' });
    });

    it('reports targets that no header covered', () => {
      const proposal = service.autoMap(['compte', 'date']);

      expect(proposal.unmappedTargets).toEqual(
        expect.arrayContaining(['journal', 'debit', 'credit', 'label', 'partner', 'currency']),
      );
      expect(proposal.unmappedTargets).not.toContain('account');
      expect(proposal.unmappedTargets).not.toContain('date');
    });

    it('ignores empty / whitespace-only headers', () => {
      const proposal = service.autoMap(['', '   ', 'compte']);
      expect(proposal.headerToTarget).toEqual({ compte: 'account' });
    });

    it('skips unrecognised headers without throwing', () => {
      const proposal = service.autoMap(['compte', 'foo_bar_baz', 'journal']);

      expect(proposal.headerToTarget).toEqual({
        compte: 'account',
        journal: 'journal',
      });
      expect(proposal.headerToTarget).not.toHaveProperty('foo_bar_baz');
    });
  });

  describe('applyMapping', () => {
    it('projects raw values onto canonical fields using the mapping', () => {
      const mapped = service.applyMapping(
        { Compte: '4111', Journal: 'VTE', Date: '2024-03-15', Débit: '1500,00', Crédit: null },
        { Compte: 'account', Journal: 'journal', Date: 'date', Débit: 'debit', Crédit: 'credit' },
      );

      expect(mapped).toEqual({
        account: '4111',
        journal: 'VTE',
        date: '2024-03-15',
        debit: '1500,00',
        credit: null,
      });
    });

    it('returns null for headers absent from the raw values', () => {
      const mapped = service.applyMapping({}, { Compte: 'account' });
      expect(mapped).toEqual({ account: null });
    });

    it('returns an empty mapping when no header → target rule exists', () => {
      const mapped = service.applyMapping({ Compte: '4111' }, {});
      expect(mapped).toEqual({});
    });
  });
});
