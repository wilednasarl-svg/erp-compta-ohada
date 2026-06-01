import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module';
import { RbacModule } from '../rbac/rbac.module';
import { JournalEntryLineEntity } from '../journals/entities/journal-entry-line.entity';
import { OpenReceivablesRepository } from './repositories/open-receivables.repository';
import { CollectionsService } from './services/collections.service';
import { CollectionsController } from './controllers/collections.controller';

/**
 * Module Recouvrement (collections) — relances clients & export des créances.
 *
 * Net-new et isolé : lecture seule sur les écritures (sous-classe 41 ouverte),
 * aucune écriture comptable, aucune migration. Le suivi persistant des
 * relances (historique, niveau atteint) est une itération ultérieure.
 */
@Module({
  imports: [TypeOrmModule.forFeature([JournalEntryLineEntity]), AuthModule, RbacModule],
  controllers: [CollectionsController],
  providers: [OpenReceivablesRepository, CollectionsService],
  exports: [CollectionsService],
})
export class CollectionsModule {}
