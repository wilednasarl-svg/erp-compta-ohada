/**
 * Slug derivation for organization names.
 *
 * Rules (spec: BE-ORG-01, `specs/organizations/spec.md` → "Organization
 * creation"):
 *   - Strip Unicode accents via NFKD normalization, drop combining marks.
 *   - Lowercase the entire string.
 *   - Replace any run of non-alphanumeric characters with a single `-`.
 *   - Trim leading / trailing `-`.
 *   - Cap at `MAX_SLUG_LENGTH` characters (collision suffix will fit
 *     inside the cap thanks to `MAX_BASE_LENGTH`).
 *   - Fallback to `"organization"` when normalization wipes the string
 *     to empty (e.g. an input made of only punctuation or non-Latin
 *     characters with no Latin transliteration).
 *
 * Collision handling is the caller's responsibility — see
 * `OrganizationsService.create` which appends `-2`, `-3`, … until
 * `OrganizationRepository.slugExists` returns `false`.
 */

const MAX_SLUG_LENGTH = 64;
// Reserve 6 chars at the end so a `-9999` suffix can always be appended
// without re-truncating mid-creation. Plenty for realistic collision rates.
const MAX_BASE_LENGTH = MAX_SLUG_LENGTH - 6;

const FALLBACK_SLUG = 'organization';

export function slugify(input: string): string {
  if (typeof input !== 'string') {
    return FALLBACK_SLUG;
  }
  const normalized = input
    .normalize('NFKD')
    // Drop combining diacritical marks (the "tail" of a decomposed
    // accented letter). Range U+0300–U+036F covers Latin / Greek /
    // Cyrillic accents.
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (normalized.length === 0) {
    return FALLBACK_SLUG;
  }
  return normalized.slice(0, MAX_BASE_LENGTH);
}

/**
 * Build the n-th collision candidate from a base slug. `suffix === 1`
 * returns the base unchanged; `suffix === 2` returns `${base}-2`, etc.
 *
 * Kept as a pure function so `OrganizationsService.deriveAvailableSlug`
 * can drive it from a counter without leaking the format string.
 */
export function buildSlugWithSuffix(base: string, suffix: number): string {
  if (suffix <= 1) {
    return base;
  }
  return `${base}-${suffix}`;
}
