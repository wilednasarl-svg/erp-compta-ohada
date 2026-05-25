import { readFile } from 'node:fs/promises';

import { Injectable, Logger } from '@nestjs/common';

import {
  FileParseError,
  type IFileParser,
  type ParseContext,
  type ParsedRow,
  type ParseResult,
} from './types';

/**
 * Driver PDF — Module 3 wave 2.
 *
 * Extraction de tableaux comptables depuis un PDF natif (export Sage /
 * SAP / Odoo en PDF, relevé bancaire textuel). Utilise `pdf-parse` v2
 * qui expose `getTable()` (analyse géométrique des cellules via pdfjs).
 *
 * Stratégie :
 *   1. Tenter `getTable()` — récupère tous les tableaux détectés par
 *      analyse des positions XY. Si au moins un tableau a ≥4 colonnes
 *      et ≥2 lignes (header + data), on l'utilise.
 *   2. Fallback `getText()` + heuristique de découpage : lignes
 *      séparées par ≥2 espaces consécutifs. Le premier "row" qui a
 *      au moins 4 colonnes devient l'en-tête.
 *   3. Si aucune des deux ne produit de structure exploitable, on
 *      lève `FileParseError` — l'utilisateur sait qu'il faut convertir
 *      son PDF en CSV/XLSX manuellement.
 *
 * Limitations connues (acceptées en wave 2) :
 *   - PDF scanné (image) → aucune extraction possible sans OCR. Le
 *     module 10 wave 2 livrera l'OCR (Tesseract.js / cloud OCR) ; en
 *     attendant on signale clairement l'erreur.
 *   - Cellules fusionnées (rowspan/colspan) → pdf-parse les
 *     dédoublonne ; le résultat peut avoir des colonnes vides répétées.
 *   - PDF multi-tableaux par page (ex. bilan avec actif + passif côte
 *     à côte) → on ne prend QUE le premier tableau qui satisfait le
 *     seuil "≥4 colonnes". Suffisant pour 95% des exports comptables
 *     mono-tableau ; une future itération pourra exposer un sélecteur.
 *   - Le contenu n'est pas streamé : pdf-parse charge le doc complet
 *     en mémoire. La limite de taille de l'upload (IMPORT_MAX_FILE_SIZE_MB
 *     par défaut 50 MB) borne le risque.
 */
@Injectable()
export class PdfFileParser implements IFileParser {
  readonly id = 'pdf';
  private readonly logger = new Logger(PdfFileParser.name);

  /**
   * Nombre minimal de colonnes attendu pour qu'un tableau soit
   * considéré comme un export comptable plausible. Date + Compte +
   * Débit + Crédit = 4. Sous ce seuil, c'est probablement un encadré
   * de mise en page (totaux récapitulatifs, en-tête société, etc.).
   */
  private static readonly MIN_COLUMNS = 4;

  canHandle(input: { mimeType: string; originalName: string }): boolean {
    const lower = input.originalName.toLowerCase();
    if (lower.endsWith('.pdf')) {
      return true;
    }
    return input.mimeType === 'application/pdf';
  }

  async parse(absolutePath: string, _ctx: ParseContext = {}): Promise<ParseResult> {
    // L'import dynamique évite que tsc / nest-cli charge pdfjs-dist
    // à l'init du module (le wrapper a une init lente côté worker
    // threads PDFJS qui pénalise inutilement les autres drivers).
    const { PDFParse } = await this.loadPdfParse();

    const buffer = await readFile(absolutePath);
    // Recopie en Uint8Array — pdf-parse v2 traite ownership de la
    // donnée, et on ne veut pas qu'il mute notre Buffer Node.
    const data = new Uint8Array(buffer);

    let parser: InstanceType<typeof PDFParse>;
    try {
      parser = new PDFParse({ data });
    } catch (err) {
      throw new FileParseError('Cannot initialise PDF parser', err);
    }

    // 1. Tentative tableau structuré.
    const structured = await this.tryStructuredTable(parser);
    if (structured !== null) {
      return structured;
    }

    // 2. Fallback texte brut + heuristique 2+ espaces.
    const fallback = await this.tryTextHeuristic(parser);
    if (fallback !== null) {
      return fallback;
    }

    throw new FileParseError(
      'Aucun tableau exploitable détecté dans le PDF. Si le fichier est un scan (image), il faudra attendre la wave 2 du Module 10 (OCR). Sinon, exportez-le en CSV/XLSX depuis le logiciel source.',
    );
  }

