import { createReadStream } from 'node:fs';
import { Injectable } from '@nestjs/common';
import { parse as parseCsv } from 'fast-csv';

import {
  FileParseError,
  type IFileParser,
  type ParseContext,
  type ParsedRow,
  type ParseResult,
} from './types';

/**
 * Driver CSV.
 *
 * Utilise `fast-csv` en mode header-aware streaming. Auto-détecte le
 * séparateur sur la première ligne (`;` est le défaut FR/Europe, `,`
 * US/UK, `\t` pour les exports tabulaires). Le BOM UTF-8 est
 * automatiquement strippé via `BOM = true`.
 *
 * Le parser ne renvoie PAS la première ligne (headers) comme une row
 * — `fast-csv` la consomme et la met à disposition via l'événement
 * `headers`. Les ParsedRow.rowNumber commencent donc à 1 pour
 * correspondre à "ligne 1 de données" côté humain.
 */
@Injectable()
export class CsvFileParser implements IFileParser {
  readonly id = 'csv';

  canHandle(input: { mimeType: string; originalName: string }): boolean {
    const lower = input.originalName.toLowerCase();
    if (lower.endsWith('.csv') || lower.endsWith('.tsv')) {
      return true;
    }
    return (
      input.mimeType === 'text/csv' ||
      input.mimeType === 'application/csv' ||
      input.mimeType === 'text/tab-separated-values'
    );
  }

  async parse(absolutePath: string, ctx: ParseContext = {}): Promise<ParseResult> {
    const delimiter = ctx.delimiter ?? (await this.detectDelimiter(absolutePath));
    const headers = await this.readHeaders(absolutePath, delimiter);

    // We re-open the stream for the row iteration so the headers read
    // above doesn't consume the file. `fast-csv` doesn't expose a way
    // to rewind once we've consumed bytes off the same descriptor.
    const rows = this.iterateRows(absolutePath, delimiter, headers);

    return { headers, rows };
  }

  private async detectDelimiter(path: string): Promise<',' | ';' | '\t' | '|'> {
    const firstLine = await this.readFirstLine(path);
    const counts: Record<',' | ';' | '\t' | '|', number> = {
      ';': (firstLine.match(/;/g) ?? []).length,
      ',': (firstLine.match(/,/g) ?? []).length,
      '\t': (firstLine.match(/\t/g) ?? []).length,
      // `|` est le séparateur normalisé du FEC (Fichier des Écritures
      // Comptables). L'ajouter à l'auto-détection rend l'app directement
      // compatible avec les exports FEC de Sage / Ciel / EBP / Odoo.
      '|': (firstLine.match(/\|/g) ?? []).length,
    };
    // Pick the most frequent. Tie-break: ';' (FR default) > ',' > tab > pipe.
    const ordered: Array<',' | ';' | '\t' | '|'> = [';', ',', '\t', '|'];
    return ordered.reduce((best, candidate) =>
      counts[candidate] > counts[best] ? candidate : best,
    );
  }

