import { isAllowedCorsOrigin } from './cors-origin';

describe('isAllowedCorsOrigin', () => {
  it('accepts the configured frontend origin', () => {
    expect(
      isAllowedCorsOrigin(
        'https://erp-compta-ohada-frontend.vercel.app',
        'https://erp-compta-ohada-frontend.vercel.app',
      ),
    ).toBe(true);
  });

  it('accepts Vercel deployment URLs for the same frontend project', () => {
    expect(
      isAllowedCorsOrigin(
        'https://erp-compta-ohada-frontend-a32jtiq95-wiledna-s-projects.vercel.app',
        'https://erp-compta-ohada-frontend.vercel.app',
      ),
    ).toBe(true);
  });

  it('rejects unrelated origins', () => {
    expect(
      isAllowedCorsOrigin(
        'https://erp-compta-ohada-frontend.attacker.example',
        'https://erp-compta-ohada-frontend.vercel.app',
      ),
    ).toBe(false);
  });
});
