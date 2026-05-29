import { BankReconciliationSyscohadaGuidanceController } from '../controllers/bank-reconciliation-syscohada-guidance.controller';
import type {
  SyscohadaKnowledgeService,
  SyscohadaModuleGuidance,
} from '../../syscohada-knowledge/services/syscohada-knowledge.service';

describe('BankReconciliationSyscohadaGuidanceController', () => {
  it('delegates to the knowledge service for the bank-reconciliation domain', () => {
    const guidance = {
      domain: 'bank-reconciliation',
      references: [
        {
          domain: 'bank-reconciliation',
          tome: 1,
          topic: 'Rapprochement bancaire',
          keywords: ['rapprochement'],
        },
      ],
      controls: [],
      evidence: [],
    } as unknown as SyscohadaModuleGuidance;
    const service = {
      getModuleGuidance: jest.fn().mockReturnValue(guidance),
    } as unknown as SyscohadaKnowledgeService;
    const controller = new BankReconciliationSyscohadaGuidanceController(service);

    const result = controller.getGuidance();

    expect(service.getModuleGuidance).toHaveBeenCalledWith('bank-reconciliation');
    expect(result).toBe(guidance);
  });
});
