import { readFile } from 'node:fs/promises';
import { Injectable } from '@nestjs/common';

import { FileParseError, type IFileParser, type ParseContext, type ParsedRow, type ParseResult } from './types';

/**
 * Driver MT940 (SWIFT Statement Message) — relevés bancaires format SWIFT.
 *
 * Supporté sans dépendance externe via parsing ligne à ligne des tags
 * SWIFT `:XX:`. Gère les fichiers exportés par les banques UEMOA/CEMAC
 * (Ecobank, SGCI, BOA, NSIA, etc.) qui suivent la norme SWIFT MT940
 * avec séparateur décimal virgule (convention européenne).
 *
 * Extensions reconnues : `.mt940`, `.sta`, `.mt9`, `.940`.
 * Pour un `.txt` contenant du MT940, renommer le fichier en `.mt940`.
 *
 * Champs extraits et mappés sur le schéma canonique `bank_statement` :
 *   `:61:` → date, debit/credit, reference
 *   `:86:` → label (libellé narratif suivant chaque `:61:`)
 */
@Injectable()
export class Mt940FileParser implements IFileParser {
  readonly id = 'mt940';

  canHandle(input: { mimeType: string; originalName: string }): boolean {
    const lower = input.originalName.toLowerCase();
    return (
      lower.endsWith('.mt940') ||
      lower.endsWith('.sta') ||
      lower.endsWith('.mt9') ||
      lower.endsWith('.940')
    );
  }

  async parse(absolutePath: string, _ctx: ParseContext = {}): Promise<ParseResult> {
    let raw: string;
    try {
      raw = await readFile(absolutePath, { encoding: 'utf8' });
    } catch {
      // Latin-1 fallback — certains exports SWIFT historiques (SGML era)
      try {
        raw = await readFile(absolutePath, { encoding: 'latin1' });
      } catch (err2) {
        throw new FileParseError('Impossible de lire le fichier MT940', err2);
      }
    }

    const transactions = this.extractTransactions(raw);
    const headers = ['date', 'label', 'debit', 'credit', 'reference'];
    return { headers, rows: this.toRows(transactions) };
  }

  private extractTransactions(content: string): Mt940Trn[] {
    const fields = this.splitFields(content);
    const transactions: Mt940Trn[] = [];
    let pending: Partial<Mt940Trn> | null = null;

    for (const { tag, value } of fields) {
      if (tag === '61') {
        if (pending?.date) transactions.push(this.finalize(pending));
        pending = this.parseLine61(value);
      } else if (tag === '86') {
        if (pending) {
          pending.label = value.replace(/\r?\n/g, ' ').trim().slice(0, 140);
        }
      } else if (tag === '62F' || tag === '62M') {
        // Closing balance — flush pending
        if (pending?.date) {
          transactions.push(this.finalize(pending));
          pending = null;
        }
      }
    }

    if (pending?.date) transactions.push(this.finalize(pending));

    if (transactions.length === 0) {
      throw new FileParseError('MT940 : aucune transaction (:61:) trouvée dans le fichier');
    }

    return transactions;
  }

  /**
   * Découpe le fichier en champs SWIFT : chaque champ commence par un tag
   * `:NN[A]:` en début de ligne. Les lignes de continuation appartiennent
   * au champ courant.
   */
  private splitFields(content: string): Array<{ tag: string; value: string }> {
    const results: Array<{ tag: string; value: string }> = [];
    let currentTag: string | null = null;
    let currentLines: string[] = [];

    for (const line of content.split(/\r?\n/)) {
      const m = /^:([0-9]{2}[A-Z]?):(.*)/.exec(line);
      if (m) {
        if (currentTag !== null) {
          results.push({ tag: currentTag, value: currentLines.join('\n').trim() });
        }
        currentTag = m[1];
        currentLines = [m[2]];
      } else if (currentTag !== null) {
        currentLines.push(line);
      }
    }

    if (currentTag !== null) {
      results.push({ tag: currentTag, value: currentLines.join('\n').trim() });
    }

    return results;
  }

  /**
   * Parse le champ `:61:`.
   *
   * Format SWIFT MT940 § 5.1 :
   *   `YYMMDD[MMDD][RC|RD|C|D]<AMOUNT>[N|S|F][TRF|CHK|…][REFERENCE][//BANKREF]`
   *
   * L'indicateur C/D peut apparaître sous 4 formes : `C`, `D`, `RC` (reverse
   * credit), `RD` (reverse debit). Certaines banques UEMOA écrivent `CR`/`DR`
   * — on les normalise.
   */
  private parseLine61(raw: string): Partial<Mt940Trn> | null {
    const line = raw.replace(/\r?\n/g, ' ').trim();
    let pos = 0;

    // Value date YYMMDD
    if (!/^\d{6}/.test(line)) return null;
    const vDate = line.slice(0, 6);
    pos = 6;

    // Optional entry date MMDD (4 digits followed by a sign letter)
    if (/^\d{4}[CDRcdR]/.test(line.slice(pos, pos + 5))) {
      pos += 4;
    }

    // Sign indicator: RC, RD, CR, DR, C, D (case-insensitive)
    const signMatch = /^(RC|RD|CR|DR|C|D)/i.exec(line.slice(pos));
    if (!signMatch) return null;
    const sign = signMatch[1].toUpperCase();
    pos += sign.length;

    // Amount: digits with comma decimal separator (e.g. 50000,00)
    const amtMatch = /^(\d[\d,]*)/.exec(line.slice(pos));
    if (!amtMatch) return null;
    const amtStr = amtMatch[1];
    pos += amtStr.length;

    const amount = parseFloat(amtStr.replace(',', '.'));
    if (isNaN(amount)) return null;

    // Remainder: [N|S|F][3-char code][reference][//bankref]
    const remainder = line.slice(pos);
    const slashIdx = remainder.indexOf('//');
    // Strip optional 1-char type id + optional 3-char code from front of reference
    const refPart = slashIdx >= 0 ? remainder.slice(0, slashIdx) : remainder;
    const reference = refPart.replace(/^[A-Z]{1,4}/i, '').trim().slice(0, 35);

    const isCredit = sign === 'C' || sign === 'CR' || sign === 'RC';

    return {
      date: this.parseMt940Date(vDate),
      debit: isCredit ? null : amount.toFixed(2),
      credit: isCredit ? amount.toFixed(2) : null,
      reference,
      label: '',
    };
  }

  /** Convertit `YYMMDD` SWIFT → ISO `YYYY-MM-DD`. */
  private parseMt940Date(yymmdd: string): string {
    const yy = parseInt(yymmdd.slice(0, 2), 10);
    const mm = yymmdd.slice(2, 4);
    const dd = yymmdd.slice(4, 6);
    const currentYY = new Date().getFullYear() % 100;
    const year = yy <= currentYY ? 2000 + yy : 1900 + yy;
    return `${year}-${mm}-${dd}`;
  }

  private finalize(partial: Partial<Mt940Trn>): Mt940Trn {
    return {
      date: partial.date ?? '',
      label: partial.label ?? '',
      debit: partial.debit ?? null,
      credit: partial.credit ?? null,
      reference: partial.reference ?? '',
    };
  }

  private async *toRows(trns: Mt940Trn[]): AsyncGenerator<ParsedRow> {
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

interface Mt940Trn {
  date: string;
  label: string;
  debit: string | null;
  credit: string | null;
  reference: string;
}
