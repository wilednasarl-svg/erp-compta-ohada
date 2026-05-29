import { ImpairmentsSyscohadaGuidanceController } from '../controllers/impairments-syscohada-guidance.controller';
import type {
  SyscohadaKnowledgeService,
  SyscohadaModuleGuidance,
} from '../../syscohada-knowledge/services/syscohada-knowledge.service';

describe('ImpairmentsSyscohadaGuidanceController', () => {
  it('delegates to the knowledge service for the impairments domain', () => {
    const guidance = {
      domain: 'impairments',
      references: [
        { domain: 'impairments', tome: 1, topic: 'Dépréciations', keywords: ['depreciation'] },
      ],
      controls: [],
      evidence: [],
    } as unknown as SyscohadaModuleGuidance;
    const service = {
      getModuleGuidance: jest.fn().mockReturnValue(guidance),
    } as unknown as SyscohadaKnowledgeService;
    const controller = new ImpairmentsSyscohadaGuidanceController(service);

    const result = controller.getGuidance();

    expect(service.getModuleGuidance).toHaveBeenCalledWith('impairments');
    expect(result).toBe(guidance);
  });
});
