import { LeasesSyscohadaGuidanceController } from '../controllers/leases-syscohada-guidance.controller';
import type {
  SyscohadaKnowledgeService,
  SyscohadaModuleGuidance,
} from '../../syscohada-knowledge/services/syscohada-knowledge.service';

describe('LeasesSyscohadaGuidanceController', () => {
  it('delegates to the knowledge service for the leases domain', () => {
    const guidance = {
      domain: 'leases',
      references: [
        { domain: 'leases', tome: 2, topic: 'Location-acquisition', keywords: ['bail'] },
      ],
      controls: [],
      evidence: [],
    } as unknown as SyscohadaModuleGuidance;
    const service = {
      getModuleGuidance: jest.fn().mockReturnValue(guidance),
    } as unknown as SyscohadaKnowledgeService;
    const controller = new LeasesSyscohadaGuidanceController(service);

    const result = controller.getGuidance();

    expect(service.getModuleGuidance).toHaveBeenCalledWith('leases');
    expect(result).toBe(guidance);
  });
});
