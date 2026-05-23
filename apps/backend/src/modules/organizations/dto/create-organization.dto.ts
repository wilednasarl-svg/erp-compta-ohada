import { IsIn, IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

import type { OrganizationType } from '../entities/organization.entity';

/**
 * `POST /organizations` body. `type` discriminates accounting firms
 * (`firm`) from standalone companies (`company`) — same set as the DB
 * `ck_organizations_type` CHECK constraint.
 *
 * `slug` is intentionally NOT a request field: it is derived from `name`
 * (see `slugify` + `OrganizationsService.deriveAvailableSlug`) so the
 * frontend never has to second-guess what the canonical slug should be.
 */
const ORGANIZATION_TYPES: ReadonlyArray<OrganizationType> = ['firm', 'company'];

export class CreateOrganizationDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsIn([...ORGANIZATION_TYPES], {
    message: `type must be one of: ${ORGANIZATION_TYPES.join(', ')}`,
  })
  type!: OrganizationType;
}
