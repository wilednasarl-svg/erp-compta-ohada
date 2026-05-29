import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { PdfFileParser } from './pdf-file.parser';
import { FileParseError } from './types';

/**
 * Tests du `PdfFileParser` en mockant `pdf-parse`. On évite ainsi
 * d'instancier pdfjs-dist qui exige `--experimental-vm-modules` côté
 * jest (sa worker thread fait un dynamic import ESM bloqué par le
 * loader CJS par défaut). Les tests vérifient notre LOGIQUE de
 * sélection de tableau + génération de ParseResult ; la qualité
 * d'extraction pdfjs elle-même est validée en intégration sur prod.
 */
describe('PdfFileParser', () => {
  let workDir: string;
  let parser: PdfFileParser;

  beforeEach(async () => {
    workDir = await mkdtemp(path.join(tmpdir(), 'erp-pdf-test-'));
    parser = new PdfFileParser();
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  describe('canHandle', () => {
    it('accepte une extension .pdf', () => {
      expect(
        parser.canHandle({ originalName: 'export.pdf', mimeType: 'application/octet-stream' }),
      ).toBe(true);
    });

    it('accepte le MIME application/pdf même sans extension', () => {
      expect(parser.canHandle({ originalName: 'export', mimeType: 'application/pdf' })).toBe(true);
    });

    it('rejette les autres formats', () => {
      expect(parser.canHandle({ originalName: 'doc.csv', mimeType: 'text/csv' })).toBe(false);
      expect(parser.canHandle({ originalName: 'doc.xlsx', mimeType: 'application/zip' })).toBe(
        false,
      );
    });
  });

  describe('parse', () => {
    /**
     * Crée un fichier dummy + injecte un faux `PDFParse` via le hook
     * `loadPdfParse` (testable seam). Le contenu binaire n'a pas
     * d'importance — notre mock pdf-parse ne le lit pas.
     */
    async function setupWithMockedPdfParse(
      pdfBody: Buffer,
      mock: {
        getTable?: () => Promise<{
          mergedTables: string[][][];
          pages: Array<{ tables: string[][][] }>;
        }>;
        getText?: () => Promise<{ text: string }>;
      },
    ): Promise<string> {
      const filePath = path.join(workDir, 'fixture.pdf');
      await writeFile(filePath, pdfBody);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fakeCtor: any = jest.fn().mockImplementation(() => ({
        getTable:
          mock.getTable ??
          (async () => ({
            mergedTables: [] as string[][][],
            pages: [] as Array<{ tables: string[][][] }>,
          })),
        getText: mock.getText ?? (async () => ({ text: '' })),
      }));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (parser as any).loadPdfParse = async () => ({ PDFParse: fakeCtor }) as any;
      return filePath;
    }

    it('extrait un tableau structuré via getTable() (chemin nominal)', async () => {
      const pdfPath = await setupWithMockedPdfParse(Buffer.from('%PDF-1.4\nfake'), {
        getTable: async () => ({
          mergedTables: [
            [
              ['Date', 'Compte', 'Libelle', 'Debit', 'Credit'],
              ['2026-01-15', '411000', 'Vente client X', '120000.00', '0.00'],
              ['2026-01-15', '701000', 'Vente client X', '0.00', '120000.00'],
            ],
          ],
          pages: [],
        }),
      });

      const { headers, rows } = await parser.parse(pdfPath);
      expect(headers).toEqual(['Date', 'Compte', 'Libelle', 'Debit', 'Credit']);

      const collected: Array<Record<string, string | null>> = [];
      for await (const row of rows) {
        collected.push(row.values);
      }
      expect(collected).toHaveLength(2);
      expect(collected[0]).toMatchObject({
        Date: '2026-01-15',
        Compte: '411000',
        Debit: '120000.00',
        Credit: '0.00',
      });
    });

    it('préfère le tableau avec le plus de lignes quand plusieurs candidats existent', async () => {
      const pdfPath = await setupWithMockedPdfParse(Buffer.from('%PDF-1.4'), {
        getTable: async () => ({
          mergedTables: [
            // Petit tableau de récap — 2 lignes
            [
              ['Total', 'Debit', 'Credit', 'Solde'],
              ['Janvier', '120000', '120000', '0'],
            ],
            // Vrai détail — 4 lignes, doit gagner
            [
              ['Date', 'Compte', 'Libelle', 'Debit', 'Credit'],
              ['2026-01-15', '411000', 'A', '100', '0'],
              ['2026-01-15', '701000', 'A', '0', '100'],
              ['2026-01-20', '512000', 'B', '50', '0'],
            ],
          ],
          pages: [],
        }),
      });

      const { headers } = await parser.parse(pdfPath);
      expect(headers).toContain('Compte');
      expect(headers).toContain('Libelle');
    });

    it('ignore les tableaux avec moins de 4 colonnes (encarts de mise en page)', async () => {
      const pdfPath = await setupWithMockedPdfParse(Buffer.from('%PDF-1.4'), {
        getTable: async () => ({
          mergedTables: [
            [
              ['Logo', 'Société'],
              ['ACME', 'SARL'],
            ],
          ],
          pages: [],
        }),
        getText: async () => ({ text: '' }),
      });

      await expect(parser.parse(pdfPath)).rejects.toBeInstanceOf(FileParseError);
    });

    it('tombe sur le fallback texte si getTable() ne retourne rien exploitable', async () => {
      const pdfPath = await setupWithMockedPdfParse(Buffer.from('%PDF-1.4'), {
        getTable: async () => ({ mergedTables: [], pages: [] }),
        getText: async () => ({
          text: [
            'Date        Compte      Libelle               Debit        Credit',
            '2026-01-15  411000      Vente client X        120000.00    0.00',
            '2026-01-15  701000      Vente client X        0.00         120000.00',
          ].join('\n'),
        }),
      });

      const { headers, rows } = await parser.parse(pdfPath);
      expect(headers).toEqual(['Date', 'Compte', 'Libelle', 'Debit', 'Credit']);

      const collected: Array<Record<string, string | null>> = [];
      for await (const row of rows) {
        collected.push(row.values);
      }
      expect(collected).toHaveLength(2);
      expect(collected[0].Date).toBe('2026-01-15');
    });

    it('rejette un PDF prose libre (probablement scan ou sans tableau)', async () => {
      const pdfPath = await setupWithMockedPdfParse(Buffer.from('%PDF-1.4'), {
        getTable: async () => ({ mergedTables: [], pages: [] }),
        getText: async () => ({
          text: 'Note de service interne. Texte sans structure tabulaire.',
        }),
      });
      await expect(parser.parse(pdfPath)).rejects.toBeInstanceOf(FileParseError);
    });

    it("rejette quand getText() rend vide (cas PDF scanné, pointe vers l'OCR)", async () => {
      const pdfPath = await setupWithMockedPdfParse(Buffer.from('%PDF-1.4'), {
        getTable: async () => ({ mergedTables: [], pages: [] }),
        getText: async () => ({ text: '' }),
      });
      await expect(parser.parse(pdfPath)).rejects.toBeInstanceOf(FileParseError);
    });

    it("propage une FileParseError si l'init PDFParse jette", async () => {
      const filePath = path.join(workDir, 'broken.pdf');
      await writeFile(filePath, Buffer.from('not a pdf'));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (parser as any).loadPdfParse = async () => ({
        PDFParse: function FakeCtor(): never {
          throw new Error('pdfjs init failed');
        },
      });
      await expect(parser.parse(filePath)).rejects.toBeInstanceOf(FileParseError);
    });

    it('remplace un header vide par col_N pour préserver les colonnes', async () => {
      const pdfPath = await setupWithMockedPdfParse(Buffer.from('%PDF-1.4'), {
        getTable: async () => ({
          mergedTables: [
            [
              ['Date', '', 'Libelle', 'Debit', 'Credit'],
              ['2026-01-15', '411000', 'A', '100', '0'],
            ],
          ],
          pages: [],
        }),
      });

      const { headers } = await parser.parse(pdfPath);
      expect(headers).toEqual(['Date', 'col_2', 'Libelle', 'Debit', 'Credit']);
    });
  });
});
