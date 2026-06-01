import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AssetsModule } from '../assets/assets.module';
import { DepreciationScheduleEntity } from '../assets/entities/depreciation-schedule.entity';
import { DepreciationSchedulesRepository } from '../assets/repositories/depreciation-schedules.repository';
import { AuthModule } from '../auth/auth.module';
import { JournalsModule } from '../journals/journals.module';
import { RbacModule } from '../rbac/rbac.module';
import { SubsidiesController } from './controllers/subsidies.controller';
import { SubsidyEntity } from './entities/subsidy.entity';
import { SubsidyReleaseEntity } from './entities/subsidy-release.entity';
import { SubsidiesRepository } from './repositories/subsidies.repository';
import { SubsidyReleasesRepository } from './repositories/subsidy-releases.repository';
import { SubsidiesService } from './services/subsidies.service';

/**
 * SubsidiesModule — W4.4 Subventions d'investissement SYSCOHADA.
 *
 * Wave 1 (cette PR) :
 *   - 2 entités TypeORM : SubsidyEntity, SubsidyReleaseEntity (mig 0098)
 *   - 2 repositories tenant-scope
 *   - SubsidiesService : create / releaseManual / releaseOnDepreciation /
 *     releaseLinearMonthly / findById / listByOrg / cancel
 *
 * Dépendances :
 *   - JournalsModule (EntriesService) : pose l'écriture d'octroi
 *     D 4494|521 / C 1411 et chaque reprise D 1411 / C 799.
 *   - AssetsModule (DepreciationSchedulesRepository) : lecture seule
 *     pour la méthode `on_depreciation` qui dérive la quote-part de
 *     subvention à reprendre du montant de la dotation d'amortissement.
 *
 * Pas de controller wave 1 — REST exposé en wave 2.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      SubsidyEntity,
      SubsidyReleaseEntity,
      // Réutilisé en lecture seule pour le repo des schedules.
      DepreciationScheduleEntity,
    ]),
    AssetsModule,
    JournalsModule,
    AuthModule,
    RbacModule,
  ],
  controllers: [SubsidiesController],
  providers: [
    SubsidiesRepository,
    SubsidyReleasesRepository,
    DepreciationSchedulesRepository,
    SubsidiesService,
  ],
  exports: [SubsidiesService],
})
export class SubsidiesModule {}