  private readFirstLine(path: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const stream = createReadStream(path, { encoding: 'utf8', highWaterMark: 4096 });
      let buffer = '';
      stream.on('data', (chunk: string | Buffer) => {
        buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
        const newlineIdx = buffer.indexOf('\n');
        if (newlineIdx !== -1) {
          stream.destroy();
          // Strip CR and BOM if present.
          resolve(buffer.slice(0, newlineIdx).replace(/^﻿/, '').replace(/\r$/, ''));
        }
      });
      stream.on('end', () => resolve(buffer.replace(/^﻿/, '')));
      stream.on('error', (err) => reject(new FileParseError('Cannot read CSV file', err)));
    });
  }

  private readHeaders(path: string, delimiter: string): Promise<string[]> {
    return new Promise((resolve, reject) => {
      // On garde une référence au flux fichier SOURCE : détruire le seul
      // flux de transformation `parseCsv` (la destination du pipe) ne ferme
      // PAS le descripteur de fichier sous-jacent. Sans `source.destroy()`,
      // chaque `parse()` fuyait un fd — épuisement lent côté serveur, et
      // verrou du fichier sous Windows (rmdir impossible).
      const source = createReadStream(path);
      const stream = source.pipe(
        parseCsv({ headers: true, delimiter, ignoreEmpty: true, trim: true }),
      );
      const cleanup = () => {
        source.destroy();
        stream.destroy();
      };
      stream.on('headers', (headers: string[]) => {
        cleanup();
        // Strip BOM that fast-csv may leave on the first header.
        resolve(headers.map((h) => h.replace(/^﻿/, '').trim()));
      });
      stream.on('error', (err: unknown) => {
        cleanup();
        reject(new FileParseError('Cannot parse CSV headers', err));
      });
      stream.on('end', () => {
        cleanup();
        resolve([]);
      });
    });
  }

  private async *iterateRows(
    path: string,
    delimiter: string,
    headers: readonly string[],
  ): AsyncGenerator<ParsedRow> {
    // Backpressure (fix projet-ferme-140): bound the in-memory queue
    // so a fast parser + slow consumer (bulkInsert) doesn't OOM.
    // When the queue exceeds HIGH_WATER rows the underlying readable
    // is paused; it resumes once the consumer drains below the mark.
    const HIGH_WATER = 128;

    // Per-cell size cap (fix projet-ferme-2qn DoS): an accounting cell
    // never legitimately holds more than ~64 KB of text. Cap at 256 KB
    // and surface a clean parse error rather than letting a hostile
    // 10 MB cell drag the whole file into the in-memory queue.
    const CELL_MAX_BYTES = 256 * 1024;

    const readable = createReadStream(path);
    const stream = readable.pipe(
      parseCsv({ headers: true, delimiter, ignoreEmpty: true, trim: true }),
    );

    let rowNumber = 0;
    const queue: ParsedRow[] = [];
    let done = false;
    let error: unknown = null;
    let paused = false;
    let resolveWait: (() => void) | null = null;

    const wake = () => {
      if (resolveWait) {
        const r = resolveWait;
        resolveWait = null;
        r();
      }
    };

    stream.on('data', (data: Record<string, string>) => {
      rowNumber += 1;
      const values: Record<string, string | null> = {};
      for (const header of headers) {
        const raw = data[header];
        if (raw !== undefined && raw.length > CELL_MAX_BYTES) {
          error = new FileParseError(
            `CSV cell exceeds ${CELL_MAX_BYTES} bytes at row ${rowNumber}, column "${header}"`,
          );
          done = true;
          readable.destroy();
          wake();
          return;
        }
        values[header] = raw === undefined || raw === '' ? null : raw;
      }
      queue.push({ rowNumber, values });

      // Pause the source when the queue is full — the consumer's
      // `yield` will resume once it catches up.
      if (queue.length >= HIGH_WATER && !paused) {
        paused = true;
        readable.pause();
      }

      wake();
    });
    stream.on('end', () => {
      done = true;
      wake();
    });
    stream.on('error', (err: unknown) => {
      error = err;
      done = true;
      wake();
    });

    while (true) {
      if (queue.length > 0) {
        const row = queue.shift()!;

        // Resume the source once the queue drains below the watermark.
        if (paused && queue.length < HIGH_WATER) {
          paused = false;
          readable.resume();
        }

        yield row;
        continue;
      }
      if (done) {
        if (error) {
          throw new FileParseError(buildParseErrorMessage(error), error);
        }
        return;
      }
      await new Promise<void>((resolve) => {
        resolveWait = resolve;
      });
    }
  }
}

/**
 * Traduit une erreur fast-csv en message actionnable. Le cas le plus
 * fréquent et le plus déroutant est le "column header mismatch" : une
 * ligne a plus de colonnes que l'en-tête. En contexte comptable, c'est
 * presque toujours dû à des montants NON entre guillemets contenant des
 * virgules comme séparateur de milliers (ex. `100,000,000`) dans un
 * fichier délimité par la virgule — chaque virgule du montant est alors
 * prise pour un séparateur de colonne. On oriente vers la solution.
 */
function buildParseErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  if (/column|header mismatch|expected:?\s*\d+\s*columns/i.test(raw)) {
    return (
      'Le nombre de colonnes ne correspond pas à l’en-tête sur au moins une ligne. ' +
      'Cause fréquente : des montants contenant des virgules de milliers (ex. 100,000,000) ' +
      'non entre guillemets, dans un fichier séparé par des virgules. Réexportez avec un ' +
      'séparateur point-virgule (;) ou des montants entre guillemets ("100,000,000").'
    );
  }
  return 'Erreur de lecture CSV';
}
