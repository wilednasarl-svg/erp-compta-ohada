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
 * Principe : le **dernier** séparateur (`.` ou `,`) rencontré est la
 * décimale ; tout autre séparateur est un séparateur de milliers et est
 * supprimé. Cas particulier traité : un séparateur unique suivi
 * d'exactement 3 chiffres (`1,234`) est interprété comme un séparateur
 * de milliers (→ `1234`), pas comme 3 décimales — les montants OHADA
 * ont au plus 2 décimales.
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
    const sepCount = (s.match(/[.,]/g) ?? []).length;
    const intPart = s.slice(0, decPos).replace(/[.,]/g, '');
    const decPart = s.slice(decPos + 1).replace(/[.,]/g, '');

    if (sepCount === 1 && decPart.length === 3) {
      // `1,234` / `1.234` → séparateur de milliers, valeur entière 1234.
      normalized = intPart + decPart;
    } else {
      normalized = `${intPart}.${decPart}`;
    }
  }

  const n = Number.parseFloat(normalized);
  if (Number.isNaN(n)) return NaN;
  return negative ? -n : n;
}
