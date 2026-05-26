import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { JournalsModule } from '../journals/journals.module';
import { ProvisionEntity } from './entities/provision.entity';
import { ProvisionMovementEntity } from './entities/provision-movement.entity';
import { ProvisionMovementsRepository } from './repositories/provision-movements.repository';
import { ProvisionsRepository } from './repositories/provisions.repository';
import { ProvisionsService } from './services/provisions.service';

/**
 * ProvisionsModule — W3.1 Provisions pour risques et charges SYSCOHADA.
 *
 * Wave 1 (cette PR) :
 *   - 2 entites TypeORM : ProvisionEntity, ProvisionMovementEntity (mig 0094)
 *   - 2 repositories tenant-scope
 *   - ProvisionsService : create / dotation / reprise / utilization
 *
 * Dependances :
 *   - JournalsModule (EntriesService) : pour poser les ecritures
 *     comptables D 691x|697x / C 19x (dotation) et D 19x / C 791x|797x
 *     (reprise). Pas d ecriture sur `utilization` (le paiement est
 *     pose ailleurs).
 *
 * Pas de controller wave 1 : la couche REST est livree dans la PR
 * suivante (wave 2). Le service est exporte pour permettre a un futur
 * module (ex. Module 21 Collaboration) de s y brancher.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([ProvisionEntity, ProvisionMovementEntity]),
    JournalsModule,
  ],
  providers: [ProvisionsRepository, ProvisionMovementsRepository, ProvisionsService],
  exports: [ProvisionsService],
})
export class ProvisionsModule {}
