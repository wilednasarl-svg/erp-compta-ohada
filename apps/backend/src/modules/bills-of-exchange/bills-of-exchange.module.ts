import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module';
import { JournalsModule } from '../journals/journals.module';
import { RbacModule } from '../rbac/rbac.module';
import { BillsOfExchangeController } from './controllers/bills-of-exchange.controller';
import { BillEventEntity } from './entities/bill-event.entity';
import { BillOfExchangeEntity } from './entities/bill-of-exchange.entity';
import { BillEventsRepository } from './repositories/bill-events.repository';
import { BillsOfExchangeRepository } from './repositories/bills-of-exchange.repository';
import { BillsOfExchangeService } from './services/bills-of-exchange.service';

/**
 * BillsOfExchangeModule — W4.6 Effets de commerce SYSCOHADA.
 *
 * Wave 1 (cette PR) :
 *   - 2 entites TypeORM : BillOfExchangeEntity, BillEventEntity (mig 0100)
 *   - 2 repositories tenant-scope
 *   - BillsOfExchangeService : issue / discount / settle / markUnpaid
 *
 * Dependances :
 *   - JournalsModule (EntriesService) : pour poser les ecritures
 *     comptables associees a chaque transition (D 412/C 411 a
 *     l'emission, escompte 4 lignes, paiement, impaye...).
 *
 * Pas de controller wave 1 : la couche REST est livree dans la PR
 * suivante (wave 2). Le service est exporte pour qu'un module amont
 * (ex. workflows banque) puisse s'y brancher.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([BillOfExchangeEntity, BillEventEntity]),
    JournalsModule,
    AuthModule,
    RbacModule,
  ],
  controllers: [BillsOfExchangeController],
  providers: [BillsOfExchangeRepository, BillEventsRepository, BillsOfExchangeService],
  exports: [BillsOfExchangeService],
})
export class BillsOfExchangeModule {}
