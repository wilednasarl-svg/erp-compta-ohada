import { Test } from '@nestjs/testing';

import { ActuarialCommitmentsSyscohadaGuidanceController } from '../../actuarial-commitments/controllers/actuarial-commitments-syscohada-guidance.controller';
import { BankReconciliationSyscohadaGuidanceController } from '../../bank-reconciliation/controllers/bank-reconciliation-syscohada-guidance.controller';
import { BillsOfExchangeSyscohadaGuidanceController } from '../../bills-of-exchange/controllers/bills-of-exchange-syscohada-guidance.controller';
import { CashFlowSyscohadaGuidanceController } from '../../cash-flow/controllers/cash-flow-syscohada-guidance.controller';
import { ImpairmentsSyscohadaGuidanceController } from '../../impairments/controllers/impairments-syscohada-guidance.controller';
import { LeasesSyscohadaGuidanceController } from '../../leases/controllers/leases-syscohada-guidance.controller';
import { MultiCurrencySyscohadaGuidanceController } from '../../multi-currency/controllers/multi-currency-syscohada-guidance.controller';
import { PledgedAssetsSyscohadaGuidanceController } from '../../pledged-assets/controllers/pledged-assets-syscohada-guidance.controller';
import { ProvisionsSyscohadaGuidanceController } from '../../provisions/controllers/provisions-syscohada-guidance.controller';
import { RegularizationsSyscohadaGuidanceController } from '../../regularizations/controllers/regularizations-syscohada-guidance.controller';
import { SubsidiesSyscohadaGuidanceController } from '../../subsidies/controllers/subsidies-syscohada-guidance.controller';
import { TransformationsSyscohadaGuidanceController } from '../../transformations/controllers/transformations-syscohada-guidance.controller';
import { SyscohadaGuidanceModule } from '../syscohada-guidance.module';
import type { SyscohadaDomain } from '../services/syscohada-knowledge.service';

describe('SyscohadaGuidanceModule', () => {
  // Câblage DI réel : on compile le module avec le vrai SyscohadaKnowledgeService
  // (@Global), qui lit les PDF embarqués. Prouve que chaque endpoint métier est
  // monté et renvoie la guidance sourcée du bon domaine au runtime.
  it('mounts a guidance controller bound to its domain for every business module', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [SyscohadaGuidanceModule],
    }).compile();

    const cases: ReadonlyArray<
      [new (...args: never[]) => { getGuidance(): { domain: string } }, SyscohadaDomain]
    > = [
      [LeasesSyscohadaGuidanceController, 'leases'],
      [ProvisionsSyscohadaGuidanceController, 'provisions'],
      [ImpairmentsSyscohadaGuidanceController, 'impairments'],
      [SubsidiesSyscohadaGuidanceController, 'subsidies'],
      [ActuarialCommitmentsSyscohadaGuidanceController, 'actuarial-commitments'],
      [RegularizationsSyscohadaGuidanceController, 'regularizations'],
      [TransformationsSyscohadaGuidanceController, 'transformations'],
      [BillsOfExchangeSyscohadaGuidanceController, 'bills-of-exchange'],
      [MultiCurrencySyscohadaGuidanceController, 'multi-currency'],
      [PledgedAssetsSyscohadaGuidanceController, 'pledged-assets'],
      [CashFlowSyscohadaGuidanceController, 'cash-flow'],
      [BankReconciliationSyscohadaGuidanceController, 'bank-reconciliation'],
    ];

    for (const [Controller, domain] of cases) {
      const controller = moduleRef.get(Controller);
      expect(controller).toBeDefined();
      expect(controller.getGuidance().domain).toBe(domain);
    }

    await moduleRef.close();
  });
});
