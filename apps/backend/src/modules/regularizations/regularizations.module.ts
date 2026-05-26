import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { JournalsModule } from '../journals/journals.module';
import { RegularizationBatchEntity } from './entities/regularization-batch.entity';
import { RegularizationEntryEntity } from './entities/regularization-entry.entity';
import { RegularizationBatchesRepository } from './repositories/regularization-batches.repository';
import { RegularizationEntriesRepository } from './repositories/regularization-entries.repository';
import { RegularizationsService } from './services/regularizations.service';

/**
 * RegularizationsModule — W3.5 Régularisations périodiques OHADA.
 *
 * Wave 1 (cette PR) :
 *   - 2 entités TypeORM : RegularizationBatchEntity / RegularizationEntryEntity (mig 0096)
 *   - 2 repositories tenant-scope
 *   - RegularizationsService : create / addEntry / removeEntry /
 *     execute / reverse / cancel / list / find
 *
 * Dépendances :
 *   - JournalsModule (EntriesService) : pour poser l'écriture
 *     agrégée à l'exécution et l'écriture symétrique d'extourne.
 *
 * Pas de controller wave 1 : la couche REST est livrée en wave 2
 * (controllers + permissions dans une migration dédiée). Le service
 * est exporté pour permettre à un futur module (rapprochement, audit…)
 * de s'y brancher.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([RegularizationBatchEntity, RegularizationEntryEntity]),
    JournalsModule,
  ],
  providers: [
    RegularizationBatchesRepository,
    RegularizationEntriesRepository,
    RegularizationsService,
  ],
  exports: [RegularizationsService],
})
export class RegularizationsModule {}
