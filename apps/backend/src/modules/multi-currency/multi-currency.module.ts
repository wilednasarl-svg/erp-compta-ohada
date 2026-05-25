import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module';
import { RbacModule } from '../rbac/rbac.module';
import { CurrenciesController } from './controllers/currencies.controller';
import { ExchangeRatesController } from './controllers/exchange-rates.controller';
import { CurrencyEntity } from './entities/currency.entity';
import { ExchangeRateEntity } from './entities/exchange-rate.entity';
import { CurrencyRepository } from './repositories/currency.repository';
import { ExchangeRateRepository } from './repositories/exchange-rate.repository';
import { CurrenciesService } from './services/currencies.service';
import { ExchangeRatesService } from './services/exchange-rates.service';

/**
 * MultiCurrencyModule — Module 16 wave 1.
 *
 * Catalogue ISO 4217 par organisation + journal historique des taux
 * de change + conversion pure entre devises. Base XOF (CFA UEMOA).
 *
 * Exporte `CurrenciesService` et `ExchangeRatesService` pour que les
 * futurs modules (FX impact sur journals en wave 2, banking
 * multi-devises Module 15 wave 2) puissent appeler la résolution de
 * taux + conversion sans dupliquer la logique.
 *
 * Pour activer le module, ajouter dans app.module.ts :
 *   - import { MultiCurrencyModule } from './modules/multi-currency/multi-currency.module';
 *   - imports: [..., MultiCurrencyModule]
 *
 * Et brancher le seed des devises dans OrganizationsService.create
 * (cf. JournalsService.seedStandardJournals pour le pattern).
 */
@Module({
  imports: [TypeOrmModule.forFeature([CurrencyEntity, ExchangeRateEntity]), AuthModule, RbacModule],
  controllers: [CurrenciesController, ExchangeRatesController],
  providers: [CurrencyRepository, ExchangeRateRepository, CurrenciesService, ExchangeRatesService],
  exports: [CurrenciesService, ExchangeRatesService],
})
export class MultiCurrencyModule {}
