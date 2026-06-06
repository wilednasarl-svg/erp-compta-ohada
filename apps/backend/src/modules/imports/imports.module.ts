import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AccountingPlanModule } from '../accounting-plan/accounting-plan.module';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { FiscalModule } from '../fiscal/fiscal.module';
import { JournalsModule } from '../journals/journals.module';
import { RbacModule } from '../rbac/rbac.module';
import { ReportsModule } from '../reports/reports.module';
import { SyscohadaComplianceModule } from '../syscohada-compliance/syscohada-compliance.module';
import { ImportsController } from './controllers/imports.controller';
import { ImportFileEntity } from './entities/import-file.entity';
import { ImportSessionEntity } from './entities/import-session.entity';
import { ImportStagingEntryEntity } from './entities/import-staging-entry.entity';
import { CsvFileParser } from './parsers/csv-file.parser';
import { Mt940FileParser } from './parsers/mt940-file.parser';
import { OfxFileParser } from './parsers/ofx-file.parser';
import { PdfFileParser } from './parsers/pdf-file.parser';
import { SageFileParser } from './parsers/sage-file.parser';
import { XlsxFileParser } from './parsers/xlsx-file.parser';
import { ImportFileRepository } from './repositories/import-file.repository';
import { ImportSessionRepository } from './repositories/import-session.repository';
import { ImportStagingEntryRepository } from './repositories/import-staging-entry.repository';
import {
  FILE_PARSERS,
  FileParserService,
  buildDefaultParsers,
} from './services/file-parser.service';
import { ImportAnalyticsService } from './services/import-analytics.service';
import { ImportSessionService } from './services/import-session.service';
import { MappingService } from './services/mapping.service';
import { PostImportService } from './services/post-import.service';
import { ValidationService } from './services/validation.service';

/**
 * `ImportsModule` (BE-IMP-module) — wave 1 du Module 3.
 *
 * Compose les briques :
 *   - entités + repos sur les trois tables `import_*`,
 *   - parsers (CSV / XLSX / Sage) regroupés dans `FileParserService`
 *     via le token `FILE_PARSERS`,
 *   - services métier (`MappingService`, `ValidationService`,
 *     `ImportSessionService`),
 *   - controller HTTP `ImportsController`.
 *
 * Imports externes :
 *   - `AuditModule` pour `AuditTrailService` (audit append-only),
 *   - `AccountingPlanModule` pour `OrganizationAccountRepository` —
 *     la validation a besoin du plan comptable de l'org.
 *
 * Le `TypeOrmModule.forFeature` n'est PAS ré-exporté : aucun module
 * en aval ne doit accéder directement aux entités d'import — il
 * passera par `ImportSessionService` quand le commit final arrivera
 * (Module 3 vague 2).
 */
@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([ImportSessionEntity, ImportFileEntity, ImportStagingEntryEntity]),
    // AuthModule (JwtAuthGuard) + RbacModule (TenantGuard,
    // PermissionsGuard) sont consommés par ImportsController via
    // @UseGuards. Sans ces imports, Nest crash au boot —
    // unresolved JwtTokenService dans le contexte ImportsModule.
    // Même pattern qu'OrganizationsModule / DocumentsModule.
    AuthModule,
    RbacModule,
    AuditModule,
    AccountingPlanModule,
    JournalsModule,
    ReportsModule,
    SyscohadaComplianceModule,
    FiscalModule,
  ],
  controllers: [ImportsController],
  providers: [
    ImportSessionRepository,
    ImportFileRepository,
    ImportStagingEntryRepository,
    CsvFileParser,
    XlsxFileParser,
    SageFileParser,
    PdfFileParser,
    OfxFileParser,
    Mt940FileParser,
    {
      provide: FILE_PARSERS,
      useFactory: (
        csv: CsvFileParser,
        xlsx: XlsxFileParser,
        sage: SageFileParser,
        pdf: PdfFileParser,
        ofx: OfxFileParser,
        mt940: Mt940FileParser,
      ) => buildDefaultParsers({ csv, xlsx, sage, pdf, ofx, mt940 }),
      inject: [
        CsvFileParser,
        XlsxFileParser,
        SageFileParser,
        PdfFileParser,
        OfxFileParser,
        Mt940FileParser,
      ],
    },
    FileParserService,
    MappingService,
    ValidationService,
    ImportSessionService,
    ImportAnalyticsService,
    PostImportService,
  ],
  exports: [ImportSessionService, MappingService, ValidationService, ImportAnalyticsService, PostImportService],
})
export class ImportsModule {}
