import { BusinessCombinationsSyscohadaGuidanceController } from '../controllers/business-combinations-syscohada-guidance.controller';
import type {
  SyscohadaKnowledgeService,
  SyscohadaModuleGuidance,
} from '../services/syscohada-knowledge.service';

describe('BusinessCombinationsSyscohadaGuidanceController', () => {
  it('delegates to the knowledge service for the business-combinations domain', () => {
    const guidance = {
      domain: 'business-combinations',
      references: [
        { domain: 'business-combinations', tome: 2, topic: 'Fusions', keywords: ['fusion'] },
      ],
      controls: [],
      evidence: [],
    } as unknown as SyscohadaModuleGuidance;
    const service = {
      getModuleGuidance: jest.fn().mockReturnValue(guidance),
    } as unknown as SyscohadaKnowledgeService;
    const controller = new BusinessCombinationsSyscohadaGuidanceController(service);

    const result = controller.getGuidance();

    expect(service.getModuleGuidance).toHaveBeenCalledWith('business-combinations');
    expect(result).toBe(guidance);
  });
});
