import { MultiCurrencySyscohadaGuidanceController } from '../controllers/multi-currency-syscohada-guidance.controller';
import type {
  SyscohadaKnowledgeService,
  SyscohadaModuleGuidance,
} from '../../syscohada-knowledge/services/syscohada-knowledge.service';

describe('MultiCurrencySyscohadaGuidanceController', () => {
  it('delegates to the knowledge service for the multi-currency domain', () => {
    const guidance = {
      domain: 'multi-currency',
      references: [
        { domain: 'multi-currency', tome: 2, topic: 'Opérations en devises', keywords: ['devise'] },
      ],
      controls: [],
      evidence: [],
    } as unknown as SyscohadaModuleGuidance;
    const service = {
      getModuleGuidance: jest.fn().mockReturnValue(guidance),
    } as unknown as SyscohadaKnowledgeService;
    const controller = new MultiCurrencySyscohadaGuidanceController(service);

    const result = controller.getGuidance();

    expect(service.getModuleGuidance).toHaveBeenCalledWith('multi-currency');
    expect(result).toBe(guidance);
  });
});
