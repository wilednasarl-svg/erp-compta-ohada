import { buildSlugWithSuffix, slugify } from './slug';

describe('slugify (BE-ORG-01)', () => {
  it('lowercases, kebab-cases, and strips ASCII punctuation', () => {
    expect(slugify('Cabinet Konan')).toBe('cabinet-konan');
    expect(slugify('Cabinet Konan & Associés')).toBe('cabinet-konan-associes');
  });

  it('strips Unicode accents via NFKD normalization', () => {
    expect(slugify('Société Générale')).toBe('societe-generale');
    expect(slugify('Crème Brûlée Côté Sud')).toBe('creme-brulee-cote-sud');
  });

  it('collapses runs of punctuation into a single dash and trims edges', () => {
    expect(slugify('   ---hello---world---   ')).toBe('hello-world');
    expect(slugify('A   B,  C/D')).toBe('a-b-c-d');
  });

  it('falls back to "organization" when normalization wipes the input', () => {
    expect(slugify('')).toBe('organization');
    expect(slugify('---')).toBe('organization');
    expect(slugify('!!!')).toBe('organization');
    // 漢字 alone has no Latin transliteration in NFKD → falls back too.
    expect(slugify('漢字')).toBe('organization');
  });

  it('caps the base slug to 58 chars to leave room for a -9999 suffix', () => {
    const long = 'a'.repeat(200);
    const result = slugify(long);
    expect(result.length).toBeLessThanOrEqual(58);
  });

  it('is idempotent on already-slugified input', () => {
    expect(slugify('already-clean')).toBe('already-clean');
  });
});

describe('buildSlugWithSuffix (BE-ORG-01)', () => {
  it('returns the base unchanged for suffix=1', () => {
    expect(buildSlugWithSuffix('cabinet-konan', 1)).toBe('cabinet-konan');
  });

  it('appends -N for suffix >= 2', () => {
    expect(buildSlugWithSuffix('cabinet-konan', 2)).toBe('cabinet-konan-2');
    expect(buildSlugWithSuffix('cabinet-konan', 17)).toBe('cabinet-konan-17');
  });

  it('treats suffix=0 / negative as base (defensive)', () => {
    expect(buildSlugWithSuffix('x', 0)).toBe('x');
    expect(buildSlugWithSuffix('x', -1)).toBe('x');
  });
});
