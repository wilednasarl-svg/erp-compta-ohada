import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { TypeOrmModule } from '@nestjs/typeorm';

import type { AppConfig } from '../../config/configuration';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { RbacModule } from '../rbac/rbac.module';
import { DocumentsController } from './controllers/documents.controller';
import { DocumentEntryEntity } from './entities/document-entry.entity';
import { DocumentEntity } from './entities/document.entity';
import { DocumentEntryRepository } from './repositories/document-entry.repository';
import { DocumentRepository } from './repositories/document.repository';
import {
  DOCUMENT_STORAGE_ROOT,
  LocalFilesystemDocumentStorage,
} from './services/local-filesystem-document-storage.service';
import { DocumentOcrService } from './services/document-ocr.service';
import { DOCUMENT_STORAGE } from './services/document-storage.interface';
import { DocumentsService } from './services/documents.service';

/**
 * `DocumentsModule` (Module 10 — vague 1).
 *
 * Wires:
 *   - TypeORM repositories for `documents` + `document_entries`,
 *   - `DocumentsService` (orchestration),
 *   - `DocumentOcrService` (vague 1 stub),
 *   - the abstract `DOCUMENT_STORAGE` token bound to the local-FS
 *     driver (`LocalFilesystemDocumentStorage`). A future wave will
 *     swap the binding to an S3 / Supabase Storage driver — every
 *     other provider is driver-agnostic, so the change is local.
 *
 * `MulterModule.registerAsync` configures multer with the same byte
 * cap the service enforces. We keep the cap in two places: multer
 * fails-fast on oversize before buffering the whole body in memory;
 * the service is the source of truth and re-checks after the bytes
 * land.
 *
 * Imports `AuthModule` + `RbacModule` so `JwtAuthGuard`, `TenantGuard`
 * and `PermissionsGuard` resolve inside the `DocumentsController`
 * `@UseGuards` chain. Imports `AuditModule` so `AuditTrailService`
 * (BE-DOC-09 / Module 7 vague 1) is injectable into `DocumentsService`
 * for the upload / link / soft-delete journal entries.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([DocumentEntity, DocumentEntryEntity]),
    MulterModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const docConfig = config.get<AppConfig['documents']>('documents');
        if (docConfig === undefined) {
          throw new Error('AppConfig.documents missing — configuration() not loaded');
        }
        return {
          limits: { fileSize: docConfig.maxFileSizeBytes },
        };
      },
    }),
    AuthModule,
    RbacModule,
    AuditModule,
  ],
  controllers: [DocumentsController],
  providers: [
    DocumentRepository,
    DocumentEntryRepository,
    DocumentOcrService,
    DocumentsService,
    {
      provide: DOCUMENT_STORAGE_ROOT,
      inject: [ConfigService],
      useFactory: (config: ConfigService): string => {
        const docConfig = config.get<AppConfig['documents']>('documents');
        if (docConfig === undefined) {
          throw new Error('AppConfig.documents missing — configuration() not loaded');
        }
        return docConfig.storageDir;
      },
    },
    {
      provide: DOCUMENT_STORAGE,
      useClass: LocalFilesystemDocumentStorage,
    },
  ],
  exports: [DocumentsService, DocumentRepository, DocumentEntryRepository],
})
export class DocumentsModule {}
