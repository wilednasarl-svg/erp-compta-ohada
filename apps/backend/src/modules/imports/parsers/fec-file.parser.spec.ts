import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { CsvFileParser } from './csv-file.parser';
import { FecFileParser } from './fec-file.parser';
import { FileParseError } from './types';

/**
 * Tests du `FecFileParser`. Le FEC (Fichier des Écritures Comptables)
 * étant un fichier délimité, le parsing réel est délégué au
 * `CsvFileParser` ; ces tests vérifient (1) la sélection via `canHandle`,
 * (2) le probe de contenu anti-faux-positif, (3) le parsing nominal d'un
 * FEC séparé par `|`.
 */
describe('FecFileParser', () => {
  let workDir: string;
  let parser: FecFileParser;

  // En-tête FEC standard à 18 colonnes (séparateur `|`).
  const FEC_HEADER =
    'JournalCode|JournalLib|EcritureNum|EcritureDate|CompteNum|CompteLib|' +
    'CompAuxNum|CompAuxLib|PieceRef|PieceDate|EcritureLib|Debit|Credit|' +
    'EcritureLet|DateLet|ValidDate|Montantdevise|Idevise';

  beforeEach(async () => {
    workDir = await mkdtemp(path.join(tmpdir(), 'erp-fec-test-'));
    parser = new FecFileParser(new CsvFileParser());
  });

  afterEach(async () => {
    // Nettoyage best-effort : sous Windows, le handle du flux de lecture
    // CSV peut n'être relâché qu'après un court délai, faisant échouer
    // `rm` (ENOTEMPTY/EBUSY) alors que les assertions, elles, ont réussi.
    // On ne laisse pas cette course casser le test — le tmpdir de l'OS
    // sera purgé de toute façon.
    try {
      await rm(workDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {
      // ignore — cleanup race, non significatif pour la validité du test.
    }
  });

  describe('canHandle', () => {
    it('accepte une extension .fec', () => {
      expect(
        parser.canHandle({ originalName: 'export.fec', mimeType: 'application/octet-stream' }),
      ).toBe(true);
    });

    it('accepte un .txt dont le nom évoque un FEC (convention DGFiP)', () => {
      expect(
        parser.canHandle({ originalName: '123456789FEC20251231.txt', mimeType: 'text/plain' }),
      ).toBe(true);
    });

    it('accepte un .csv nommé FEC', () => {
      expect(parser.canHandle({ originalName: 'FEC_2025.csv', mimeType: 'text/csv' })).toBe(true);
    });

    it('laisse les .txt génériques au parser Sage (pas de "fec" dans le nom)', () => {
      expect(parser.canHandle({ originalName: 'export_sage.txt', mimeType: 'text/plain' })).toBe(
        false,
      );
    });

    it('rejette les formats non textuels et les autres extensions', () => {
      expect(parser.canHandle({ originalName: 'fec.ofx', mimeType: 'text/plain' })).toBe(false);
      expect(parser.canHandle({ originalName: 'fec.fec', mimeType: 'application/pdf' })).toBe(false);
    });
  });

  describe('parse', () => {
    it('parse un FEC séparé par `|` et expose les en-têtes canoniques', async () => {
      const filePath = path.join(workDir, 'FEC.txt');
      await writeFile(
        filePath,
        [
          FEC_HEADER,
          'VT|Ventes|1|20251231|411000|Clients|CL001|Client X|FAC001|20251231|Vente|1200,00|0,00|||20251231|0,00|EUR',
          'VT|Ventes|1|20251231|701000|Ventes|||FAC001|20251231|Vente|0,00|1200,00|||20251231|0,00|EUR',
        ].join('\n'),
        'utf8',
      );

      const { headers, rows } = await parser.parse(filePath);
      expect(headers).toContain('JournalCode');
      expect(headers).toContain('CompteNum');
      expect(headers).toContain('EcritureDate');
      expect(headers).toHaveLength(18);

      const collected: Array<Record<string, string | null>> = [];
      for await (const row of rows) {
        collected.push(row.values);
      }
      expect(collected).toHaveLength(2);
      expect(collected[0]).toMatchObject({
        JournalCode: 'VT',
        CompteNum: '411000',
        EcritureDate: '20251231',
        Debit: '1200,00',
      });
    });

    it('rejette un fichier nommé FEC mais sans structure FEC (probe de contenu)', async () => {
      const filePath = path.join(workDir, 'faux-fec.txt');
      await writeFile(filePath, 'Bonjour\nCeci n’est pas un FEC.\n', 'utf8');
      await expect(parser.parse(filePath)).rejects.toBeInstanceOf(FileParseError);
    });

    it('rejette un FEC vide', async () => {
      const filePath = path.join(workDir, 'vide.fec');
      await writeFile(filePath, '', 'utf8');
      await expect(parser.parse(filePath)).rejects.toBeInstanceOf(FileParseError);
    });
  });
});
