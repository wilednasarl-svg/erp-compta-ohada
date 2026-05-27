import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AccountingPlanModule } from '../accounting-plan/accounting-plan.module';
import { AuthModule } from '../auth/auth.module';
import { RbacModule } from '../rbac/rbac.module';
import { AuditModule } from '../audit/audit.module';
import { JournalsModule } from '../journals/journals.module';
import { AssetEntity } from './entities/asset.entity';
import { DepreciationScheduleEntity } from './entities/depreciation-schedule.entity';
import { AssetsRepository } from './repositories/assets.repository';
import { DepreciationSchedulesRepository } from './repositories/depreciation-schedules.repository';
import { AssetsService } from './services/assets.service';
import { AssetsController } from './controllers/assets.controller';

/**
 * AssetsModule — Module 12 Immobilisations & Amortissements (SYSCOHADA).
 *
 * Registre des immobilisations corporelles et incorporelles. Calcul
 * automatique de l'échéancier d'amortissement (linéaire / dégressif)
 * et comptabilisation des dotations via EntriesService (Module 8).
 *
 * Dépend de :
 *   - JournalsModule (EntriesService pour poster les dotations)
 *   - AuthModule + RbacModule (guards JWT / tenant / permission)
 *   - AuditModule (audit trail)
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([AssetEntity, DepreciationScheduleEntity]),
    AuthModule,
    RbacModule,
    AuditModule,
    AccountingPlanModule,
    JournalsModule,
  ],
  controllers: [AssetsController],
  providers: [AssetsRepository, DepreciationSchedulesRepository, AssetsService],
  // W2.4.c — `AssetsRepository` et `DepreciationSchedulesRepository`
  // sont ré-exportés pour que `ReportsModule` puisse les injecter dans
  // l'adapter `NoteAssetsDeps` (Notes annexes N3A/N3B/N3C/N3D).
  exports: [AssetsService, AssetsRepository, DepreciationSchedulesRepository],
})
export class AssetsModule {}
