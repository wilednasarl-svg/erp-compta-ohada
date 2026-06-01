/**
 * Parsing d'une balance uploadée (CSV / Excel) — fonctions pures extraites de
 * `balance-upload-console.tsx` pour rester sous la limite de taille de fichier
 * et rendre le parsing testable isolément.
 *
 * Port fidèle de la logique du monolithe legacy : détection de séparateur,
 * header sur les 5 premières lignes, forward-fill des groupes de colonnes
 * (MOUVEMENT / SOLDE), priorité au SOLDE, parsing FR + US des montants.
 *
 * NOTE : les totaux calculés ici (`totalDebit`/`totalCredit`) servent
 * UNIQUEMENT au contrôle d'équilibre du fichier uploadé (preview). Le Bilan /
 * Compte de résultat officiel est produit côté backend.
 */

import { parseAccountingAmount } from '@/lib/parse-amount';

export interface UploadedBalanceRow {
  code: string;
  label: string;
  debit: string;
  credit: string;
}

export interface BalanceParsed {
  rows: UploadedBalanceRow[];
  totalDebit: number;
  totalCredit: number;
  columnHints: Record<string, string>;
}

export function parseBalanceCsv(text: string): BalanceParsed {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) throw new Error('Fichier trop court ou vide.');

  const first = lines[0] ?? '';
  const sep = ([';', '\t', ',', '|'] as const).find((s) => first.split(s).length > 2) ?? ';';

  const parseLine = (line: string): string[] => {
    const cols: string[] = [];
    let cur = '';
    let inQ = false;
    for (const ch of line) {
      if (ch === '"' || ch === "'") {
        inQ = !inQ;
        continue;
      }
      if (!inQ && ch === sep) {
        cols.push(cur.trim());
        cur = '';
        continue;
      }
      cur += ch;
    }
    cols.push(cur.trim());
    return cols;
  };

  let headerIdx = 0;
  let header: string[] = [];
  for (let i = 0; i < Math.min(5, lines.length); i++) {
    const h = parseLine(lines[i] ?? '').map((c) => c.toLowerCase());
    if (h.some((c) => /compte|code|libel|d[eé]bit|cr[eé]dit/.test(c))) {
      header = h;
      headerIdx = i;
      break;
    }
  }
  if (header.length === 0) {
    header = parseLine(first).map((c) => c.toLowerCase());
    headerIdx = 0;
  }

  // Ligne de groupe (au-dessus du header) : certains exports de balance
  // empilent les colonnes par groupe — « MOUVEMENT 2025 | MOUVEMENT 2026 |
  // SOLDE », chacun couvrant une paire Débit/Crédit, les titres étant
  // fusionnés sur la 1re cellule du groupe. On la récupère et on propage
  // (forward-fill) le titre sur les cellules fusionnées vides, pour savoir
  // à quel groupe appartient chaque colonne.
  let groupLabels: string[] = [];
  if (headerIdx > 0) {
    const raw = parseLine(lines[headerIdx - 1] ?? '').map((c) => c.toLowerCase());
    let last = '';
    groupLabels = header.map((_, i) => {
      if ((raw[i] ?? '').trim() !== '') last = (raw[i] ?? '').trim();
      return last;
    });
  }

  const findCol = (...patterns: RegExp[]): number => {
    for (const p of patterns) {
      const idx = header.findIndex((h) => p.test(h));
      if (idx !== -1) return idx;
    }
    return -1;
  };

  // Sélection d'une colonne de montant. Quand PLUSIEURS colonnes matchent
  // (fichier MOUVEMENT + SOLDE), on choisit le SOLDE : on privilégie la
  // colonne dont l'en-tête OU le groupe au-dessus contient « solde » ; à
  // défaut la DERNIÈRE paire (le solde est conventionnellement en fin de
  // tableau). Une seule colonne candidate → comportement inchangé.
  const findAmountCol = (...patterns: RegExp[]): number => {
    const matches: number[] = [];
    header.forEach((h, i) => {
      if (patterns.some((p) => p.test(h))) matches.push(i);
    });
    if (matches.length === 0) return -1;
    if (matches.length === 1) return matches[0] ?? -1;
    const soldeIdx = matches.find(
      (i) => /solde/.test(header[i] ?? '') || /solde/.test(groupLabels[i] ?? ''),
    );
    return soldeIdx ?? matches[matches.length - 1] ?? -1;
  };

  const codeIdx = findCol(/n[°o]?\s*compte/, /^compte$/, /^code$/, /num[eé]ro/, /^n°/);
  const labelIdx = findCol(/lib[eé]ll/, /intitul/, /d[eé]sign/, /^label/);
  const debitIdx = findAmountCol(/solde\s*d[eé]bit/, /^s\.?d\.?$/, /^d[eé]bit/, /^sd$/, /d[eé]bit/);
  const creditIdx = findAmountCol(/solde\s*cr[eé]dit/, /^s\.?c\.?$/, /^cr[eé]dit/, /^sc$/, /cr[eé]dit/);

  if (codeIdx === -1)
    throw new Error('Colonne "Compte" introuvable. Vérifier les en-têtes du fichier CSV.');
  if (debitIdx === -1 && creditIdx === -1)
    throw new Error(
      'Colonnes "Débit" / "Crédit" introuvables. En-têtes attendus : Solde Débiteur, Solde Créditeur.',
    );

  // Parsing robuste FR + US (voir @/lib/parse-amount). Les soldes de
  // balance sont des montants positifs : on prend la valeur absolue.
  const parseAmt = (s: string): string => {
    const n = parseAccountingAmount(s);
    return Number.isNaN(n) ? '0' : Math.abs(n).toFixed(2);
  };

  const rows: UploadedBalanceRow[] = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (!line.trim()) continue;
    const cols = parseLine(line);
    const code = (cols[codeIdx] ?? '').replace(/['" ]/g, '');
    if (!code || !/^\d/.test(code)) continue;
    const label = labelIdx >= 0 ? (cols[labelIdx] ?? '').trim() : '';
    const debit = parseAmt(debitIdx >= 0 ? (cols[debitIdx] ?? '') : '0');
    const credit = parseAmt(creditIdx >= 0 ? (cols[creditIdx] ?? '') : '0');
    if (Number(debit) === 0 && Number(credit) === 0) continue;
    rows.push({ code, label, debit, credit });
  }

  if (rows.length === 0)
    throw new Error(
      'Aucun compte trouvé. Vérifier le format (codes comptes commençant par un chiffre).',
    );

  const colName = (i: number): string => {
    if (i < 0) return '—';
    const h = header[i] ?? '—';
    const g = (groupLabels[i] ?? '').trim();
    // Affiche le groupe (ex. « debit (solde) ») pour que l'utilisateur
    // voie quelle colonne a été retenue quand le fichier en a plusieurs.
    return g !== '' && !h.includes(g) ? `${h} (${g})` : h;
  };
  return {
    rows,
    totalDebit: rows.reduce((s, r) => s + Number(r.debit), 0),
    totalCredit: rows.reduce((s, r) => s + Number(r.credit), 0),
    columnHints: {
      compte: colName(codeIdx),
      libellé: colName(labelIdx),
      débit: colName(debitIdx),
      crédit: colName(creditIdx),
    },
  };
}

export async function parseBalanceXlsx(buffer: ArrayBuffer): Promise<BalanceParsed> {
  // Import dynamique & paresseux : le module `xlsx` n'est chargé que lorsqu'un
  // fichier Excel est effectivement déposé (et jamais en test CSV).
  const XLSX = await import('xlsx');
  const wb = XLSX.read(new Uint8Array(buffer), { type: 'array' });
  const wsName = wb.SheetNames[0];
  if (!wsName) throw new Error('Fichier Excel vide (aucune feuille détectée).');
  const ws = wb.Sheets[wsName];
  if (!ws) throw new Error('Feuille Excel introuvable.');
  /* Convert to semicolon-delimited CSV — reuses all header-detection logic */
  const csv = XLSX.utils.sheet_to_csv(ws, { FS: ';' });
  return parseBalanceCsv(csv);
}
