import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { RbacModule } from '../rbac/rbac.module';
import { MembersController } from './controllers/members.controller';
import { OrganizationsController } from './controllers/organizations.controller';
import { InvitationEntity } from './entities/invitation.entity';
import { OrganizationEntity } from './entities/organization.entity';
import { InvitationRepository } from './repositories/invitation.repository';
import { OrganizationRepository } from './repositories/organization.repository';
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
    // AuthModule provides `JwtAuthGuard` used by `@UseGuards(...)` on the
    // controllers. No cycle: AuthService.selectOrganization reaches the
    // org row through `MembershipRepository
    // .findActiveByUserAndOrganizationWithOrg` (RbacModule).
    AuthModule,
    RbacModule,
    AuditModule,
  ],
  controllers: [OrganizationsController, MembersController],
  providers: [OrganizationRepository, InvitationRepository, OrganizationsService],
  exports: [OrganizationRepository, InvitationRepository, OrganizationsService, TypeOrmModule],
})
export class OrganizationsModule {}
