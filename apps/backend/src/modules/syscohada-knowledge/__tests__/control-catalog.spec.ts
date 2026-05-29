import { SYSCOHADA_CONTROL_CATALOG, getControlsForDomain } from '../data/control-catalog';
import type { SyscohadaDomain } from '../services/syscohada-knowledge.service';

describe('SYSCOHADA control catalog', () => {
  const ALL_DOMAINS: ReadonlyArray<SyscohadaDomain> = [
    'accounting-plan',
    'journals',
    'assets',
    'inventory',
    'tva',
    'reports',
    'leases',
    'provisions',
    'impairments',
    'subsidies',
    'actuarial-commitments',
    'regularizations',
    'business-combinations',
    'bills-of-exchange',
    'multi-currency',
    'pledged-assets',
    'cash-flow',
    'bank-reconciliation',
    'ai',
  ];

  it('defines at least one named control for every business domain', () => {
    for (const domain of ALL_DOMAINS) {
      expect(getControlsForDomain(domain).length).toBeGreaterThan(0);
    }
  });

  it('attaches an explicit legal basis and an evidence query to every control', () => {
    for (const control of SYSCOHADA_CONTROL_CATALOG) {
      expect(control.id).toMatch(/^[a-z0-9-]+$/);
      expect(control.legalBasis.length).toBeGreaterThan(0);
      expect(control.evidenceQuery.trim().length).toBeGreaterThan(0);
      expect(['blocking', 'warning', 'info']).toContain(control.severity);
      expect(control.tome).toBeGreaterThanOrEqual(0);
    }
  });

  it('uses unique control identifiers', () => {
    const ids = SYSCOHADA_CONTROL_CATALOG.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('enforces the double-entry balance control on the journals domain', () => {
    const journals = getControlsForDomain('journals');
    const balance = journals.find((c) => c.id === 'journal-equilibre-partie-double');
    expect(balance).toBeDefined();
    expect(balance?.severity).toBe('blocking');
    expect(balance?.legalBasis.join(' ')).toMatch(/AUDCIF/i);
  });

  it('enforces the balance-sheet equality control on the reports domain', () => {
    const reports = getControlsForDomain('reports');
    expect(reports.some((c) => c.id === 'bilan-actif-egal-passif')).toBe(true);
    expect(reports.some((c) => /art\.\s*8/i.test(c.legalBasis.join(' ')))).toBe(true);
  });
});
