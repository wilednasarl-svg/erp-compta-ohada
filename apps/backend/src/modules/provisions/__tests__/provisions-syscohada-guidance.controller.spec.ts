import { ProvisionsSyscohadaGuidanceController } from '../controllers/provisions-syscohada-guidance.controller';
import type {
  SyscohadaKnowledgeService,
  SyscohadaModuleGuidance,
} from '../../syscohada-knowledge/services/syscohada-knowledge.service';

describe('ProvisionsSyscohadaGuidanceController', () => {
  it('delegates to the knowledge service for the provisions domain', () => {
    const guidance = {
      domain: 'provisions',
      references: [{ domain: 'provisions', tome: 2, topic: 'Provisions', keywords: ['provision'] }],
      controls: [],
      evidence: [],
    } as unknown as SyscohadaModuleGuidance;
    const service = {
      getModuleGuidance: jest.fn().mockReturnValue(guidance),
    } as unknown as SyscohadaKnowledgeService;
    const controller = new ProvisionsSyscohadaGuidanceController(service);

    const result = controller.getGuidance();

    expect(service.getModuleGuidance).toHaveBeenCalledWith('provisions');
    expect(result).toBe(guidance);
  });
});
