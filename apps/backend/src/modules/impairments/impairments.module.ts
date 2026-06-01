import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AccountingPlanModule } from '../accounting-plan/accounting-plan.module';
import { AssetsModule } from '../assets/assets.module';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { InventoryModule } from '../inventory/inventory.module';
import { JournalsModule } from '../journals/journals.module';
import { RbacModule } from '../rbac/rbac.module';
import { ImpairmentsController } from './controllers/impairments.controller';
import { AssetsRepository } from '../assets/repositories/assets.repository';
import { DepreciationSchedulesRepository } from '../assets/repositories/depreciation-schedules.repository';
import { InventoryItemRepository } from '../inventory/repositories/inventory-item.repository';
import { AssetEntity } from '../assets/entities/asset.entity';
import { DepreciationScheduleEntity } from '../assets/entities/depreciation-schedule.entity';
import { InventoryItemEntity } from '../inventory/entities/inventory-item.entity';
import { AssetImpairmentEntity } from './entities/asset-impairment.entity';
import { InventoryImpairmentEntity } from './entities/inventory-impairment.entity';
import { AssetImpairmentsRepository } from './repositories/asset-impairments.repository';
import { InventoryImpairmentsRepository } from './repositories/inventory-impairments.repository';
import { ImpairmentsService } from './services/impairments.service';

/**
 * ImpairmentsModule — W3.2 SYSCOHADA Tome 2 chap. 12 + 14.
 *
 * Tests de valeur immo + stocks (App. 44 reprise plafonnée). Consomme
 * AssetsModule / InventoryModule en lecture seule (pas de modification
 * de leurs services existants). PAS de controller en wave 1 (REST API
 * exposée en wave 2).
 *
 * Dépend de :
 *   - AssetsModule (AssetsRepository, DepreciationSchedulesRepository)
 *   - InventoryModule (InventoryItemRepository)
 *   - AccountingPlanModule (OrganizationAccountRepository)
 *   - JournalsModule (EntriesService pour poster les dotations / reprises)
 *   - AuditModule (audit trail)
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      AssetImpairmentEntity,
      InventoryImpairmentEntity,
      // Réutilisés en lecture seule pour les repos d'assets / inventory.
      AssetEntity,
      DepreciationScheduleEntity,
      InventoryItemEntity,
    ]),
    AccountingPlanModule,
    AssetsModule,
    InventoryModule,
    AuditModule,
    JournalsModule,
    AuthModule,
    RbacModule,
  ],
  controllers: [ImpairmentsController],
  providers: [
    AssetImpairmentsRepository,
    InventoryImpairmentsRepository,
    // On instancie nos propres providers — pas d'export depuis Assets/Inventory.
    AssetsRepository,
    DepreciationSchedulesRepository,
    InventoryItemRepository,
    ImpairmentsService,
  ],
  exports: [ImpairmentsService],
})
export class ImpairmentsModule {}
