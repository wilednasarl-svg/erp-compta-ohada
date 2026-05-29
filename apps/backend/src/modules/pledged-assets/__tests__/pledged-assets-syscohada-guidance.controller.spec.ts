import { PledgedAssetsSyscohadaGuidanceController } from '../controllers/pledged-assets-syscohada-guidance.controller';
import type {
  SyscohadaKnowledgeService,
  SyscohadaModuleGuidance,
} from '../../syscohada-knowledge/services/syscohada-knowledge.service';

describe('PledgedAssetsSyscohadaGuidanceController', () => {
  it('delegates to the knowledge service for the pledged-assets domain', () => {
    const guidance = {
      domain: 'pledged-assets',
      references: [
        {
          domain: 'pledged-assets',
          tome: 2,
          topic: 'Garanties et engagements',
          keywords: ['garantie'],
        },
      ],
      controls: [],
      evidence: [],
    } as unknown as SyscohadaModuleGuidance;
    const service = {
      getModuleGuidance: jest.fn().mockReturnValue(guidance),
    } as unknown as SyscohadaKnowledgeService;
    const controller = new PledgedAssetsSyscohadaGuidanceController(service);

    const result = controller.getGuidance();

    expect(service.getModuleGuidance).toHaveBeenCalledWith('pledged-assets');
    expect(result).toBe(guidance);
  });
});
