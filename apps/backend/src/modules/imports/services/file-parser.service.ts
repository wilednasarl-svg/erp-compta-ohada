import { Inject, Injectable } from '@nestjs/common';
import { open as fsOpen } from 'node:fs/promises';

import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import { CsvFileParser } from '../parsers/csv-file.parser';
import { PdfFileParser } from '../parsers/pdf-file.parser';
import { SageFileParser } from '../parsers/sage-file.parser';
import { XlsxFileParser } from '../parsers/xlsx-file.parser';
import {
  FileParseError,
  type IFileParser,
  type ParseContext,
  type ParseResult,
} from '../parsers/types';

/**
 * Token DI pour la liste ordonnée des drivers. Permet aux tests
 * d'injecter une liste alternative (driver fake, ordre custom).
 */
export const FILE_PARSERS = Symbol('imports.file_parsers');

/**
 * `FileParserService` — résout le bon `IFileParser` pour un fichier
 * donné et délègue la lecture. Centralise la traduction des erreurs
 * fatales du parser en `AppException` métier.
 *
 * L'ordre des drivers compte : un fichier `.txt` matche d'abord
 * `SageFileParser` avant le fallback `CsvFileParser`. L'ordre est
 * défini par le module (`imports.module.ts`) qui peuple le token
 * `FILE_PARSERS`.
 */
@Injectable()
export class FileParserService {
  constructor(@Inject(FILE_PARSERS) private readonly parsers: readonly IFileParser[]) {}

  resolve(input: { mimeType: string; originalName: string }): IFileParser {
    for (const parser of this.parsers) {
      if (parser.canHandle(input)) {
        return parser;
      }
    }
    throw new AppException(ERROR_CODES.IMPORT_UNSUPPORTED_FORMAT, {
      message: `Aucun parser disponible pour le fichier "${input.originalName}" (${input.mimeType})`,
      details: { originalName: input.originalName, mimeType: input.mimeType },
    });
  }

  async parse(
    absolutePath: string,
    fileMeta: { mimeType: string; originalName: string },
    ctx: ParseContext = {},
  ): Promise<{ parser: IFileParser; result: ParseResult }> {
    const parser = this.resolve(fileMeta);
    // Magic-byte cross-check (audit Module 3 Sec-H2): the client-declared
    // `mimeType` selects the parser, but we re-verify the first bytes
    // against what the parser expects so a renamed/spoofed file is
    // rejected before any parser logic runs. Defense against EXE-as-CSV,
    // zip-bombs disguised as CSV, etc.
    await this.assertMagicBytesMatch(absolutePath, parser, fileMeta);
    try {
      const result = await parser.parse(absolutePath, ctx);
      return { parser, result };
    } catch (err) {
      if (err instanceof FileParseError) {
        throw new AppException(ERROR_CODES.IMPORT_FILE_PARSE_FAILED, {
          message: err.message,
          cause: err.cause,
          details: { parser: parser.id, originalName: fileMeta.originalName },
        });
      }
      throw err;
    }
  }

  /**
   * Read the first 8 bytes and assert they match the parser's expected
   * format. The four signatures we care about:
   *
   *   - XLSX is a ZIP container → starts with `PK\x03\x04` (`50 4B 03 04`).
   *   - CSV / TXT / Sage are plain text → must not start with a known
   *     binary magic (we explicitly reject PK, MZ for Win EXE, 7F45 for
   *     ELF, the PDF `%PDF`, and PNG `89 50 4E 47`).
   *
   * Anything matching a known binary signature gets `IMPORT_UNSUPPORTED_FORMAT`
   * before the parser touches the bytes. This blocks the documented
   * vector "rename `payload.exe` to `payload.csv` + spoofed
   * `Content-Type`".
   */
  private async assertMagicBytesMatch(
    absolutePath: string,
    parser: IFileParser,
    fileMeta: { mimeType: string; originalName: string },
  ): Promise<void> {
    const fh = await fsOpen(absolutePath, 'r');
    let header: Buffer;
    try {
      const buf = Buffer.alloc(8);
      const { bytesRead } = await fh.read(buf, 0, 8, 0);
      header = buf.subarray(0, bytesRead);
    } finally {
      await fh.close();
    }

    const startsWith = (sig: number[]): boolean => sig.every((b, i) => header[i] === b);

    const isZip = startsWith([0x50, 0x4b, 0x03, 0x04]); // PK\x03\x04
    const isWinExe = startsWith([0x4d, 0x5a]); // MZ
    const isElf = startsWith([0x7f, 0x45, 0x4c, 0x46]); // \x7FELF
    const isPdf = startsWith([0x25, 0x50, 0x44, 0x46]); // %PDF
    const isPng = startsWith([0x89, 0x50, 0x4e, 0x47]); // \x89PNG

    if (parser.id === 'xlsx') {
      // XLSX must be a ZIP container. Anything else uploaded under the
      // XLSX MIME is a spoof — refuse before SheetJS unzips it (zip-bomb
      // protection runs at parser level too via `sheetRows`, but the
      // cleanest reject is here).
      if (!isZip) {
        throw new AppException(ERROR_CODES.IMPORT_UNSUPPORTED_FORMAT, {
          message: "Le fichier déclaré XLSX n'a pas la signature ZIP attendue.",
          details: { originalName: fileMeta.originalName, mimeType: fileMeta.mimeType },
        });
      }
      return;
    }

    if (parser.id === 'pdf') {
      // PDF doit commencer par `%PDF`. Refuser tout autre format
      // (zip-bomb déguisé, exe renommé .pdf, etc.) avant de laisser
      // pdfjs charger le doc en mémoire.
      if (!isPdf) {
        throw new AppException(ERROR_CODES.IMPORT_UNSUPPORTED_FORMAT, {
          message: "Le fichier déclaré PDF n'a pas la signature %PDF attendue.",
          details: { originalName: fileMeta.originalName, mimeType: fileMeta.mimeType },
        });
      }
      return;
    }

    // Text-based parsers (csv, sage). Any binary signature is an
    // immediate reject — we never legitimately parse a ZIP/EXE/ELF/PDF/PNG
    // as text-based accounting input.
    if (isZip || isWinExe || isElf || isPdf || isPng) {
      throw new AppException(ERROR_CODES.IMPORT_UNSUPPORTED_FORMAT, {
        message: `Le fichier "${fileMeta.originalName}" a une signature binaire incompatible avec le format texte attendu.`,
        details: { originalName: fileMeta.originalName, mimeType: fileMeta.mimeType },
      });
    }
  }
}

/**
 * Liste par défaut des drivers, ordonnée par spécificité décroissante.
 * Exposée séparément pour que `imports.module.ts` la déclare comme
 * provider du token `FILE_PARSERS`.
 */
export function buildDefaultParsers(deps: {
  csv: CsvFileParser;
  xlsx: XlsxFileParser;
  sage: SageFileParser;
  pdf: PdfFileParser;
}): readonly IFileParser[] {
  // Order: PDF and XLSX first (extensions sans ambiguïté), puis Sage
  // (claims .txt avant le fallback générique CSV), puis CSV (catch-all
  // pour tout texte tabulaire restant).
  return [deps.pdf, deps.xlsx, deps.sage, deps.csv];
}
