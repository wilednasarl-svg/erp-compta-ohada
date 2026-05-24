import { Injectable } from '@nestjs/common';

import { CsvFileParser } from './csv-file.parser';
import type { IFileParser, ParseContext, ParseResult } from './types';

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
@Injectable()
export class SageFileParser implements IFileParser {
  readonly id = 'sage';

  constructor(private readonly csvParser: CsvFileParser) {}

  canHandle(input: { mimeType: string; originalName: string }): boolean {
    const lower = input.originalName.toLowerCase();
    return lower.endsWith('.txt');
  }

  async parse(absolutePath: string, ctx: ParseContext = {}): Promise<ParseResult> {
    // Default to tab delimiter and latin1 encoding for Sage exports;
    // the underlying CSV parser will still auto-detect if those defaults
    // don't fit (e.g. a TXT actually saved as semicolon CSV).
    return this.csvParser.parse(absolutePath, {
      encoding: ctx.encoding ?? 'latin1',
      delimiter: ctx.delimiter ?? '\t',
    });
  }
}
