import { createReadStream } from 'node:fs';
import { open } from 'node:fs/promises';
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
    // Encodage : les exports Sage/Ciel/EBP français sont souvent en
    // latin1/CP1252 (Windows). Lus comme UTF-8, leurs accents deviennent
    // `�` (U+FFFD) → en-têtes "Débit", "N° pièce", "Libellé" illisibles →
    // l'auto-mapping échoue et l'import produit du garbage. On honore
    // l'encodage forcé (ex. SageFileParser) sinon on auto-détecte.
    const encoding = ctx.encoding ?? (await this.detectEncoding(absolutePath));
    const delimiter = ctx.delimiter ?? (await this.detectDelimiter(absolutePath));
    const headers = await this.readHeaders(absolutePath, delimiter, encoding);

    // We re-open the stream for the row iteration so the headers read
    // above doesn't consume the file. `fast-csv` doesn't expose a way
    // to rewind once we've consumed bytes off the same descriptor.
    const rows = this.iterateRows(absolutePath, delimiter, headers, encoding);

    return { headers, rows };
  }

  /**
   * Détecte l'encodage du fichier : UTF-8 (avec ou sans BOM) ou, à défaut,
   * latin1. Heuristique sur un échantillon : si la séquence d'octets n'est
   * pas un UTF-8 valide (tolérant une séquence multi-octets tronquée en fin
   * d'échantillon), on retombe sur latin1 — qui couvre les accents français
   * des exports Windows/Sage (é=0xE9, °=0xB0…).
   */
  private async detectEncoding(path: string): Promise<'utf8' | 'latin1'> {
    const fh = await open(path, 'r');
    try {
      const buf = Buffer.alloc(64 * 1024);
      const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
      const sample = buf.subarray(0, bytesRead);
      // BOM UTF-8 explicite.
      if (sample.length >= 3 && sample[0] === 0xef && sample[1] === 0xbb && sample[2] === 0xbf) {
        return 'utf8';
      }
      return looksLikeUtf8(sample) ? 'utf8' : 'latin1';
    } finally {
      await fh.close();
    }
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

  private readHeaders(
    path: string,
    delimiter: string,
    encoding: 'utf8' | 'latin1',
  ): Promise<string[]> {
    return new Promise((resolve, reject) => {
      // On garde une référence au flux fichier SOURCE : détruire le seul
      // flux de transformation `parseCsv` (la destination du pipe) ne ferme
      // PAS le descripteur de fichier sous-jacent. Sans `source.destroy()`,
      // chaque `parse()` fuyait un fd — épuisement lent côté serveur, et
      // verrou du fichier sous Windows (rmdir impossible).
      const source = createReadStream(path, { encoding });
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
    encoding: 'utf8' | 'latin1',
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

    const readable = createReadStream(path, { encoding });
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
/**
 * Vérifie si un échantillon d'octets est un UTF-8 plausible. Scanne les
 * séquences : tout octet de tête sans le bon nombre d'octets de
 * continuation (ou octet de continuation isolé) ⇒ pas de l'UTF-8 (donc
 * latin1/CP1252). Tolère une séquence multi-octets tronquée à la toute fin
 * de l'échantillon (coupure de buffer), pour ne pas faux-classer un vrai
 * fichier UTF-8.
 *
 * Exporté implicitement via le module ; testé indirectement par les specs
 * de parsing (fichiers latin1 vs utf8).
 */
function looksLikeUtf8(buf: Buffer): boolean {
  const n = buf.length;
  let i = 0;
  while (i < n) {
    const b = buf[i];
    if (b <= 0x7f) {
      i += 1;
      continue;
    }
    let extra: number;
    if (b >= 0xc2 && b <= 0xdf) extra = 1;
    else if (b >= 0xe0 && b <= 0xef) extra = 2;
    else if (b >= 0xf0 && b <= 0xf4) extra = 3;
    else return false; // octet de tête invalide (0x80-0xBF, 0xC0-0xC1, 0xF5-0xFF)
    // Séquence tronquée en fin d'échantillon : on accepte (coupure de buffer).
    if (i + extra >= n) return true;
    for (let j = 1; j <= extra; j += 1) {
      const c = buf[i + j];
      if (c < 0x80 || c > 0xbf) return false;
    }
    i += extra + 1;
  }
  return true;
}

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
