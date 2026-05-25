import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AccountingPlanModule } from '../accounting-plan/accounting-plan.module';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { EmailModule } from '../email/email.module';
import { JournalsModule } from '../journals/journals.module';
import { MultiCurrencyModule } from '../multi-currency/multi-currency.module';
import { RbacModule } from '../rbac/rbac.module';
import { TvaModule } from '../tva/tva.module';
import { AcceptInvitationController } from './controllers/accept-invitation.controller';
import { AuthEventsController } from './controllers/auth-events.controller';
import { InvitationsController } from './controllers/invitations.controller';
import { MembersController } from './controllers/members.controller';
import { OrganizationsController } from './controllers/organizations.controller';
import { InvitationEntity } from './entities/invitation.entity';
import { OrganizationEntity } from './entities/organization.entity';
import { InvitationRepository } from './repositories/invitation.repository';
import { OrganizationRepository } from './repositories/organization.repository';
import { InvitationsService } from './services/invitations.service';
import { OrganizationsService } from './services/organizations.service';

/**
 * `OrganizationsModule` — owns the `organizations` tenant root and the
 * `invitations` lifecycle, plus the `OrganizationsService` orchestration
 * for BE-ORG-01..03.
 *
 *   - `AuthModule`  — pulled for `JwtAuthGuard` used by
 *                     `@UseGuards(JwtAuthGuard)` on the controller. No
 *                     cycle: AuthModule pulls `MembershipRepository`
 *                     directly from RbacModule rather than going through
 *                     OrganizationsService.
 *   - `RbacModule`  — pulled for `MembershipRepository`, `RoleRepository`,
 *                     `TenantGuard`, `RolesGuard`.
 *   - `AuditModule` — pulled for `AuthEventsService` (write the
 *                     `organizations.updated` event on create / rename).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([OrganizationEntity, InvitationEntity]),
    // AuthModule provides `JwtAuthGuard`, `JwtTokenService`,
    // `PasswordService`, `UserRepository` (used by `InvitationsService`).
    AuthModule,
    RbacModule,
    AuditModule,
    // `InvitationsService` ships the invitation email through `EmailService`.
    EmailModule,
    // `OrganizationsService.create` clones the SYSCOHADA reference plan
    // into the new org in a single transaction (BE-PC-08). Pulls
    // `ChartOfAccountsService` + `OrganizationAccountingConfigRepository`
    // exported by AccountingPlanModule.
    AccountingPlanModule,
    // Module 8 — pour `JournalsService.seedStandardJournals` appelé
    // dans la transaction de création d'org.
    JournalsModule,
    // Module 13 — pour `TvaCodesService.seedDefaultCodes` appelé
    // dans la transaction de création d'org.
    TvaModule,
    // Module 16 — pour `CurrenciesService.seedDefaults` appelé dans la
    // même transaction (devises ISO 4217 standards UEMOA).
    MultiCurrencyModule,
  ],
  controllers: [
    OrganizationsController,
    MembersController,
    InvitationsController,
    AcceptInvitationController,
    // Audit-read endpoint (BE-AUDIT-02). Hosted in OrganizationsModule
    // rather than AuditModule because the URL is `/organizations/:id/*`
    // and the guard chain already resolves cleanly here (AuthModule +
    // RbacModule + AuditModule all imported above).
    AuthEventsController,
  ],
  providers: [
    OrganizationRepository,
    InvitationRepository,
    OrganizationsService,
    InvitationsService,
  ],
  exports: [
    OrganizationRepository,
    InvitationRepository,
    OrganizationsService,
    InvitationsService,
    TypeOrmModule,
  ],
})
export class OrganizationsModule {}
