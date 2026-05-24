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

  private async detectDelimiter(path: string): Promise<',' | ';' | '\t'> {
    const firstLine = await this.readFirstLine(path);
    const counts: Record<',' | ';' | '\t', number> = {
      ';': (firstLine.match(/;/g) ?? []).length,
      ',': (firstLine.match(/,/g) ?? []).length,
      '\t': (firstLine.match(/\t/g) ?? []).length,
    };
    // Pick the most frequent. Tie-break: ';' (FR default) > ',' > tab.
    const ordered: Array<',' | ';' | '\t'> = [';', ',', '\t'];
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
      const stream = createReadStream(path).pipe(
        parseCsv({ headers: true, delimiter, ignoreEmpty: true, trim: true }),
      );
      stream.on('headers', (headers: string[]) => {
        stream.destroy();
        // Strip BOM that fast-csv may leave on the first header.
        resolve(headers.map((h) => h.replace(/^﻿/, '').trim()));
      });
      stream.on('error', (err: unknown) =>
        reject(new FileParseError('Cannot parse CSV headers', err)),
      );
      stream.on('end', () => resolve([]));
    });
  }

  private async *iterateRows(
    path: string,
    delimiter: string,
    headers: readonly string[],
  ): AsyncGenerator<ParsedRow> {
    const stream = createReadStream(path).pipe(
      parseCsv({ headers: true, delimiter, ignoreEmpty: true, trim: true }),
    );

    let rowNumber = 0;
    const queue: ParsedRow[] = [];
    let done = false;
    let error: unknown = null;
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
        values[header] = raw === undefined || raw === '' ? null : raw;
      }
      queue.push({ rowNumber, values });
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
        yield queue.shift()!;
        continue;
      }
      if (done) {
        if (error) {
          throw new FileParseError('CSV parse error', error);
        }
        return;
      }
      await new Promise<void>((resolve) => {
        resolveWait = resolve;
      });
    }
  }
}
