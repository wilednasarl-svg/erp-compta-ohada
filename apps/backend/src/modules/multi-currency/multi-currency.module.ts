import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { JournalsModule } from '../journals/journals.module';
import { RbacModule } from '../rbac/rbac.module';
import { CurrenciesController } from './controllers/currencies.controller';
import { ExchangeRatesController } from './controllers/exchange-rates.controller';
import { CurrencyEntity } from './entities/currency.entity';
import { ExchangeRateEntity } from './entities/exchange-rate.entity';
import { FxReevaluationRunEntity } from './entities/fx-reevaluation-run.entity';
import { CurrencyRepository } from './repositories/currency.repository';
import { ExchangeRateRepository } from './repositories/exchange-rate.repository';
import { FxReevaluationRunsRepository } from './repositories/fx-reevaluation-runs.repository';
import { CurrenciesService } from './services/currencies.service';
import { ExchangeRatesService } from './services/exchange-rates.service';
import { FxReevaluationService } from './services/fx-reevaluation.service';

/**
 * MultiCurrencyModule — Module 16.
 *
 * Wave 1 :
 *   - Catalogue ISO 4217 par organisation + journal historique des
 *     taux de change + conversion pure entre devises. Base XOF.
 *
 * Wave 3.4 :
 *   - `FxReevaluationService` : réévaluation FX à la clôture
 *     d'exercice (article 54 AU) + contre-passation au 01/01 N+1.
 *     Importe JournalsModule pour utiliser `EntriesService` (création
 *     + validation de l'écriture d'écart de conversion 478/479).
 *
 * Exporte `CurrenciesService`, `ExchangeRatesService` et
 * `FxReevaluationService` pour permettre aux modules clôture / reports
 * (M9, M11) de déclencher la réévaluation depuis leur workflow.
 *
 * TenantGuard dépend d'AuthEventsService exporté par AuditModule —
 * sans cet import, le boot Nest crash (cf. mémoire
 * `nest-useguards-requires-module-imports`).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([CurrencyEntity, ExchangeRateEntity, FxReevaluationRunEntity]),
    AuthModule,
    RbacModule,
    AuditModule,
    // Wave 3.4 — EntriesService est exporté par JournalsModule.
    JournalsModule,
  ],
  controllers: [CurrenciesController, ExchangeRatesController],
  providers: [
    CurrencyRepository,
    ExchangeRateRepository,
    FxReevaluationRunsRepository,
    CurrenciesService,
    ExchangeRatesService,
    FxReevaluationService,
  ],
  exports: [CurrenciesService, ExchangeRatesService, FxReevaluationService],
})
export class MultiCurrencyModule {}
