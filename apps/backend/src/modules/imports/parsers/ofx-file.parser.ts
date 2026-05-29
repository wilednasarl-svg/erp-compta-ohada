import { readFile } from 'node:fs/promises';
import { Injectable } from '@nestjs/common';

import {
  FileParseError,
  type IFileParser,
  type ParseContext,
  type ParsedRow,
  type ParseResult,
} from './types';

/**
 * Driver OFX (Open Financial Exchange) — relevés bancaires.
 *
 * Gère deux variantes sans dépendance externe :
 *   - OFX SGML (< v2 — fichiers .ofx classiques, balises feuilles sans
 *     tag fermant : `<TRNAMT>-5000.00`).
 *   - OFX XML (v2+ / .qbo — XML bien formé avec `<TRNAMT>-5000.00</TRNAMT>`).
 *
 * Produit des lignes avec les headers `date`, `label`, `debit`, `credit`,
 * `reference` — tous reconnus par `HEADER_SYNONYMS` et auto-mappés sur le
 * schéma canonique pour le document type `bank_statement`.
 *
 * Contrainte mémoire : les fichiers OFX sont typiquement < 5 Mo (relevé
 * mensuel). `readFile` complet en mémoire est acceptable ici — à revoir
 * si des exports > 50 Mo doivent être supportés.
 */
@Injectable()
export class OfxFileParser implements IFileParser {
  readonly id = 'ofx';

  canHandle(input: { mimeType: string; originalName: string }): boolean {
    const lower = input.originalName.toLowerCase();
    return lower.endsWith('.ofx') || lower.endsWith('.qbo');
  }

  async parse(absolutePath: string, _ctx: ParseContext = {}): Promise<ParseResult> {
    let raw: string;
    try {
      raw = await readFile(absolutePath, { encoding: 'utf8' });
    } catch (err) {
      throw new FileParseError('Impossible de lire le fichier OFX', err);
    }

    const transactions = this.extractTransactions(raw);
    const headers = ['date', 'label', 'debit', 'credit', 'reference'];
    return { headers, rows: this.toRows(transactions) };
  }

  private extractTransactions(content: string): OfxTrn[] {
    const blocks: string[] = [];
    // Works for both SGML and XML — container tags <STMTTRN>…</STMTTRN>
    // are always present with closing tag in both variants.
    const blockRe = /<STMTTRN(?:\s[^>]*)?>([\s\S]*?)<\/STMTTRN>/gi;
    let m: RegExpExecArray | null;
    while ((m = blockRe.exec(content)) !== null) {
      blocks.push(m[1]);
    }

    if (blocks.length === 0) {
      throw new FileParseError('OFX : aucune transaction <STMTTRN> trouvée dans le fichier');
    }

    return blocks.map((b) => this.parseBlock(b)).filter((t): t is OfxTrn => t !== null);
  }

  private parseBlock(block: string): OfxTrn | null {
    const get = (tag: string): string | null => {
      // XML-style: <TAG>value</TAG>
      let m = new RegExp(`<${tag}>([^<]+)</${tag}>`, 'i').exec(block);
      if (m) return m[1].trim();
      // SGML-style: <TAG>value  (value ends at newline or next tag)
      m = new RegExp(`<${tag}>([^<\r\n]+)`, 'i').exec(block);
      return m ? m[1].trim() : null;
    };

    const dtRaw = get('DTPOSTED') ?? get('DTUSER');
    const amtRaw = get('TRNAMT');
    if (!dtRaw || !amtRaw) return null;

    const date = this.normalizeDate(dtRaw);
    const amount = parseFloat(amtRaw.replace(',', '.'));
    if (isNaN(amount)) return null;

    const isCredit = amount >= 0;
    const absAmt = Math.abs(amount).toFixed(2);

    return {
      date,
      label: get('MEMO') ?? get('NAME') ?? '',
      debit: isCredit ? null : absAmt,
      credit: isCredit ? absAmt : null,
      reference: get('FITID') ?? '',
    };
  }

  /**
   * Normalise les dates OFX vers ISO YYYY-MM-DD.
   * Formats reçus : `YYYYMMDD`, `YYYYMMDDHHMMSS`, `YYYYMMDDHHMMSS.SSS[-5:EST]`.
   */
  private normalizeDate(dt: string): string {
    const digits = dt.replace(/\D/g, '').slice(0, 8);
    if (digits.length < 8) return dt;
    return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  }

  // Async generator by contract (consumed via `for await`); the body yields
  // synchronously parsed rows and has nothing to await.
  // eslint-disable-next-line @typescript-eslint/require-await
  private async *toRows(trns: OfxTrn[]): AsyncGenerator<ParsedRow> {
    for (let i = 0; i < trns.length; i++) {
      const t = trns[i];
      yield {
        rowNumber: i + 1,
        values: {
          date: t.date,
          label: t.label,
          debit: t.debit,
          credit: t.credit,
          reference: t.reference,
        },
      };
    }
  }
}

interface OfxTrn {
  date: string;
  label: string;
  debit: string | null;
  credit: string | null;
  reference: string;
}
