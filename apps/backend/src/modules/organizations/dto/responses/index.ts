import { ApiProperty } from '@nestjs/swagger';

import type { OrganizationType } from '../../entities/organization.entity';
import type { MembershipStatus } from '../../../rbac/entities/membership.entity';

const ORGANIZATION_TYPES: ReadonlyArray<OrganizationType> = ['firm', 'company'];
const MEMBERSHIP_STATUSES: ReadonlyArray<MembershipStatus> = ['active', 'suspended'];

/**
 * Contrats Response du module organizations. Forme JSON strictement
 * préservée par rapport à la sérialisation TypeORM pré-DTO.
 * Pattern de référence : tva/dto/responses/.
 */

export class OrganizationResponse {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  slug!: string;

  @ApiProperty({ enum: ORGANIZATION_TYPES })
  type!: OrganizationType;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;

  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  deletedAt!: Date | null;
}

export class OrganizationSummaryResponse {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  slug!: string;

  @ApiProperty()
  role!: string;
}

export class MembershipResponse {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  userId!: string;

  @ApiProperty({ format: 'uuid' })
  organizationId!: string;

  @ApiProperty({ format: 'uuid' })
  roleId!: string;

  @ApiProperty({ enum: MEMBERSHIP_STATUSES })
  status!: MembershipStatus;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;
}

export class ListOrganizationsResponse {
  @ApiProperty({ type: () => [OrganizationSummaryResponse] })
  organizations!: OrganizationSummaryResponse[];
}

export class OrganizationEnvelopeResponse {
  @ApiProperty({ type: () => OrganizationResponse })
  organization!: OrganizationResponse;
}

export class CreateOrganizationResponse {
  @ApiProperty({ type: () => OrganizationResponse })
  organization!: OrganizationResponse;

  @ApiProperty({ type: () => MembershipResponse })
  membership!: MembershipResponse;

  @ApiProperty()
  system!: string;
}
