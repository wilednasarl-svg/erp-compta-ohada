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

    it('maps standard FEC column headers to canonical targets', () => {
      const proposal = service.autoMap([
        'JournalCode',
        'EcritureDate',
        'CompteNum',
        'CompAuxNum',
        'PieceRef',
        'EcritureLib',
        'Debit',
        'Credit',
        'Idevise',
      ]);

      expect(proposal.headerToTarget).toEqual({
        JournalCode: 'journal',
        EcritureDate: 'date',
        CompteNum: 'account',
        CompAuxNum: 'partner',
        PieceRef: 'pieceNumber',
        EcritureLib: 'label',
        Debit: 'debit',
        Credit: 'credit',
        Idevise: 'currency',
      });
    });

    it('maps balance / grand-livre headers: Intitulé→label, N°Compte→account, C.J→journal', () => {
      const proposal = service.autoMap(['N°Compte', 'C.J', 'Intitulé', 'Débit', 'Crédit']);
      expect(proposal.headerToTarget).toEqual({
        'N°Compte': 'account',
        'C.J': 'journal',
        'Intitulé': 'label',
        'Débit': 'debit',
        'Crédit': 'credit',
      });
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

    it('maps the journal import template headers (Sage-style export)', () => {
      const proposal = service.autoMap([
        'Jo',
        'Date saisie',
        'N° pièce',
        'N° facture',
        'Référence',
        'N° compte général',
        'N° compte tiers',
        'Code taxe',
        'Libellé écriture',
        'Date échéance',
        'Débit',
        'Crédit',
      ]);

      // Toutes les colonnes du modèle sont reconnues, y compris les
      // métadonnées de pièce (décision produit : N° pièce obligatoire).
      expect(proposal.headerToTarget).toEqual({
        Jo: 'journal',
        'Date saisie': 'date',
        'N° pièce': 'pieceNumber',
        'N° facture': 'invoiceNumber',
        Référence: 'reference',
        'N° compte général': 'account',
        'N° compte tiers': 'partner',
        'Code taxe': 'taxCode',
        'Libellé écriture': 'label',
        'Date échéance': 'dueDate',
        Débit: 'debit',
        Crédit: 'credit',
      });
    });

    it('ignores the Sage « Jour » column (day-of-month) — it is NOT a journal nor a date', () => {
      const proposal = service.autoMap(
        [
          'Jour',
          'Date saisie',
          'N° pièce',
          'N° compte général',
          'Libellé écriture',
          'Débit',
          'Crédit',
        ],
        {},
        [
          { Jour: '8', 'Date saisie': '15/01/2025' },
          { Jour: '21', 'Date saisie': '22/01/2025' },
          { Jour: '9', 'Date saisie': '25/01/2025' },
        ],
      );

      expect(proposal.headerToTarget).not.toHaveProperty('Jour');
      expect(proposal.headerToTarget['Date saisie']).toBe('date');
    });

    it('does not infer a date from a day-of-month column via Excel serials', () => {
      // Sans « Date saisie », la colonne Jour (entiers 1-31) ne doit PAS
      // être inférée comme date : les séries Excel 1-31 seraient des
      // dates de janvier 1900, jamais légitimes en comptabilité.
      const proposal = service.autoMap(
        ['Jour', 'N° compte général', 'Libellé écriture', 'Débit', 'Crédit'],
        {},
        [
          { Jour: '8' },
          { Jour: '21' },
          { Jour: '9' },
          { Jour: '15' },
          { Jour: '28' },
        ],
      );

      expect(proposal.headerToTarget).not.toHaveProperty('Jour');
    });

    it('maps an EBP-style export (N° de pièce, N° de compte, Date de pièce)', () => {
      const proposal = service.autoMap([
        'Journal',
        'Date de pièce',
        'N° de pièce',
        'N° de compte',
        'Intitulé',
        'Débit',
        'Crédit',
      ]);

      expect(proposal.headerToTarget).toEqual({
        Journal: 'journal',
        'Date de pièce': 'date',
        'N° de pièce': 'pieceNumber',
        'N° de compte': 'account',
        Intitulé: 'label',
        Débit: 'debit',
        Crédit: 'credit',
      });
    });

    it('maps an Odoo FR journal items export (Numéro, Partenaire)', () => {
      const proposal = service.autoMap([
        'Date',
        'Journal',
        'Numéro',
        'Compte',
        'Partenaire',
        'Libellé',
        'Débit',
        'Crédit',
      ]);

      expect(proposal.headerToTarget).toEqual({
        Date: 'date',
        Journal: 'journal',
        Numéro: 'pieceNumber',
        Compte: 'account',
        Partenaire: 'partner',
        Libellé: 'label',
        Débit: 'debit',
        Crédit: 'credit',
      });
    });

    it('maps an Odoo EN journal items export (Number, Partner)', () => {
      const proposal = service.autoMap([
        'Date',
        'Journal',
        'Number',
        'Account',
        'Partner',
        'Label',
        'Debit',
        'Credit',
      ]);

      expect(proposal.headerToTarget).toEqual({
        Date: 'date',
        Journal: 'journal',
        Number: 'pieceNumber',
        Account: 'account',
        Partner: 'partner',
        Label: 'label',
        Debit: 'debit',
        Credit: 'credit',
      });
    });

    it('maps a Ciel-style export (Mt Débit / Mt Crédit, Compte auxiliaire)', () => {
      const proposal = service.autoMap([
        'Code Journal',
        'Date',
        'N° Pièce',
        'N° Compte',
        'Compte auxiliaire',
        'Libellé',
        'Mt Débit',
        'Mt Crédit',
      ]);

      expect(proposal.headerToTarget).toEqual({
        'Code Journal': 'journal',
        Date: 'date',
        'N° Pièce': 'pieceNumber',
        'N° Compte': 'account',
        'Compte auxiliaire': 'partner',
        Libellé: 'label',
        'Mt Débit': 'debit',
        'Mt Crédit': 'credit',
      });
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
