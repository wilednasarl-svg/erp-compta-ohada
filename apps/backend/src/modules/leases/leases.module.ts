import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { JournalsModule } from '../journals/journals.module';
import { LeaseEntity } from './entities/lease.entity';
import { LeaseInstallmentEntity } from './entities/lease-installment.entity';
import { LeasePaymentEntity } from './entities/lease-payment.entity';
import { LeaseInstallmentsRepository } from './repositories/lease-installments.repository';
import { LeasePaymentsRepository } from './repositories/lease-payments.repository';
import { LeasesRepository } from './repositories/leases.repository';
import { LeasesService } from './services/leases.service';

/**
 * LeasesModule — W4.5 Crédit-bail / location-acquisition SYSCOHADA.
 *
 * Wave 1 (cette PR) :
 *   - 3 entités TypeORM (LeaseEntity, LeaseInstallmentEntity,
 *     LeasePaymentEntity) — migration 0099
 *   - 3 repositories tenant-scope
 *   - `ImplicitRateCalculator` (fonctions pures)
 *   - `LeasesService` : create / payInstallment / findById / listByOrg / cancel
 *
 * Dépendances :
 *   - JournalsModule (EntriesService) : pour poser les écritures
 *     comptables D 2411 / C 173 (prise du contrat) et
 *     D 6724 + D 173 / C 521 (échéance loyer).
 *
 * Pas de controller wave 1 : la couche REST est livrée dans la PR
 * suivante (wave 2). Le service est exporté pour permettre à un
 * futur module de s'y brancher.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([LeaseEntity, LeaseInstallmentEntity, LeasePaymentEntity]),
    JournalsModule,
  ],
  providers: [
    LeasesRepository,
    LeaseInstallmentsRepository,
    LeasePaymentsRepository,
    LeasesService,
  ],
  exports: [LeasesService],
})
export class LeasesModule {}
