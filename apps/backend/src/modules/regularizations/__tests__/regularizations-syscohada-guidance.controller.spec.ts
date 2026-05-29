import { RegularizationsSyscohadaGuidanceController } from '../controllers/regularizations-syscohada-guidance.controller';
import type {
  SyscohadaKnowledgeService,
  SyscohadaModuleGuidance,
} from '../../syscohada-knowledge/services/syscohada-knowledge.service';

describe('RegularizationsSyscohadaGuidanceController', () => {
  it('delegates to the knowledge service for the regularizations domain', () => {
    const guidance = {
      domain: 'regularizations',
      references: [
        {
          domain: 'regularizations',
          tome: 1,
          topic: 'Régularisations',
          keywords: ['regularisation'],
        },
      ],
      controls: [],
      evidence: [],
    } as unknown as SyscohadaModuleGuidance;
    const service = {
      getModuleGuidance: jest.fn().mockReturnValue(guidance),
    } as unknown as SyscohadaKnowledgeService;
    const controller = new RegularizationsSyscohadaGuidanceController(service);

    const result = controller.getGuidance();

    expect(service.getModuleGuidance).toHaveBeenCalledWith('regularizations');
    expect(result).toBe(guidance);
  });
});
