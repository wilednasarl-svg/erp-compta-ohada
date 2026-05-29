import { CashFlowSyscohadaGuidanceController } from '../controllers/cash-flow-syscohada-guidance.controller';
import type {
  SyscohadaKnowledgeService,
  SyscohadaModuleGuidance,
} from '../../syscohada-knowledge/services/syscohada-knowledge.service';

describe('CashFlowSyscohadaGuidanceController', () => {
  it('delegates to the knowledge service for the cash-flow domain', () => {
    const guidance = {
      domain: 'cash-flow',
      references: [
        { domain: 'cash-flow', tome: 3, topic: 'Flux de trésorerie', keywords: ['flux'] },
      ],
      controls: [],
      evidence: [],
    } as unknown as SyscohadaModuleGuidance;
    const service = {
      getModuleGuidance: jest.fn().mockReturnValue(guidance),
    } as unknown as SyscohadaKnowledgeService;
    const controller = new CashFlowSyscohadaGuidanceController(service);

    const result = controller.getGuidance();

    expect(service.getModuleGuidance).toHaveBeenCalledWith('cash-flow');
    expect(result).toBe(guidance);
  });
});