  /**
   * Import dynamique du wrapper pdf-parse. Isolé pour pouvoir être
   * stubé dans les tests sans toucher au fs du sandbox jest.
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  private async loadPdfParse(): Promise<typeof import('pdf-parse')> {
    return import('pdf-parse');
  }

  private async tryStructuredTable(
    parser: { getTable(): Promise<{ mergedTables: string[][][]; pages: Array<{ tables: string[][][] }> }> },
  ): Promise<ParseResult | null> {
    let result;
    try {
      result = await parser.getTable();
    } catch (err) {
      this.logger.warn(`getTable() failed, falling back to text heuristic: ${String(err)}`);
      return null;
    }

    // mergedTables = tableaux fusionnés cross-pages (pdf-parse continue
    // un tableau qui s'étend sur plusieurs pages). Préférable au
    // pages[*].tables pour les exports de grand livre qui font N pages.
    const candidates: string[][][] = [];
    if (Array.isArray(result.mergedTables)) {
      candidates.push(...result.mergedTables);
    }
    if (Array.isArray(result.pages)) {
      for (const page of result.pages) {
        if (Array.isArray(page.tables)) {
          candidates.push(...page.tables);
        }
      }
    }

    const picked = this.pickBestTable(candidates);
    if (picked === null) {
      return null;
    }

    return this.buildResultFromMatrix(picked);
  }

  private async tryTextHeuristic(parser: {
    getText(): Promise<{ text: string }>;
  }): Promise<ParseResult | null> {
    let text: string;
    try {
      const out = await parser.getText();
      text = out.text;
    } catch (err) {
      throw new FileParseError('Cannot extract text from PDF', err);
    }

    if (text.trim().length === 0) {
      // Un PDF dont getText() rend vide est presque toujours un PDF
      // scanné. On laisse `parse()` lever l'erreur "no exploitable
      // table" qui pointe vers l'OCR.
      return null;
    }

    const lines = text
      .split(/\r?\n/)
      .map((line) => line.replace(/\t/g, '    ').trimEnd())
      .filter((line) => line.trim().length > 0);

    // Découpage de chaque ligne sur 2+ espaces consécutifs. C'est
    // l'heuristique standard pour les PDF "textuels" exportés depuis
    // un logiciel comptable qui aligne ses colonnes par padding spaces.
    const rows = lines.map((line) => line.split(/ {2,}/).map((c) => c.trim()).filter((c) => c.length > 0));
    const matrix = rows.filter((cells) => cells.length >= PdfFileParser.MIN_COLUMNS);

    if (matrix.length < 2) {
      return null;
    }

    return this.buildResultFromMatrix(matrix);
  }

  /**
   * Choisit le meilleur tableau candidat : on prend celui qui a le
   * plus de lignes parmi ceux ayant `>= MIN_COLUMNS` colonnes.
   * Tie-break sur le nombre de colonnes (un tableau "complet" avec
   * tiers + devise gagnera sur un strict débit/crédit).
   */
  private pickBestTable(candidates: readonly string[][][]): string[][] | null {
    let best: string[][] | null = null;
    let bestScore = 0;
    for (const t of candidates) {
      if (t.length < 2) continue;
      const colCount = Math.max(...t.map((r) => r.length));
      if (colCount < PdfFileParser.MIN_COLUMNS) continue;
      const score = t.length * 100 + colCount;
      if (score > bestScore) {
        best = t;
        bestScore = score;
      }
    }
    return best;
  }

  private buildResultFromMatrix(matrix: readonly string[][]): ParseResult {
    const headerRow = matrix[0] ?? [];
    const headers = headerRow.map((cell, idx) => {
      const trimmed = (cell ?? '').trim();
      return trimmed === '' ? `col_${idx + 1}` : trimmed;
    });

    const dataRows = matrix.slice(1);

    const rows = (async function* (): AsyncGenerator<ParsedRow> {
      let rowNumber = 0;
      for (const raw of dataRows) {
        rowNumber += 1;
        const values: Record<string, string | null> = {};
        let isEmpty = true;
        for (let i = 0; i < headers.length; i += 1) {
          const header = headers[i];
          const cell = raw[i];
          if (cell === undefined || cell === null || String(cell).trim() === '') {
            values[header] = null;
          } else {
            values[header] = String(cell).trim();
            isEmpty = false;
          }
        }
        if (isEmpty) continue;
        yield { rowNumber, values };
      }
    })();

    return { headers, rows };
  }
}
