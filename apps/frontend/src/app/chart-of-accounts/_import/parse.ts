/**
 * Normalisation des lignes d'un fichier plan comptable (CSV ou XLSX) en
 * lignes de compte exploitables. Pur (ne dépend pas de SheetJS) → le parsing
 * binaire vit dans le composant ; ici on ne traite que des enregistrements
 * déjà extraits (`Record<string, unknown>` issus de `sheet_to_json`), ce qui
 * rend la détection de colonnes et le nettoyage testables isolément.
 */

export interface RawAccountRow {
  readonly code: string;
  readonly label: string;
  /** Parent explicite si la colonne existe ; sinon résolu plus tard par préfixe. */
  readonly parentCode?: string;
}

export interface ColumnMapping {
  readonly codeKey: string | null;
  readonly labelKey: string | null;
  readonly parentKey: string | null;
}

export interface NormalizeResult {
  readonly rows: ReadonlyArray<RawAccountRow>;
  /** Lignes ignorées faute de code ou de libellé exploitable. */
  readonly dropped: number;
  readonly mapping: ColumnMapping;
}

const norm = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');

/** Détecte les colonnes code / libellé / parent à partir des en-têtes. */
export function detectColumns(headers: ReadonlyArray<string>): ColumnMapping {
  let codeKey: string | null = null;
  let labelKey: string | null = null;
  let parentKey: string | null = null;

  for (const h of headers) {
    const n = norm(h);
    if (parentKey === null && n.includes('parent')) {
      parentKey = h;
      continue;
    }
    if (codeKey === null && (n === 'code' || n.includes('compte') || n.includes('code'))) {
      codeKey = h;
      continue;
    }
    if (
      labelKey === null &&
      (n.includes('libelle') || n.includes('label') || n.includes('intitule') || n === 'nom')
    ) {
      labelKey = h;
    }
  }
  return { codeKey, labelKey, parentKey };
}

const asText = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  return String(v).trim();
};

/** Garde uniquement les chiffres (les exports ajoutent parfois des espaces/points). */
const cleanCode = (raw: string): string => raw.replace(/[^0-9]/g, '');

export function normalizeRows(records: ReadonlyArray<Record<string, unknown>>): NormalizeResult {
  if (records.length === 0) {
    return { rows: [], dropped: 0, mapping: { codeKey: null, labelKey: null, parentKey: null } };
  }
  const headers = Object.keys(records[0]!);
  const mapping = detectColumns(headers);

  if (mapping.codeKey === null || mapping.labelKey === null) {
    return { rows: [], dropped: records.length, mapping };
  }

  const rows: RawAccountRow[] = [];
  let dropped = 0;
  for (const rec of records) {
    const code = cleanCode(asText(rec[mapping.codeKey]));
    const label = asText(rec[mapping.labelKey]);
    if (code.length < 2 || code.length > 10 || label.length < 2) {
      dropped += 1;
      continue;
    }
    const parentRaw = mapping.parentKey !== null ? cleanCode(asText(rec[mapping.parentKey])) : '';
    rows.push(parentRaw.length > 0 ? { code, label, parentCode: parentRaw } : { code, label });
  }
  return { rows, dropped, mapping };
}
