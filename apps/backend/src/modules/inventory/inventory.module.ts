import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AccountingPlanModule } from '../accounting-plan/accounting-plan.module';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { RbacModule } from '../rbac/rbac.module';
import { InventoryItemsController } from './controllers/inventory-items.controller';
import { InventoryMovementsController } from './controllers/inventory-movements.controller';
import { InventoryItemEntity } from './entities/inventory-item.entity';
import { InventoryLotEntity } from './entities/inventory-lot.entity';
import { InventoryMovementEntity } from './entities/inventory-movement.entity';
import { InventoryItemRepository } from './repositories/inventory-item.repository';
import { InventoryLotsRepository } from './repositories/inventory-lot.repository';
import { InventoryMovementRepository } from './repositories/inventory-movement.repository';
import { InventoryItemsService } from './services/inventory-items.service';
import { InventoryMovementsService } from './services/inventory-movements.service';

/**
 * InventoryModule — Module 17 Inventaire & Stock (wave 1).
 *
 * Registre articles + journal append-only des mouvements + valorisation
 * Coût Moyen Pondéré (CMP) SYSCOHADA. Exporte les deux services pour
 * que d'autres modules (Module 8 EntriesService en wave 2, Reports en
 * wave 2) puissent lire l'état du stock sans contourner le tenant scope.
 *
 * AccountingPlanModule importé pour `OrganizationAccountRepository` —
 * `InventoryItemsService` valide que les 3 comptes (31x/60x/70x)
 * appartiennent bien au tenant avant de créer un article. Évite la fuite
 * cross-tenant qu'on a déjà corrigée en Module 12 (cf.
 * `AssetsService.resolveAccountCode`).
 *
 * Pour activer le module quand `feat/module-17-inventory` mergera :
 *   - import { InventoryModule } from './modules/inventory/inventory.module';
 *   - imports: [..., InventoryModule]
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([InventoryItemEntity, InventoryMovementEntity, InventoryLotEntity]),
    AuthModule,
    RbacModule,
    // TenantGuard (consommé par les controllers via @UseGuards) dépend
    // d'AuthEventsService, exporté par AuditModule. Sans cet import, le
    // boot Nest crash avec "Nest can't resolve dependencies of the
    // TenantGuard ... AuthEventsService at index [3] is available in
    // the InventoryModule context" (cf. mémoire
    // `nest-useguards-requires-module-imports` — bug récurrent, déjà
    // corrigé sur MultiCurrencyModule, c'est ce qui a tenu prod down
    // toute la journée depuis le wiring d'InventoryModule).
    AuditModule,
    AccountingPlanModule,
  ],
  controllers: [InventoryItemsController, InventoryMovementsController],
  providers: [
    InventoryItemRepository,
    InventoryMovementRepository,
    InventoryLotsRepository,
    InventoryItemsService,
    InventoryMovementsService,
  ],
  // W2.4.c — `InventoryItemRepository` est ré-exporté pour que
  // `ReportsModule` puisse l'injecter dans l'adapter `NoteInventoryDeps`
  // (Notes annexes N6 — Stocks et en-cours).
  exports: [InventoryItemsService, InventoryMovementsService, InventoryItemRepository],
})
export class InventoryModule {}
