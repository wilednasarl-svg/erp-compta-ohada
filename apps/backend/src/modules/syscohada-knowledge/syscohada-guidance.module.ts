import { Module } from '@nestjs/common';

import { ActuarialCommitmentsSyscohadaGuidanceController } from '../actuarial-commitments/controllers/actuarial-commitments-syscohada-guidance.controller';
import { BankReconciliationSyscohadaGuidanceController } from '../bank-reconciliation/controllers/bank-reconciliation-syscohada-guidance.controller';
import { BillsOfExchangeSyscohadaGuidanceController } from '../bills-of-exchange/controllers/bills-of-exchange-syscohada-guidance.controller';
import { CashFlowSyscohadaGuidanceController } from '../cash-flow/controllers/cash-flow-syscohada-guidance.controller';
import { ImpairmentsSyscohadaGuidanceController } from '../impairments/controllers/impairments-syscohada-guidance.controller';
import { LeasesSyscohadaGuidanceController } from '../leases/controllers/leases-syscohada-guidance.controller';
import { MultiCurrencySyscohadaGuidanceController } from '../multi-currency/controllers/multi-currency-syscohada-guidance.controller';
import { PledgedAssetsSyscohadaGuidanceController } from '../pledged-assets/controllers/pledged-assets-syscohada-guidance.controller';
import { ProvisionsSyscohadaGuidanceController } from '../provisions/controllers/provisions-syscohada-guidance.controller';
import { RegularizationsSyscohadaGuidanceController } from '../regularizations/controllers/regularizations-syscohada-guidance.controller';
import { SubsidiesSyscohadaGuidanceController } from '../subsidies/controllers/subsidies-syscohada-guidance.controller';

import { BusinessCombinationsSyscohadaGuidanceController } from './controllers/business-combinations-syscohada-guidance.controller';
import { SyscohadaKnowledgeModule } from './syscohada-knowledge.module';

/**
 * SyscohadaGuidanceModule — monte les endpoints `<module>/syscohada-guidance`
 * pour chaque domaine métier relié au Guide d'application SYSCOHADA.
 *
 * Ces controllers ne dépendent QUE du `SyscohadaKnowledgeService` (`@Global`,
 * lecture seule de doctrine), pas des services/entités de leur module métier.
 * On les regroupe donc ici plutôt que dans chaque module métier :
 *   - un seul point de montage dans `AppModule` ;
 *   - pas besoin de réveiller des modules métier encore dormants (non importés
 *     dans l'application) juste pour exposer leur doctrine ;
 *   - une seule source de déclaration, donc aucun risque de double
 *     enregistrement si un module métier est câblé plus tard.
 *
 * Les routes restent inchangées (`leases/syscohada-guidance`, etc.) : elles
 * sont portées par le décorateur `@Controller`, pas par le module hôte.
 */
@Module({
  imports: [SyscohadaKnowledgeModule],
  controllers: [
    LeasesSyscohadaGuidanceController,
    ProvisionsSyscohadaGuidanceController,
    ImpairmentsSyscohadaGuidanceController,
    SubsidiesSyscohadaGuidanceController,
    ActuarialCommitmentsSyscohadaGuidanceController,
    RegularizationsSyscohadaGuidanceController,
    BusinessCombinationsSyscohadaGuidanceController,
    BillsOfExchangeSyscohadaGuidanceController,
    MultiCurrencySyscohadaGuidanceController,
    PledgedAssetsSyscohadaGuidanceController,
    CashFlowSyscohadaGuidanceController,
    BankReconciliationSyscohadaGuidanceController,
  ],
})
export class SyscohadaGuidanceModule {}
