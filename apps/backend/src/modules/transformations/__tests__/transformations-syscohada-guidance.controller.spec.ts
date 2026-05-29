import { TransformationsSyscohadaGuidanceController } from '../controllers/transformations-syscohada-guidance.controller';
import type {
  SyscohadaKnowledgeService,
  SyscohadaModuleGuidance,
} from '../../syscohada-knowledge/services/syscohada-knowledge.service';

describe('TransformationsSyscohadaGuidanceController', () => {
  it('delegates to the knowledge service for the transformations domain', () => {
    const guidance = {
      domain: 'transformations',
      references: [{ domain: 'transformations', tome: 2, topic: 'Fusions', keywords: ['fusion'] }],
      controls: [],
      evidence: [],
    } as unknown as SyscohadaModuleGuidance;
    const service = {
      getModuleGuidance: jest.fn().mockReturnValue(guidance),
    } as unknown as SyscohadaKnowledgeService;
    const controller = new TransformationsSyscohadaGuidanceController(service);

    const result = controller.getGuidance();

    expect(service.getModuleGuidance).toHaveBeenCalledWith('transformations');
    expect(result).toBe(guidance);
  });
});
