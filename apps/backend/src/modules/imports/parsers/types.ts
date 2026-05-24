/**
 * Driver abstraction for the file parsing layer.
 *
 * Chaque format supporté (CSV, XLSX, Sage TXT) implémente `IFileParser`
 * et expose un `parse` qui itère le fichier en *streaming*. Le contrat
 * volontairement minimal :
 *
 *   - le parser ne connaît PAS le mapping ni la validation ; il rend
 *     uniquement les valeurs brutes (header → string ou null).
 *   - le parser ne charge JAMAIS le fichier complet en mémoire — il
 *     yield ligne par ligne via AsyncIterable. Un fichier de 200 000
 *     lignes doit tenir dans ~RAM constante.
 *   - le parser détecte ses propres erreurs fatales (corruption,
 *     header manquant) et lève `FileParseError`. Les erreurs par-ligne
 *     (champ illisible) sont remontées dans `ParsedRow.parseErrors`.
 *
 * Le `FileParserService` choisit le driver via `canHandle(mimeType,
 * originalName)`. Si plusieurs répondent (ex. .csv et .txt), le
 * premier de la liste enregistrée gagne — l'ordre est défini par
 * `imports.module.ts`.
 */

/**
 * Une ligne du fichier source telle que produite par un parser, avant
 * tout mapping. Les clés correspondent aux headers détectés.
 *
 *   - `rowNumber` : 1-indexé pour matcher la convention humaine
 *     ("ligne 42 du fichier"). Le header lui-même est ligne 0.
 *   - `values` : map header → valeur brute. `null` pour les cellules
 *     vides. Aucune normalisation (espaces, casse) n'est appliquée
 *     ici ; le `MappingService` s'en charge sur les headers et le
 *     `ValidationService` sur les valeurs.
 *   - `parseErrors` : liste optionnelle d'erreurs *non-fatales* du
 *     parser (ex. cellule Excel avec type inattendu mais lisible
 *     comme string). Vide dans la plupart des cas.
 */
export interface ParsedRow {
  rowNumber: number;
  values: Record<string, string | null>;
  parseErrors?: ReadonlyArray<{ field: string; message: string }>;
}

export interface ParseResult {
  /** Headers détectés dans l'ordre d'apparition. */
  headers: readonly string[];
  /** Itération streaming des lignes. Consommer une seule fois. */
  rows: AsyncIterable<ParsedRow>;
}

export interface ParseContext {
  /**
   * Encoding hint. La plupart des exports Sage sortent en `latin1`,
   * Excel en `utf8`. Le driver peut auto-détecter (BOM) avant de
   * tomber sur ce default.
   */
  encoding?: 'utf8' | 'latin1';
  /**
   * Délimiteur CSV. `null` ou absent → auto-détection sur la première
   * ligne (`;` vs `,` vs `\t`).
   */
  delimiter?: ',' | ';' | '\t' | null;
}

export interface IFileParser {
  /**
   * Identifiant court pour les logs ("csv", "xlsx", "sage").
   */
  readonly id: string;
  /**
   * `true` si ce driver peut parser ce fichier. La signature accepte
   * MIME *et* extension parce que certains MIME sont génériques
   * (`text/plain` pour un .csv mal annoncé par le navigateur).
   */
  canHandle(input: { mimeType: string; originalName: string }): boolean;
  /**
   * Parse le fichier en streaming. Throw `FileParseError` sur erreur
   * fatale.
   */
  parse(absolutePath: string, ctx?: ParseContext): Promise<ParseResult>;
}

/**
 * Erreur fatale du parser — le fichier ne peut pas être lu du tout.
 * Le service positionnera le statut du file à `parse_failed` et
 * stockera `message` dans `parseError`.
 */
export class FileParseError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'FileParseError';
  }
}
