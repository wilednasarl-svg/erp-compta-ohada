import { BillsOfExchangeSyscohadaGuidanceController } from '../controllers/bills-of-exchange-syscohada-guidance.controller';
import type {
  SyscohadaKnowledgeService,
  SyscohadaModuleGuidance,
} from '../../syscohada-knowledge/services/syscohada-knowledge.service';

describe('BillsOfExchangeSyscohadaGuidanceController', () => {
  it('delegates to the knowledge service for the bills-of-exchange domain', () => {
    const guidance = {
      domain: 'bills-of-exchange',
      references: [
        { domain: 'bills-of-exchange', tome: 1, topic: 'Effets de commerce', keywords: ['effet'] },
      ],
      controls: [],
      evidence: [],
    } as unknown as SyscohadaModuleGuidance;
    const service = {
      getModuleGuidance: jest.fn().mockReturnValue(guidance),
    } as unknown as SyscohadaKnowledgeService;
    const controller = new BillsOfExchangeSyscohadaGuidanceController(service);

    const result = controller.getGuidance();

    expect(service.getModuleGuidance).toHaveBeenCalledWith('bills-of-exchange');
    expect(result).toBe(guidance);
  });
});
