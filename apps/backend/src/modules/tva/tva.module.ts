import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module';
import { RbacModule } from '../rbac/rbac.module';
import { AuditModule } from '../audit/audit.module';
import { JournalEntryLineEntity } from '../journals/entities/journal-entry-line.entity';
import { TvaCodeEntity } from './entities/tva-code.entity';
import { TvaDeclarationEntity } from './entities/tva-declaration.entity';
import { TvaDeclarationLineEntity } from './entities/tva-declaration-line.entity';
import { TvaCodeRepository } from './repositories/tva-code.repository';
import { TvaDeclarationRepository } from './repositories/tva-declaration.repository';
import { TvaAggregationRepository } from './repositories/tva-aggregation.repository';
import { TvaCodesService } from './services/tva-codes.service';
import { TvaDeclarationsService } from './services/tva-declarations.service';
import { TvaCodesController } from './controllers/tva-codes.controller';
import { TvaDeclarationsController } from './controllers/tva-declarations.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      TvaCodeEntity,
      TvaDeclarationEntity,
      TvaDeclarationLineEntity,
      JournalEntryLineEntity,
    ]),
    AuthModule,
    RbacModule,
    AuditModule,
  ],
  controllers: [TvaCodesController, TvaDeclarationsController],
  providers: [
    TvaCodeRepository,
    TvaDeclarationRepository,
    TvaAggregationRepository,
    TvaCodesService,
    TvaDeclarationsService,
  ],
  exports: [TvaCodesService, TvaDeclarationsService],
})
export class TvaModule {}
