import { Injectable } from '@nestjs/common';
import { readFile, utils, type WorkBook, type WorkSheet } from 'xlsx';

import {
  FileParseError,
  type IFileParser,
  type ParseContext,
  type ParsedRow,
  type ParseResult,
} from './types';

/**
 * Driver Excel (.xlsx / .xls).
 *
 * `xlsx` (SheetJS) charge le classeur entier en mémoire — il n'y a
 * pas de mode streaming officiel pour la lecture. C'est acceptable
 * pour le MVP : la limite haute restera côté upload via
 * `IMPORT_MAX_FILE_SIZE_MB`. Si un client tente un classeur de
 * 200 000 lignes, il sera bloqué par la limite de taille avant
 * d'arriver ici.
 *
 * Le driver prend la *première feuille* du classeur. Les imports
 * multi-feuilles ne sont pas supportés en MVP (un fichier = une
 * feuille comptable). Une future itération pourra exposer un
 * sélecteur de feuille via la session.
 *
 * Toutes les valeurs sont coercées en string (sans formatage) pour
 * rester cohérentes avec le contrat du driver CSV. Les conversions
 * numériques / date se feront en aval (`ValidationService`).
 */
@Injectable()
export class XlsxFileParser implements IFileParser {
  readonly id = 'xlsx';

  canHandle(input: { mimeType: string; originalName: string }): boolean {
    const lower = input.originalName.toLowerCase();
    if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
      return true;
    }
    return (
      input.mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      input.mimeType === 'application/vnd.ms-excel'
    );
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async parse(absolutePath: string, _ctx: ParseContext = {}): Promise<ParseResult> {
    let workbook: WorkBook;
    try {
      // `cellDates: false` keeps dates as Excel serial numbers, which
      // we then stringify; downstream date parsing is centralised in
      // ValidationService. `raw: true` skips formatting.
      //
      // Hardening (audit Module 3 Sec-H1):
      //   - `cellFormula: false` — SheetJS evaluates formulas
      //     server-side by default, which is the published vector for
      //     prototype-pollution / DDE-style payloads. We never read
      //     the evaluated formula result anyway.
      //   - `sheetRows: 100_000` — hard cap per sheet. Without it an
      //     XLSX zip-bomb (compressed file under our 50 MB limit but
      //     unpacking to GB of cells) exhausts the heap inside the
      //     parser before our `fs.stat` size guard fires.
      //   - `cellHTML: false` / `cellNF: false` — drop HTML and
      //     number-format strings; we never consume them and they
      //     widen the attack surface for crafted workbooks.
      workbook = readFile(absolutePath, {
        cellDates: false,
        raw: true,
        cellFormula: false,
        cellHTML: false,
        cellNF: false,
        sheetRows: 100_000,
      });
    } catch (err) {
      throw new FileParseError('Cannot read XLSX file', err);
    }

    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) {
      throw new FileParseError('XLSX file contains no sheet');
    }
    const sheet: WorkSheet | undefined = workbook.Sheets[firstSheetName];
    if (!sheet) {
      throw new FileParseError(`XLSX sheet "${firstSheetName}" is empty`);
    }

    // `header: 1` → array-of-arrays, first row = headers. `defval: null`
    // → empty cells materialise as null instead of being skipped, so
    // the column structure stays stable across rows.
    const matrix = utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      raw: true,
      defval: null,
      blankrows: false,
    });

    if (matrix.length === 0) {
      throw new FileParseError('XLSX sheet has no rows');
    }

    const headerRow = matrix[0] ?? [];
    const headers = headerRow.map((cell, idx) => {
      if (cell === null || cell === undefined || String(cell).trim() === '') {
        return `col_${idx + 1}`;
      }
      return String(cell).trim();
    });

    const dataRows = matrix.slice(1);

    // eslint-disable-next-line @typescript-eslint/require-await
    const rows = (async function* (): AsyncGenerator<ParsedRow> {
      let rowNumber = 0;
      for (const raw of dataRows) {
        rowNumber += 1;
        const values: Record<string, string | null> = {};
        let isEmpty = true;
        for (let i = 0; i < headers.length; i += 1) {
          const header = headers[i];
          const cell = raw[i];
          if (cell === null || cell === undefined || cell === '') {
            values[header] = null;
          } else {
            values[header] = String(cell);
            isEmpty = false;
          }
        }
        if (isEmpty) {
          continue;
        }
        yield { rowNumber, values };
      }
    })();

    return { headers, rows };
  }
}
