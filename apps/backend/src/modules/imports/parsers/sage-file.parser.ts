import { createReadStream } from 'node:fs';

import { Injectable } from '@nestjs/common';

import { CsvFileParser } from './csv-file.parser';
import { FileParseError, type IFileParser, type ParseContext, type ParseResult } from './types';

/**
 * Driver Sage (export TXT).
 *
 * MVP : on traite l'export Sage comme un CSV avec délimiteur tabulation
 * et encoding `latin1` (cas le plus fréquent des exports Sage 100
 * français). Si le fichier est en UTF-8 ou utilise `;`, le `CsvFileParser`
 * sous-jacent saura auto-détecter. Un driver Sage "vraiment" propriétaire
 * (avec gestion des sections, en-têtes multi-lignes, codes Sage natifs)
 * arrivera en Module 3 vague 2 si le besoin client le justifie.
 *
 * On garde un id distinct (`sage`) pour les logs et les dashboards
 * — savoir qu'un import a été tagué "sage" à la création reste plus
 * informatif que "csv générique".
 */

/**
 * Minimum number of tab-separated fields on the first data line for
 * the file to plausibly be a Sage export. Sage 100 exports typically
 * have 7+ columns (code journal, date, n° pièce, compte, libellé,
 * débit, crédit). 3 is a generous floor that still rejects READMEs.
 */
const SAGE_MIN_TAB_FIELDS = 3;

@Injectable()
export class SageFileParser implements IFileParser {
  readonly id = 'sage';

  constructor(private readonly csvParser: CsvFileParser) {}

  canHandle(input: { mimeType: string; originalName: string }): boolean {
    const lower = input.originalName.toLowerCase();
    if (!lower.endsWith('.txt')) return false;

    // Only accept text/plain — reject text/html, text/javascript, etc.
    // that a browser might assign to a renamed .txt file.
    return input.mimeType === 'text/plain' || input.mimeType === 'application/octet-stream';
  }

  async parse(absolutePath: string, ctx: ParseContext = {}): Promise<ParseResult> {
    // Content-level probe (fix projet-ferme-ve3): verify the first
    // non-empty line is tab-separated with enough columns to be
    // a plausible Sage accounting export. Catches README.txt, log
    // files, and other accidental .txt uploads before they produce
    // garbage staging rows.
    await this.assertLooksLikeSageExport(absolutePath);

    // Default to tab delimiter and latin1 encoding for Sage exports;
    // the underlying CSV parser will still auto-detect if those defaults
    // don't fit (e.g. a TXT actually saved as semicolon CSV).
    return this.csvParser.parse(absolutePath, {
      encoding: ctx.encoding ?? 'latin1',
      delimiter: ctx.delimiter ?? '\t',
    });
  }

  /**
   * Read the first non-empty line and verify it has at least
   * `SAGE_MIN_TAB_FIELDS` tab-separated columns. Throws
   * `FileParseError` if the file doesn't look like a Sage export.
   */
  private async assertLooksLikeSageExport(absolutePath: string): Promise<void> {
    const firstLine = await new Promise<string>((resolve, reject) => {
      const stream = createReadStream(absolutePath, { encoding: 'latin1', highWaterMark: 4096 });
      let buffer = '';
      stream.on('data', (chunk: string | Buffer) => {
        buffer += typeof chunk === 'string' ? chunk : chunk.toString('latin1');
        const newlineIdx = buffer.indexOf('\n');
        if (newlineIdx !== -1) {
          stream.destroy();
          resolve(buffer.slice(0, newlineIdx).replace(/\r$/, ''));
        }
      });
      stream.on('end', () => resolve(buffer.replace(/\r$/, '')));
      stream.on('error', (err) => reject(new FileParseError('Cannot read TXT file', err)));
    });

    const trimmed = firstLine.replace(/^\uFEFF/, '').trim();
    if (trimmed.length === 0) {
      throw new FileParseError(
        'Le fichier TXT est vide ou ne contient pas de données tabulaires Sage.',
      );
    }

    const tabCount = (trimmed.match(/\t/g) ?? []).length;
    if (tabCount + 1 < SAGE_MIN_TAB_FIELDS) {
      throw new FileParseError(
        `Le fichier TXT ne ressemble pas à un export Sage — la première ligne ne contient que ${tabCount + 1} champ(s) séparés par tabulation (minimum attendu : ${SAGE_MIN_TAB_FIELDS}).`,
      );
    }
  }
}

