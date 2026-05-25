import { Test, type TestingModule } from '@nestjs/testing';

import { asTenantId } from '../../../common/persistence/tenant-scope';
import { AuditTrailService } from '../../audit/services/audit-trail.service';
import { AiMappingService, type TargetField } from '../services/ai-mapping.service';

/**
 * `AiMappingService` — unit tests sur l'auto-détection des colonnes
 * Sage. Aucun DB / Nest setup nécessaire : on injecte un audit mock
 * et on attaque les heuristiques pures.
 */
describe('AiMappingService', () => {
  const ORG_ID = asTenantId('00000000-0000-4000-8000-000000000001');
  const ACTOR_ID = '00000000-0000-4000-8000-000000000002';
  const ctx = { ipAddress: null, userAgent: null };

  let service: AiMappingService;
  let audit: { record: jest.Mock };

  beforeEach(async () => {
    audit = { record: jest.fn().mockResolvedValue(null) };
    const module: TestingModule = await Test.createTestingModule({
      providers: [AiMappingService, { provide: AuditTrailService, useValue: audit }],
    }).compile();
    service = module.get(AiMappingService);
  });

  describe('matchHeaderPattern', () => {
    const cases: Array<[string, TargetField]> = [
      ['N° Compte', 'account_code'],
      ['Numero compte', 'account_code'],
      ['Libellé', 'description'],
      ['Description', 'description'],
      ['Débit', 'debit'],
      ['Crédit', 'credit'],
      ['Date écriture', 'entry_date'],
      ['Code journal', 'journal_code'],
      ['Tiers', 'partner'],
      ['N° Pièce', 'reference'],
    ];

    it.each(cases)('matches "%s" → %s', (header, expected) => {
      const result = service.inferColumn(header, 0, []);
      expect(result.targetField).toBe(expected);
      expect(result.confidence).toBeGreaterThanOrEqual(70);
    });
  });

  describe('inferFromValues', () => {
    it('detects an account-code column from sample values', () => {
      const inferred = service.inferFromValues(['411', '4011', '6132', '521', '6051']);
      expect(inferred).not.toBeNull();
      expect(inferred!.kind).toBe('account_code');
      expect(inferred!.field).toBe('account_code');
    });

    it('detects a date column (DD/MM/YYYY)', () => {
      const inferred = service.inferFromValues([
        '15/06/2026',
        '01/07/2026',
        '20/07/2026',
        '30/07/2026',
      ]);
      expect(inferred).not.toBeNull();
      expect(inferred!.kind).toBe('date');
      expect(inferred!.field).toBe('entry_date');
    });

    it('returns null on heterogeneous values (no clear winner)', () => {
      const inferred = service.inferFromValues(['ABC', '123', '15/06/2026', 'hello']);
      expect(inferred).toBeNull();
    });
  });

  describe('suggestColumns — Sage realistic header set', () => {
    it('reaches ≥ 80% coverage on a standard Sage export', async () => {
      const headers = [
        'Date',
        'Code journal',
        'N° Compte',
        'Libellé',
        'Débit',
        'Crédit',
        'Tiers',
        'N° Pièce',
      ];
      const sampleRows = [
        ['15/06/2026', 'AC', '6132', 'Loyer juin', '750000', '0', 'SOCIDA', 'F-2026-001'],
        ['16/06/2026', 'AC', '6051', 'CIE juin', '120000', '0', 'CIE', 'F-2026-002'],
      ];
      const { mappings, coverage } = await service.suggestColumns(
        { organizationId: ORG_ID, headers, sampleRows },
        ACTOR_ID,
        ctx,
      );
      expect(mappings).toHaveLength(headers.length);
      expect(coverage).toBeGreaterThanOrEqual(80);
      const byField = new Map(
        mappings.filter((m) => m.targetField).map((m) => [m.targetField!, m]),
      );
      expect(byField.get('entry_date')).toBeDefined();
      expect(byField.get('journal_code')).toBeDefined();
      expect(byField.get('account_code')).toBeDefined();
      expect(byField.get('description')).toBeDefined();
      expect(byField.get('debit')).toBeDefined();
      expect(byField.get('credit')).toBeDefined();
    });

    it('emits a mapping_suggested audit event', async () => {
      await service.suggestColumns(
        { organizationId: ORG_ID, headers: ['Date'], sampleRows: [] },
        ACTOR_ID,
        ctx,
      );
      expect(audit.record).toHaveBeenCalledTimes(1);
      const call = audit.record.mock.calls[0][0] as { module: string; action: string };
      expect(call.module).toBe('ai');
      expect(call.action).toBe('mapping_suggested');
    });

    it('writes off duplicate targets (keeps the higher-confidence one)', async () => {
      // Two columns both look like account_code; only the strongest
      // wins, the other gets `targetField=null` with explanatory reason.
      const headers = ['N° Compte', 'Compte général'];
      const { mappings } = await service.suggestColumns(
        { organizationId: ORG_ID, headers, sampleRows: [] },
        ACTOR_ID,
        ctx,
      );
      const accountColumns = mappings.filter((m) => m.targetField === 'account_code');
      expect(accountColumns).toHaveLength(1);
      const dropped = mappings.find((m) => m.sourceColumn === 'Compte général');
      expect(dropped!.targetField).toBeNull();
      expect(dropped!.reason).toMatch(/écarté/);
    });
  });
});
