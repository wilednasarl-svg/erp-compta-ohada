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
 * Principe : le **dernier** séparateur (`.` ou `,`) rencontré est la
 * décimale ; tout autre séparateur est un séparateur de milliers et est
 * supprimé. Cas particulier : un séparateur unique suivi d'exactement 3
 * chiffres (`1,234`) est interprété comme un séparateur de milliers
 * (→ `1234`) — les montants OHADA ont au plus 2 décimales.
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
    const sepCount = (s.match(/[.,]/g) ?? []).length;
    const intPart = s.slice(0, decPos).replace(/[.,]/g, '');
    const decPart = s.slice(decPos + 1).replace(/[.,]/g, '');
    normalized = sepCount === 1 && decPart.length === 3 ? intPart + decPart : `${intPart}.${decPart}`;
  }

  const n = Number.parseFloat(normalized);
  if (Number.isNaN(n)) return NaN;
  return negative ? -n : n;
}
