import { SubsidiesSyscohadaGuidanceController } from '../controllers/subsidies-syscohada-guidance.controller';
import type {
  SyscohadaKnowledgeService,
  SyscohadaModuleGuidance,
} from '../../syscohada-knowledge/services/syscohada-knowledge.service';

describe('SubsidiesSyscohadaGuidanceController', () => {
  it('delegates to the knowledge service for the subsidies domain', () => {
    const guidance = {
      domain: 'subsidies',
      references: [
        { domain: 'subsidies', tome: 2, topic: 'Subventions', keywords: ['subvention'] },
      ],
      controls: [],
      evidence: [],
    } as unknown as SyscohadaModuleGuidance;
    const service = {
      getModuleGuidance: jest.fn().mockReturnValue(guidance),
    } as unknown as SyscohadaKnowledgeService;
    const controller = new SubsidiesSyscohadaGuidanceController(service);

    const result = controller.getGuidance();

    expect(service.getModuleGuidance).toHaveBeenCalledWith('subsidies');
    expect(result).toBe(guidance);
  });
});
