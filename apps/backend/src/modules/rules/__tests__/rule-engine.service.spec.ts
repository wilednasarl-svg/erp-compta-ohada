import { asTenantId } from '../../../common/persistence/tenant-scope';
import { RuleEntity } from '../entities/rule.entity';
import { RuleEngineService } from '../services/rule-engine.service';
import type { RuleScope } from '../types/rule.types';
import type { ImportStagingEntryEntity } from '../../imports/entities/import-staging-entry.entity';

/**
 * Unit tests for `RuleEngineService`.
 *
 * Strategy :
 *   - `evaluateRuleOnEntry` : tests directs sur l'évaluateur de conditions
 *     (pure function — pas de DB).
 *   - `simulateRules` : vérifie le plan retourné et que aucune transformation
 *     n'est créée (TransformationService.reclassifyEntry jamais appelé).
 *   - `applyRules` : vérifie que TransformationService est appelé pour chaque
 *     action matchée, et qu'un audit est émis.
 *
 * On mocke intégralement les dépendances (repos, staging, TransformationService,
 * AuditTrailService) — on ne teste pas la DB.
 */
describe('RuleEngineService', () => {
  const ORG_ID = asTenantId('00000000-0000-4000-8000-000000000001');
  const USER_ID = '00000000-0000-4000-8000-000000000002';
  const RULE_ID = '00000000-0000-4000-8000-000000000003';
  const ENTRY_ID = '00000000-0000-4000-8000-000000000004';
  const ENTRY_ID_2 = '00000000-0000-4000-8000-000000000005';

  const AUDIT_CTX = { ipAddress: '127.0.0.1', userAgent: 'test', userId: USER_ID, organizationId: ORG_ID };

  // ---------------------------------------------------------------------------
  // Factories
  // ---------------------------------------------------------------------------

  function buildEntry(mappedValues: Record<string, string>, id = ENTRY_ID): ImportStagingEntryEntity {
    return {
      id,
      sessionId: '00000000-0000-4000-8000-000000000099',
      mappedValues,
      errors: [],
    } as unknown as ImportStagingEntryEntity;
  }

  function buildRule(overrides: Partial<RuleEntity> = {}): RuleEntity {
    return {
      id: RULE_ID,
      organizationId: ORG_ID,
      name: 'Test Rule',
      isActive: true,
      priority: 100,
      conditions: [],
      actions: [],
      ...overrides,
    } as RuleEntity;
  }

  function buildService(overrides: Partial<Record<string, unknown>> = {}) {
    const ruleRepo = {
      findById: jest.fn(),
      findActive: jest.fn(),
    };
    const executionRepo = {
      create: jest.fn().mockResolvedValue({ id: 'exec-1' }),
    };
    const stagingRepo = {
      createQueryBuilder: jest.fn().mockReturnValue({
        innerJoin: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      }),
    };
    const sessionRepo = {};
    const transformations = {
      reclassifyEntry: jest.fn().mockResolvedValue({ id: 'trf-1' }),
    };
    const audit = {
      record: jest.fn().mockResolvedValue(null),
    };

    const svc = new RuleEngineService(
      ruleRepo as any,
      executionRepo as any,
      stagingRepo as any,
      sessionRepo as any,
      transformations as any,
      audit as any,
    );

    return { svc, ruleRepo, executionRepo, stagingRepo, transformations, audit };
  }

  // ---------------------------------------------------------------------------
  // evaluateRuleOnEntry — pure evaluation, no side effects
  // ---------------------------------------------------------------------------

  describe('evaluateRuleOnEntry', () => {
    it('retourne [] quand aucune condition (règle vide)', () => {
      const { svc } = buildService();
      const rule = buildRule({ conditions: [], actions: [{ type: 'add_tag', tag: 'X' }] });
      const entry = buildEntry({ account: '621000', journal: 'BQ' });
      // Règle sans conditions → toutes vides → every([]) = true → actions retournées
      expect(svc.evaluateRuleOnEntry(rule, entry)).toEqual([{ type: 'add_tag', tag: 'X' }]);
    });

    it('retourne les actions quand account_prefix matche', () => {
      const { svc } = buildService();
      const rule = buildRule({
        conditions: [{ type: 'account_prefix', prefix: '62' }],
        actions: [{ type: 'assign_cost_center', costCenter: 'ADMIN' }],
      });
      const entry = buildEntry({ account: '621000', journal: 'BQ' });
      expect(svc.evaluateRuleOnEntry(rule, entry)).toEqual([
        { type: 'assign_cost_center', costCenter: 'ADMIN' },
      ]);
    });

    it('retourne [] quand account_prefix ne matche pas', () => {
      const { svc } = buildService();
      const rule = buildRule({
        conditions: [{ type: 'account_prefix', prefix: '40' }],
        actions: [{ type: 'add_tag', tag: 'FOURNISSEUR' }],
      });
      const entry = buildEntry({ account: '621000', journal: 'AC' });
      expect(svc.evaluateRuleOnEntry(rule, entry)).toEqual([]);
    });

    it('retourne les actions quand journal_in matche', () => {
      const { svc } = buildService();
      const rule = buildRule({
        conditions: [{ type: 'journal_in', journals: ['BQ', 'CA'] }],
        actions: [{ type: 'reclassify_account', targetAccount: '512000' }],
      });
      const entry = buildEntry({ account: '521000', journal: 'BQ' });
      expect(svc.evaluateRuleOnEntry(rule, entry)).toHaveLength(1);
    });

    it('retourne [] quand journal_in ne matche pas', () => {
      const { svc } = buildService();
      const rule = buildRule({
        conditions: [{ type: 'journal_in', journals: ['AC'] }],
        actions: [{ type: 'add_tag', tag: 'X' }],
      });
      const entry = buildEntry({ account: '401000', journal: 'BQ' });
      expect(svc.evaluateRuleOnEntry(rule, entry)).toEqual([]);
    });

    it('évalue plusieurs conditions en AND — toutes doivent matcher', () => {
      const { svc } = buildService();
      const rule = buildRule({
        conditions: [
          { type: 'account_prefix', prefix: '62' },
          { type: 'journal_in', journals: ['BQ'] },
        ],
        actions: [{ type: 'assign_cost_center', costCenter: 'ADMIN' }],
      });

      // Les deux matchent → actions
      expect(
        svc.evaluateRuleOnEntry(rule, buildEntry({ account: '621000', journal: 'BQ' })),
      ).toHaveLength(1);

      // Seulement account matche → []
      expect(
        svc.evaluateRuleOnEntry(rule, buildEntry({ account: '621000', journal: 'OD' })),
      ).toEqual([]);
    });

    it('évalue amount_range correctement', () => {
      const { svc } = buildService();
      const rule = buildRule({
        conditions: [{ type: 'amount_range', side: 'debit', min: 1000, max: 5000 }],
        actions: [{ type: 'add_tag', tag: 'BIG' }],
      });

      expect(svc.evaluateRuleOnEntry(rule, buildEntry({ debit: '2500' }))).toHaveLength(1);
      expect(svc.evaluateRuleOnEntry(rule, buildEntry({ debit: '500' }))).toEqual([]);
      expect(svc.evaluateRuleOnEntry(rule, buildEntry({ debit: '10000' }))).toEqual([]);
    });

    it('évalue label_contains (insensible à la casse)', () => {
      const { svc } = buildService();
      const rule = buildRule({
        conditions: [{ type: 'label_contains', substring: 'facture' }],
        actions: [{ type: 'add_tag', tag: 'INVOICE' }],
      });

      expect(svc.evaluateRuleOnEntry(rule, buildEntry({ label: 'Règlement FACTURE #42' }))).toHaveLength(1);
      expect(svc.evaluateRuleOnEntry(rule, buildEntry({ label: 'Salaire mensuel' }))).toEqual([]);
    });

    it('évalue date_range correctement', () => {
      const { svc } = buildService();
      const rule = buildRule({
        conditions: [{ type: 'date_range', from: '2026-01-01', to: '2026-03-31' }],
        actions: [{ type: 'add_tag', tag: 'T1' }],
      });

      expect(svc.evaluateRuleOnEntry(rule, buildEntry({ date: '2026-02-15' }))).toHaveLength(1);
      expect(svc.evaluateRuleOnEntry(rule, buildEntry({ date: '2025-12-31' }))).toEqual([]);
      expect(svc.evaluateRuleOnEntry(rule, buildEntry({ date: '2026-04-01' }))).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // simulateRules
  // ---------------------------------------------------------------------------

  describe('simulateRules', () => {
    it('retourne les matches sans créer de transformations', async () => {
      const { svc, ruleRepo, stagingRepo, transformations, executionRepo, audit } = buildService();

      const rule = buildRule({
        conditions: [{ type: 'account_prefix', prefix: '62' }],
        actions: [{ type: 'assign_cost_center', costCenter: 'ADMIN' }],
      });
      ruleRepo.findById.mockResolvedValue(rule);

      const entry = buildEntry({ account: '621000', journal: 'BQ' });
      stagingRepo.createQueryBuilder.mockReturnValue({
        innerJoin: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([entry]),
      });

      const scope: RuleScope = {};
      const result = await svc.simulateRules(ORG_ID, RULE_ID, scope, USER_ID, AUDIT_CTX);

      // Résultat correct
      expect(result.mode).toBe('simulation');
      expect(result.matchedCount).toBe(1);
      expect(result.appliedCount).toBe(0);
      expect(result.matches).toHaveLength(1);
      expect(result.matches[0].entryId).toBe(ENTRY_ID);
      expect(result.matches[0].transformationIds).toBeNull();

      // Aucune transformation créée
      expect(transformations.reclassifyEntry).not.toHaveBeenCalled();

      // Exécution persistée
      expect(executionRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ mode: 'simulation', matchedCount: 1 }),
      );

      // Audit émis
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'rule_simulated', entityId: RULE_ID }),
      );
    });

    it('retourne matchedCount=0 si aucune écriture ne matche', async () => {
      const { svc, ruleRepo, stagingRepo } = buildService();

      const rule = buildRule({
        conditions: [{ type: 'account_prefix', prefix: '40' }],
        actions: [{ type: 'add_tag', tag: 'FOUR' }],
      });
      ruleRepo.findById.mockResolvedValue(rule);

      stagingRepo.createQueryBuilder.mockReturnValue({
        innerJoin: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([
          buildEntry({ account: '621000' }),
          buildEntry({ account: '521000' }, ENTRY_ID_2),
        ]),
      });

      const result = await svc.simulateRules(ORG_ID, RULE_ID, {}, USER_ID, AUDIT_CTX);
      expect(result.matchedCount).toBe(0);
      expect(result.matches).toHaveLength(0);
    });

    it('lève RULE_NOT_FOUND si la règle n\'appartient pas à l\'org', async () => {
      const { svc, ruleRepo } = buildService();
      ruleRepo.findById.mockResolvedValue(null);

      await expect(
        svc.simulateRules(ORG_ID, RULE_ID, {}, USER_ID, AUDIT_CTX),
      ).rejects.toMatchObject({ code: 'RULE_NOT_FOUND' });
    });
  });

  // ---------------------------------------------------------------------------
  // applyRules
  // ---------------------------------------------------------------------------

  describe('applyRules', () => {
    it('délègue à TransformationService et retourne les IDs créés', async () => {
      const { svc, ruleRepo, stagingRepo, transformations, executionRepo, audit } = buildService();

      const rule = buildRule({
        conditions: [{ type: 'account_prefix', prefix: '62' }],
        actions: [{ type: 'assign_cost_center', costCenter: 'ADMIN' }],
      });
      ruleRepo.findById.mockResolvedValue(rule);

      const entry = buildEntry({ account: '621000', journal: 'BQ' });
      stagingRepo.createQueryBuilder.mockReturnValue({
        innerJoin: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([entry]),
      });

      transformations.reclassifyEntry.mockResolvedValue({ id: 'trf-abc' });

      const result = await svc.applyRules(ORG_ID, RULE_ID, {}, USER_ID, AUDIT_CTX);

      // Transformation créée
      expect(transformations.reclassifyEntry).toHaveBeenCalledOnce();
      expect(transformations.reclassifyEntry).toHaveBeenCalledWith(
        ORG_ID,
        USER_ID,
        expect.objectContaining({ sourceEntryId: ENTRY_ID }),
        AUDIT_CTX,
      );

      // Résultat correct
      expect(result.mode).toBe('apply');
      expect(result.matchedCount).toBe(1);
      expect(result.appliedCount).toBe(1);
      expect(result.matches[0].transformationIds).toContain('trf-abc');

      // Exécution persistée avec mode apply
      expect(executionRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ mode: 'apply', appliedCount: 1 }),
      );

      // Audit émis rule_applied
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'rule_applied' }),
      );
    });

    it('filtre par journal dans le scope', async () => {
      const { svc, ruleRepo, stagingRepo } = buildService();

      const rule = buildRule({
        conditions: [],
        actions: [{ type: 'add_tag', tag: 'X' }],
      });
      ruleRepo.findById.mockResolvedValue(rule);

      // Deux entrées : une BQ, une AC
      stagingRepo.createQueryBuilder.mockReturnValue({
        innerJoin: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([
          buildEntry({ account: '621000', journal: 'BQ' }, ENTRY_ID),
          buildEntry({ account: '621000', journal: 'AC' }, ENTRY_ID_2),
        ]),
      });

      const result = await svc.applyRules(ORG_ID, RULE_ID, { journal: 'BQ' }, USER_ID, AUDIT_CTX);

      // Le filtre journal ne retient que l'entrée BQ
      expect(result.matchedCount).toBe(1);
      expect(result.matches[0].entryId).toBe(ENTRY_ID);
    });

    it('continue les autres entrées si une transformation échoue', async () => {
      const { svc, ruleRepo, stagingRepo, transformations } = buildService();

      const rule = buildRule({
        conditions: [],
        actions: [{ type: 'assign_cost_center', costCenter: 'OPS' }],
      });
      ruleRepo.findById.mockResolvedValue(rule);

      stagingRepo.createQueryBuilder.mockReturnValue({
        innerJoin: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([
          buildEntry({ account: '621000' }, ENTRY_ID),
          buildEntry({ account: '622000' }, ENTRY_ID_2),
        ]),
      });

      // Première transformation échoue, deuxième réussit
      transformations.reclassifyEntry
        .mockRejectedValueOnce(new Error('DB timeout'))
        .mockResolvedValueOnce({ id: 'trf-ok' });

      const result = await svc.applyRules(ORG_ID, RULE_ID, {}, USER_ID, AUDIT_CTX);

      // Les deux entrées matchées, une seule transformée avec succès
      expect(result.matchedCount).toBe(2);
      expect(result.error).toBeDefined();
      // Le service ne throw pas — il continue
    });
  });
});
