/**
 * Parsing robuste d'un montant comptable issu d'un fichier importé
 * (CSV / Excel / Sage). Gère indifféremment les deux conventions, car
 * un fichier source peut venir d'Excel FR, Excel US, Sage, etc. :
 *
 *   - Format français  : `1 234 567,89` ou `1.234.567,89`
 *     (espace ou point = milliers, virgule = décimale)
 *   - Format anglais/US : `1,234,567.89`
 *     (virgule = milliers, point = décimale)
 *
 * Principe : si les deux types de séparateurs (`.` ET `,`) coexistent,
 * le **dernier** est la décimale et l'autre les milliers. Si un seul
 * type est présent (qu'il apparaisse une ou plusieurs fois) et que le
 * dernier groupe fait exactement 3 chiffres, c'est un séparateur de
 * milliers : `1,234` → `1234`, `100,000,000` → `100000000`,
 * `1.234.567` → `1234567`. Les montants OHADA ont au plus 2 décimales,
 * donc un groupe final de 3 chiffres ne peut pas être décimal.
 *
 * Gère aussi : espaces insécables (NBSP), symboles/lettres parasites
 * (FCFA, €…), signe `-` et parenthèses comptables `(1 234,00)` = négatif.
 *
 * Retourne `NaN` si la chaîne ne contient aucun chiffre exploitable, à
 * charge de l'appelant de décider (0, erreur de validation, etc.).
 *
 * NB : doublon volontaire de `apps/frontend/src/lib/parse-amount.ts`
 * (pas de package partagé front/back dans ce monorepo). Garder les deux
 * en phase si la logique évolue.
 */
export function parseAccountingAmount(raw: string | number | null | undefined): number {
  if (raw === null || raw === undefined) return NaN;
  if (typeof raw === 'number') return raw;

  let s = raw.trim();
  if (s === '') return NaN;

  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.includes('-')) negative = true;

  s = s.replace(/[^\d.,]/g, '');
  if (s === '') return NaN;

  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');

  let normalized: string;
  if (lastDot === -1 && lastComma === -1) {
    normalized = s;
  } else {
    const decPos = Math.max(lastDot, lastComma);
    // Un seul TYPE de séparateur présent (que des `,` OU que des `.`) :
    // si le dernier groupe fait exactement 3 chiffres, ce séparateur est
    // un séparateur de MILLIERS, pas une décimale. Couvre aussi bien
    // `1,234` (→1234) que `100,000,000` (→100000000) ou `1.234.567`
    // (→1234567). Les montants OHADA ont au plus 2 décimales, donc un
    // groupe final de 3 chiffres ne peut pas être une partie décimale.
    // Si les DEUX types sont présents (`1,234.56`, `1.234.567,89`), le
    // dernier séparateur est la décimale et l'autre les milliers.
    const onlyOneSepType = lastDot === -1 || lastComma === -1;
    const lastGroup = s.slice(decPos + 1);
    if (onlyOneSepType && /^\d{3}$/.test(lastGroup)) {
      normalized = s.replace(/[.,]/g, '');
    } else {
      const intPart = s.slice(0, decPos).replace(/[.,]/g, '');
      normalized = `${intPart}.${lastGroup.replace(/[.,]/g, '')}`;
    }
  }

  const n = Number.parseFloat(normalized);
  if (Number.isNaN(n)) return NaN;
  return negative ? -n : n;
}
