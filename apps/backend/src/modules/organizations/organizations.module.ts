import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { InvitationEntity } from './entities/invitation.entity';
import { OrganizationEntity } from './entities/organization.entity';
import { InvitationRepository } from './repositories/invitation.repository';
import { OrganizationRepository } from './repositories/organization.repository';

/**
 * `OrganizationsModule` — owns the `organizations` tenant root and the
 * `invitations` lifecycle. Re-exports repositories so downstream modules
 * (`AuthModule`, `RbacModule`) can inject them without re-registering the
 * entities with `TypeOrmModule.forFeature`.
 */
@Module({
  imports: [TypeOrmModule.forFeature([OrganizationEntity, InvitationEntity])],
  providers: [OrganizationRepository, InvitationRepository],
  exports: [OrganizationRepository, InvitationRepository, TypeOrmModule],
})
export class OrganizationsModule {}
