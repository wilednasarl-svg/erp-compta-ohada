import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { CsvFileParser } from './csv-file.parser';

/**
 * Tests du `CsvFileParser`, centrés sur la détection d'encodage : un export
 * Sage/Ciel français est souvent en latin1/CP1252. Lu comme UTF-8, ses
 * accents deviennent `�` et l'auto-mapping casse. Ces tests garantissent
 * que les en-têtes et valeurs accentués ressortent intacts quel que soit
 * l'encodage source.
 */
describe('CsvFileParser', () => {
  let workDir: string;
  let parser: CsvFileParser;

  const HEADER = 'N° pièce;N° compte général;Libellé écriture;Débit;Crédit';
  const ROW = 'P001;60110000;Achat numéroté;1500000;0';

  beforeEach(async () => {
    workDir = await mkdtemp(path.join(tmpdir(), 'erp-csv-enc-'));
    parser = new CsvFileParser();
  });

  afterEach(async () => {
    try {
      await rm(workDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {
      /* cleanup best-effort (verrou fd Windows) */
    }
  });

  async function writeAndParse(buffer: Buffer, name = 'export.csv') {
    const filePath = path.join(workDir, name);
    await writeFile(filePath, buffer);
    const { headers, rows } = await parser.parse(filePath);
    const collected: Array<Record<string, string | null>> = [];
    for await (const r of rows) collected.push(r.values);
    return { headers, rows: collected };
  }

  it('lit correctement les accents d’un fichier latin1/CP1252 (export Sage FR)', async () => {
    const { headers, rows } = await writeAndParse(
      Buffer.from(`${HEADER}\n${ROW}\n`, 'latin1'),
    );
    expect(headers).toEqual([
      'N° pièce',
      'N° compte général',
      'Libellé écriture',
      'Débit',
      'Crédit',
    ]);
    expect(headers.join('')).not.toContain('�'); // pas de caractère de remplacement
    expect(rows[0]['Libellé écriture']).toBe('Achat numéroté');
    expect(rows[0]['Débit']).toBe('1500000');
  });

  it('lit correctement un fichier UTF-8 (sans régression)', async () => {
    const { headers, rows } = await writeAndParse(Buffer.from(`${HEADER}\n${ROW}\n`, 'utf8'));
    expect(headers).toEqual([
      'N° pièce',
      'N° compte général',
      'Libellé écriture',
      'Débit',
      'Crédit',
    ]);
    expect(rows[0]['N° compte général']).toBe('60110000');
  });

  it('gère un UTF-8 avec BOM', async () => {
    const { headers } = await writeAndParse(
      Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(`${HEADER}\n${ROW}\n`, 'utf8')]),
    );
    expect(headers[0]).toBe('N° pièce');
  });
});
