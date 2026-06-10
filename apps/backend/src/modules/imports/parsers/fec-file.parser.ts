import { createReadStream } from 'node:fs';

import { Injectable } from '@nestjs/common';

import { CsvFileParser } from './csv-file.parser';
import { FileParseError, type IFileParser, type ParseContext, type ParseResult } from './types';

/**
 * Driver FEC — Fichier des Écritures Comptables.
 *
 * Le FEC est un format d'échange normalisé (18 colonnes, séparateur `|`
 * ou tabulation) que la quasi-totalité des logiciels comptables savent
 * exporter : Sage, Ciel, EBP, Odoo, Quadratus… C'est donc LE format
 * pivot pour rendre l'app complémentaire d'un autre outil sans ressaisie
 * — l'utilisateur sort son FEC du logiciel tiers et l'app l'ingère tel
 * quel.
 *
 * Le parsing lui-même est délégué au `CsvFileParser` : un FEC est un
 * fichier délimité, et l'auto-détection du séparateur du CSV couvre
 * désormais le `|` (cf. `detectDelimiter`). Ce driver existe pour DEUX
 * raisons :
 *
 *   1. intercepter les FEC livrés en `.txt` AVANT le `SageFileParser`,
 *      qui forcerait une tabulation et casserait un FEC séparé par `|` ;
 *   2. tagger l'import comme `fec` dans les logs et garantir, via un
 *      probe de contenu, qu'on ne traite un fichier "FEC" que s'il en a
 *      réellement la structure (en-têtes canoniques).
 *
 * Le mapping des 18 colonnes vers le schéma canonique est assuré par les
 * synonymes FEC ajoutés à `HEADER_SYNONYMS` (`JournalCode` → journal,
 * `CompteNum` → account, `EcritureDate` → date, `EcritureLib` → label,
 * `CompAuxNum` → partner, `PieceRef` → pieceNumber, `Idevise` → currency).
 * Les dates compactes `AAAAMMJJ` sont normalisées par `parseImportDate`.
 */

/**
 * En-têtes canoniques d'un FEC (normalisés : minuscules, sans accent ni
 * séparateur). On exige qu'au moins `FEC_MIN_HEADER_MATCHES` d'entre eux
 * soient présents sur la première ligne pour confirmer qu'il s'agit bien
 * d'un FEC — protège contre un `.txt` quelconque nommé « fec ».
 */
const FEC_CANONICAL_HEADERS: readonly string[] = [
  'journalcode',
  'journallib',
  'ecriturenum',
  'ecrituredate',
  'comptenum',
  'comptelib',
  'compauxnum',
  'compauxlib',
  'pieceref',
  'piecedate',
  'ecriturelib',
  'debit',
  'credit',
  'ecriturelet',
  'datelet',
  'validdate',
  'montantdevise',
  'idevise',
];

const FEC_MIN_HEADER_MATCHES = 3;

@Injectable()
export class FecFileParser implements IFileParser {
  readonly id = 'fec';

  constructor(private readonly csvParser: CsvFileParser) {}

  canHandle(input: { mimeType: string; originalName: string }): boolean {
    const lower = input.originalName.toLowerCase();
    // Extension dédiée `.fec` : toujours accepté.
    if (lower.endsWith('.fec')) {
      return this.isTextMime(input.mimeType);
    }
    // Convention de nommage DGFiP : `SIRENFECAAAAMMJJ.txt`. On intercepte
    // les `.txt` / `.csv` dont le nom évoque un FEC AVANT que le parser
    // Sage (`.txt`) ou CSV générique ne s'en empare.
    if (lower.endsWith('.txt') || lower.endsWith('.csv')) {
      return lower.includes('fec') && this.isTextMime(input.mimeType);
    }
    return false;
  }

  private isTextMime(mimeType: string): boolean {
    return (
      mimeType === 'text/plain' ||
      mimeType === 'text/csv' ||
      mimeType === 'application/csv' ||
      mimeType === 'application/octet-stream'
    );
  }

  async parse(absolutePath: string, ctx: ParseContext = {}): Promise<ParseResult> {
    await this.assertLooksLikeFec(absolutePath);
    // Délègue au parser CSV en laissant l'auto-détection du séparateur
    // choisir entre `|` (cas standard FEC) et tabulation. On ne force
    // rien : un éditeur peut exporter le FEC dans l'une ou l'autre forme.
    return this.csvParser.parse(absolutePath, ctx);
  }

  /**
   * Lit la première ligne (non vide) et vérifie qu'elle contient au moins
   * `FEC_MIN_HEADER_MATCHES` en-têtes canoniques FEC. Lève
   * `FileParseError` sinon, avec un message qui oriente l'utilisateur.
   */
  private async assertLooksLikeFec(absolutePath: string): Promise<void> {
    const firstLine = await this.readFirstLine(absolutePath);
    const trimmed = firstLine.replace(/^﻿/, '').trim();
    if (trimmed.length === 0) {
      throw new FileParseError('Le fichier FEC est vide.');
    }

    // On normalise toute la ligne d'en-tête et on compte combien de
    // tokens canoniques y apparaissent — indépendant du séparateur réel.
    const normalised = trimmed
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase();
    const matches = FEC_CANONICAL_HEADERS.filter((h) => normalised.includes(h)).length;

    if (matches < FEC_MIN_HEADER_MATCHES) {
      throw new FileParseError(
        `Le fichier ne ressemble pas à un FEC : seulement ${matches} en-tête(s) FEC reconnu(s) ` +
          `(minimum attendu : ${FEC_MIN_HEADER_MATCHES}). Vérifiez l'export, ou importez-le ` +
          `comme un CSV / Texte brut si ses colonnes sont non standard.`,
      );
    }
  }

  private readFirstLine(absolutePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const stream = createReadStream(absolutePath, { encoding: 'utf8', highWaterMark: 4096 });
      let buffer = '';
      stream.on('data', (chunk: string | Buffer) => {
        buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
        const newlineIdx = buffer.indexOf('\n');
        if (newlineIdx !== -1) {
          stream.destroy();
          resolve(buffer.slice(0, newlineIdx).replace(/\r$/, ''));
        }
      });
      stream.on('end', () => resolve(buffer.replace(/\r$/, '')));
      stream.on('error', (err) => reject(new FileParseError('Impossible de lire le fichier FEC', err)));
    });
  }
}
