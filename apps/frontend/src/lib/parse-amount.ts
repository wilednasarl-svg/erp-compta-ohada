/**
 * Parsing robuste d'un montant comptable saisi dans un fichier importé
 * (balance CSV / Excel converti en CSV).
 *
 * Gère indifféremment les deux conventions de séparateurs, parce qu'un
 * fichier source peut venir d'Excel FR, Excel US, Sage, etc. :
 *
 *   - Format français  : `1 234 567,89` ou `1.234.567,89`
 *     (espace ou point = milliers, virgule = décimale)
 *   - Format anglais/US : `1,234,567.89`
 *     (virgule = milliers, point = décimale)
 *
 * Principe : si les deux types de séparateurs (`.` ET `,`) coexistent,
 * le **dernier** est la décimale et l'autre les milliers. Si un seul
 * type est présent (une ou plusieurs fois) et que le dernier groupe fait
 * exactement 3 chiffres, c'est un séparateur de milliers : `1,234` →
 * `1234`, `100,000,000` → `100000000`, `1.234.567` → `1234567`. Les
 * montants OHADA ont au plus 2 décimales, donc un groupe final de 3
 * chiffres ne peut pas être une partie décimale.
 *
 * Gère aussi : espaces insécables (NBSP), symboles monétaires/lettres
 * (FCFA, €, …), signe `-` et parenthèses comptables `(1 234,00)` = négatif.
 *
 * Retourne `NaN` si la chaîne ne contient aucun chiffre exploitable —
 * l'appelant décide quoi en faire (0, erreur, etc.).
 */
export function parseAccountingAmount(raw: string | number | null | undefined): number {
  if (raw === null || raw === undefined) return NaN;
  if (typeof raw === 'number') return raw;

  let s = raw.trim();
  if (s === '') return NaN;

  // Parenthèses comptables → négatif.
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.includes('-')) negative = true;

  // Ne garder que chiffres + séparateurs `.` et `,`.
  s = s.replace(/[^\d.,]/g, '');
  if (s === '') return NaN;

  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');

  let normalized: string;
  if (lastDot === -1 && lastComma === -1) {
    // Entier sans séparateur.
    normalized = s;
  } else {
    const decPos = Math.max(lastDot, lastComma);
    // Un seul TYPE de séparateur présent (que des `,` OU que des `.`) :
    // si le dernier groupe fait exactement 3 chiffres, ce séparateur est
    // un séparateur de MILLIERS, pas une décimale. Couvre `1,234` (→1234),
    // `100,000,000` (→100000000) et `1.234.567` (→1234567). Si les deux
    // types sont présents (`1,234.56`), le dernier est la décimale.
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
