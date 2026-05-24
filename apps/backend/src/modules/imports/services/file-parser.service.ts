import { Inject, Injectable } from '@nestjs/common';

import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import { CsvFileParser } from '../parsers/csv-file.parser';
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
}): readonly IFileParser[] {
  // Order: XLSX first (specific extension), then Sage (claims .txt
  // before CSV's generic delimiter fallback), then CSV (catch-all for
  // tabular text).
  return [deps.xlsx, deps.sage, deps.csv];
}
