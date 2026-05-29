/**
 * Construit le plan d'import : pour chaque ligne, détermine s'il faut la créer,
 * si elle existe déjà, ou si son parent est introuvable. Pur → testable.
 *
 * L'endpoint de création exige un `parentCode` EXISTANT dont le `code` est un
 * préfixe strict. On traite donc les comptes du plus court au plus long (les
 * parents avant les enfants) et on résout le parent comme le plus long code
 * déjà connu (plan existant + comptes créés au fil de l'import) qui préfixe le
 * code. Un parent explicite fourni par le fichier est prioritaire s'il est valide.
 */

import type { RawAccountRow } from './parse';

export type PlanStatus = 'create' | 'exists' | 'no-parent';

export interface PlanItem {
  readonly code: string;
  readonly label: string;
  readonly parentCode: string | null;
  readonly status: PlanStatus;
}

export interface ImportPlan {
  readonly items: ReadonlyArray<PlanItem>;
  readonly toCreate: number;
  readonly existing: number;
  readonly blocked: number;
}

/** Plus long code de `known` qui est un préfixe STRICT de `code`. */
const longestKnownPrefix = (code: string, known: ReadonlySet<string>): string | null => {
  for (let len = code.length - 1; len >= 1; len -= 1) {
    const prefix = code.slice(0, len);
    if (known.has(prefix)) return prefix;
  }
  return null;
};

const isStrictPrefix = (parent: string, code: string): boolean =>
  code.length > parent.length && code.startsWith(parent);

export function buildImportPlan(
  existingCodes: ReadonlyArray<string>,
  rows: ReadonlyArray<RawAccountRow>,
): ImportPlan {
  const known = new Set<string>(existingCodes);
  // Dédoublonnage par code (dernière occurrence gagne le libellé) puis tri
  // parent-d'abord (longueur croissante, code croissant).
  const byCode = new Map<string, RawAccountRow>();
  for (const r of rows) byCode.set(r.code, r);
  const ordered = [...byCode.values()].sort((a, b) =>
    a.code.length !== b.code.length ? a.code.length - b.code.length : a.code.localeCompare(b.code),
  );

  const items: PlanItem[] = [];
  let toCreate = 0;
  let existing = 0;
  let blocked = 0;

  for (const row of ordered) {
    if (known.has(row.code)) {
      items.push({ code: row.code, label: row.label, parentCode: null, status: 'exists' });
      existing += 1;
      continue;
    }
    let parent: string | null = null;
    if (row.parentCode !== undefined && known.has(row.parentCode) && isStrictPrefix(row.parentCode, row.code)) {
      parent = row.parentCode;
    } else {
      parent = longestKnownPrefix(row.code, known);
    }
    if (parent !== null) {
      items.push({ code: row.code, label: row.label, parentCode: parent, status: 'create' });
      known.add(row.code);
      toCreate += 1;
    } else {
      items.push({ code: row.code, label: row.label, parentCode: null, status: 'no-parent' });
      blocked += 1;
    }
  }

  return { items, toCreate, existing, blocked };
}
