import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { JournalsModule } from '../journals/journals.module';
import { JournalEntryLineEntity } from '../journals/entities/journal-entry-line.entity';
import { JournalEntryEntity } from '../journals/entities/journal-entry.entity';
import { JournalEntryLineRepository } from '../journals/repositories/journal-entry-line.repository';
import { JournalEntryRepository } from '../journals/repositories/journal-entry.repository';
import { RbacModule } from '../rbac/rbac.module';
import { WorkflowsModule } from '../workflows/workflows.module';
import { JournalSignaturesController } from './controllers/journal-signatures.controller';
import { EntrySignatureEntity } from './entities/entry-signature.entity';
import { EntrySignatureRepository } from './repositories/entry-signature.repository';
import { JournalSignatureService } from './services/journal-signature.service';

/**
 * `JournalSignaturesModule` — Module 14 wave 1.
 *
 * Câble :
 *   - L'entité `EntrySignatureEntity` + repo tenant-scopé.
 *   - `JournalSignatureService` (orchestrateur workflow + signatures).
 *   - `JournalSignaturesController` (5 endpoints REST).
 *
 * Importe :
 *   - `AuthModule` + `RbacModule` pour `JwtAuthGuard` / `TenantGuard` /
 *     `PermissionsGuard` (cf. memoire `nest-useguards-requires-module-imports`).
 *   - `AuditModule` pour `AuditTrailService`.
 *   - `JournalsModule` pour `EntriesService` (validation de l'entry à
 *     la signature finale).
 *   - `WorkflowsModule` pour `WorkflowService` (moteur d'états Module 6).
 *
 * Enregistre `JournalEntryEntity` + `JournalEntryLineEntity` localement
 * pour que les repositories injectés (`JournalEntryRepository`,
 * `JournalEntryLineRepository`) trouvent leurs `Repository<T>` dans le
 * scope DI de ce module — ces repositories sont consommés en lecture
 * seule pour le calcul du hash de signature.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([EntrySignatureEntity, JournalEntryEntity, JournalEntryLineEntity]),
    AuthModule,
    RbacModule,
    AuditModule,
    JournalsModule,
    WorkflowsModule,
  ],
  controllers: [JournalSignaturesController],
  providers: [
    EntrySignatureRepository,
    JournalEntryRepository,
    JournalEntryLineRepository,
    JournalSignatureService,
  ],
  exports: [JournalSignatureService],
})
export class JournalSignaturesModule {}
