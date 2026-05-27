import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { PledgedAssetEntity } from './entities/pledged-asset.entity';
import { PledgedAssetsRepository } from './repositories/pledged-assets.repository';
import { PledgedAssetsService } from './services/pledged-assets.service';

/**
 * `PledgedAssetsModule` — E1 Sûretés réelles données SYSCOHADA
 * (Tome 3 p. 35).
 *
 * Wave 1 (cette PR) :
 *   - `PledgedAssetEntity` (migration 0108, créée non appliquée)
 *   - `PledgedAssetsRepository` tenant-scope
 *   - `PledgedAssetsService` : create / update / release / cancel /
 *     findById / listByOrg / listActiveAsOf
 *
 * Le service est exporté pour être consommé par `ReportsModule` via
 * une factory (notes annexes N1 et N16Bbis).
 *
 * Pas de controller wave 1 — REST exposé en wave 2 (follow-up).
 * Pas de wiring dans AppModule wave 1 — follow-up E1.b.
 */
@Module({
  imports: [TypeOrmModule.forFeature([PledgedAssetEntity])],
  providers: [PledgedAssetsRepository, PledgedAssetsService],
  exports: [PledgedAssetsService],
})
export class PledgedAssetsModule {}
