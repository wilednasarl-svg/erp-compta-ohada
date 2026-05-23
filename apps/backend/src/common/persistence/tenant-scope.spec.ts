import { asTenantId, assertTenantId, type TenantId } from './tenant-scope';

describe('TenantId guards', () => {
  describe('assertTenantId', () => {
    it('accepts a non-empty string', () => {
      expect(() => assertTenantId('org-123')).not.toThrow();
    });

    it.each([
      ['empty string', ''],
      ['whitespace-only', '   '],
      ['undefined', undefined],
      ['null', null],
      ['number', 42],
      ['object', {}],
    ])('rejects %s', (_label, value) => {
      expect(() => assertTenantId(value)).toThrow(/Tenant scope violation/);
    });

    it('narrows the type to TenantId after a successful assertion', () => {
      const value: unknown = 'org-123';
      assertTenantId(value);
      // The branded type lets the next line compile only because of the
      // assertion above — this guards against future regressions where
      // `assertTenantId` would be downgraded to a `string` predicate.
      const branded: TenantId = value;
      expect(branded).toBe('org-123');
    });
  });

  describe('asTenantId', () => {
    it('returns the branded value when input is valid', () => {
      const result = asTenantId('org-123');
      expect(result).toBe('org-123');
    });

    it('throws when input is empty', () => {
      expect(() => asTenantId('')).toThrow(/Tenant scope violation/);
    });
  });
});
