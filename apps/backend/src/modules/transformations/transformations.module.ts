import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { RbacModule } from '../rbac/rbac.module';
import { ImportStagingEntryEntity } from '../imports/entities/import-staging-entry.entity';
import { TransformationsController } from './controllers/transformations.controller';
import { EntryTransformationEntity } from './entities/entry-transformation.entity';
import { EntryTransformationRepository } from './repositories/entry-transformation.repository';
import { TransformationService } from './services/transformation.service';

/**
 * `TransformationsModule` — Module 4 Transformation Engine (wave 1).
 *
 * Compose :
 *   - entité `EntryTransformationEntity` + repo `EntryTransformationRepository`,
 *   - `ImportStagingEntryEntity` (read-only, pour vérification tenant + résolution),
 *   - service `TransformationService` (reclassify, adjust, history),
 *   - controller `TransformationsController` (3 endpoints REST).
 *
 * Imports externes :
 *   - `AuditModule` pour `AuditTrailService`,
 *   - `AuthModule` / `RbacModule` pour les guards (@UseGuards sur le controller),
 *   - `ImportsModule` — NON importé en tant que module (évite la dépendance
 *     circulaire sur les parsers/services d'import) : on monte directement
 *     l'entité `ImportStagingEntryEntity` via `TypeOrmModule.forFeature`.
 *
 * `TransformationService` est exporté pour permettre aux modules futurs
 * (ex. Module 5 Balance, Module 6 États financiers) de lire l'état effectif
 * d'une écriture (source + transformations) sans passer par HTTP.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([EntryTransformationEntity, ImportStagingEntryEntity]),
    AuthModule,
    RbacModule,
    AuditModule,
  ],
  controllers: [TransformationsController],
  providers: [EntryTransformationRepository, TransformationService],
  exports: [TransformationService],
})
export class TransformationsModule {}
