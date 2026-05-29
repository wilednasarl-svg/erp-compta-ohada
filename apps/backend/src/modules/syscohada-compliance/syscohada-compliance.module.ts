import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { RbacModule } from '../rbac/rbac.module';
import { ReportsModule } from '../reports/reports.module';
import { SyscohadaComplianceController } from './controllers/syscohada-compliance.controller';
import { SyscohadaComplianceService } from './services/syscohada-compliance.service';

/**
 * `SyscohadaComplianceModule` — monte l'endpoint
 * `organizations/:id/syscohada-compliance` qui exécute les contrôles SYSCOHADA
 * bloquants sur les données comptables réelles d'une organisation.
 *
 * Composition :
 *   - `ReportsModule` est importé pour réutiliser `ReportsService` (bilan) —
 *     zéro duplication du moteur de reporting.
 *   - `SyscohadaKnowledgeService` est `@Global`, donc injectable sans import :
 *     il fournit le catalogue de contrôles + l'extrait verbatim du Guide.
 *   - `DataSource` (TypeORM) est globalement disponible (forRoot) pour la
 *     requête d'équilibre en partie double.
 *   - `AuthModule + RbacModule` sont importés pour que le contrôleur puisse
 *     utiliser `JwtAuthGuard / TenantGuard / PermissionsGuard`
 *     (cf. memory `nest-useguards-requires-module-imports`).
 */
@Module({
  imports: [AuthModule, RbacModule, ReportsModule],
  controllers: [SyscohadaComplianceController],
  providers: [SyscohadaComplianceService],
  exports: [SyscohadaComplianceService],
})
export class SyscohadaComplianceModule {}
