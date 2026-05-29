import { ActuarialCommitmentsSyscohadaGuidanceController } from '../controllers/actuarial-commitments-syscohada-guidance.controller';
import type {
  SyscohadaKnowledgeService,
  SyscohadaModuleGuidance,
} from '../../syscohada-knowledge/services/syscohada-knowledge.service';

describe('ActuarialCommitmentsSyscohadaGuidanceController', () => {
  it('delegates to the knowledge service for the actuarial-commitments domain', () => {
    const guidance = {
      domain: 'actuarial-commitments',
      references: [
        {
          domain: 'actuarial-commitments',
          tome: 2,
          topic: 'Engagements de retraite',
          keywords: ['retraite'],
        },
      ],
      controls: [],
      evidence: [],
    } as unknown as SyscohadaModuleGuidance;
    const service = {
      getModuleGuidance: jest.fn().mockReturnValue(guidance),
    } as unknown as SyscohadaKnowledgeService;
    const controller = new ActuarialCommitmentsSyscohadaGuidanceController(service);

    const result = controller.getGuidance();

    expect(service.getModuleGuidance).toHaveBeenCalledWith('actuarial-commitments');
    expect(result).toBe(guidance);
  });
});
