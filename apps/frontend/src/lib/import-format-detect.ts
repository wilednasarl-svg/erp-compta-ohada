/**
 * Détection « best-effort » du format d'un fichier importé, côté client,
 * à seule fin de FEEDBACK rassurant ("✓ Détecté : FEC") après l'upload.
 *
 * L'autorité réelle reste le backend (parser résolu + auto-mapping) ;
 * cette heuristique ne pilote aucune logique métier. Elle s'appuie sur le
 * nom du fichier puis sur les en-têtes détectés renvoyés par l'analyse.
 */

const FEC_HEADER_TOKENS = [
  'journalcode',
  'ecrituredate',
  'comptenum',
  'compauxnum',
  'ecriturelib',
  'pieceref',
] as const;

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

/**
 * Renvoie un libellé de format lisible, ou `null` si rien de probant.
 */
export function detectImportFormat(input: {
  readonly fileName: string;
  readonly headers?: ReadonlyArray<string>;
}): string | null {
  const name = input.fileName.toLowerCase();
  const headers = (input.headers ?? []).map(normalize);

  // Signature FEC : en-têtes canoniques (≥ 2) ou extension .fec.
  const fecMatches = FEC_HEADER_TOKENS.filter((t) => headers.includes(t)).length;
  if (name.endsWith('.fec') || fecMatches >= 2) {
    return 'FEC (Fichier des Écritures Comptables)';
  }
  if (name.endsWith('.ofx') || name.endsWith('.qbo')) {
    return 'Relevé bancaire OFX';
  }
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    return 'Excel';
  }
  if (name.endsWith('.pdf')) {
    return 'PDF (tableau natif)';
  }
  if (name.endsWith('.txt')) {
    return 'Export Sage (TXT)';
  }
  if (name.endsWith('.csv')) {
    return 'CSV';
  }
  return null;
}
