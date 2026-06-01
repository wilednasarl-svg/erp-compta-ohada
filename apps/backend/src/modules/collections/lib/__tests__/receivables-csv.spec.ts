import { buildReceivablesCsv, escapeCsvField, type ReceivableCsvRow } from '../receivables-csv';

function row(partial: Partial<ReceivableCsvRow> = {}): ReceivableCsvRow {
  return {
    partnerCode: '411DUPONT',
    partnerLabel: 'Dupont SARL',
    invoiceNumber: 'FA-2026-001',
    dueDate: '2026-04-30',
    amount: '1200000.00',
    overdueDays: '32',
    bucket: 'd31_60',
    ...partial,
  };
}

describe('receivables-csv', () => {
  describe('escapeCsvField', () => {
    it('laisse un champ simple intact', () => {
      expect(escapeCsvField('Dupont SARL')).toBe('Dupont SARL');
    });

    it('entoure de guillemets et double les guillemets internes', () => {
      expect(escapeCsvField('Éts "Le Bon"; Cie')).toBe('"Éts ""Le Bon""; Cie"');
    });

    it('protège les retours à la ligne', () => {
      expect(escapeCsvField('ligne1\nligne2')).toBe('"ligne1\nligne2"');
    });
  });

  describe('buildReceivablesCsv', () => {
    it('génère un en-tête puis une ligne par créance, en CRLF', () => {
      const csv = buildReceivablesCsv([row()]);
      const lines = csv.split('\r\n');
      expect(lines[0]).toBe(
        'Compte tiers;Tiers;Pièce / Facture;Échéance;Montant;Jours de retard;Tranche',
      );
      expect(lines[1]).toBe('411DUPONT;Dupont SARL;FA-2026-001;2026-04-30;1200000.00;32;d31_60');
      expect(lines[2]).toBe(''); // trailing EOL
    });

    it('échappe les champs contenant le séparateur', () => {
      const csv = buildReceivablesCsv([row({ partnerLabel: 'Le Bon; Cie' })]);
      expect(csv).toContain('"Le Bon; Cie"');
    });

    it('ajoute le BOM UTF-8 quand demandé', () => {
      const csv = buildReceivablesCsv([], { withBom: true });
      expect(csv.charCodeAt(0)).toBe(0xfeff);
    });

    it('produit seulement l\'en-tête pour une liste vide', () => {
      const csv = buildReceivablesCsv([]);
      expect(csv).toBe(
        'Compte tiers;Tiers;Pièce / Facture;Échéance;Montant;Jours de retard;Tranche\r\n',
      );
    });
  });
});
