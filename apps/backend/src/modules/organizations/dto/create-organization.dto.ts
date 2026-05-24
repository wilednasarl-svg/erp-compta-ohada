import { IsIn, IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

import {
  ACCOUNTING_SYSTEMS,
  type AccountingSystem,
} from '../../accounting-plan/types/accounting-system';
import type { OrganizationType } from '../entities/organization.entity';

/**
 * `POST /organizations` body.
 *
 * `type` discriminates accounting firms (`firm`) from standalone
 * companies (`company`) — same set as the DB `ck_organizations_type`
 * CHECK constraint.
 *
 * `slug` is intentionally NOT a request field: it is derived from `name`
 * (see `slugify` + `OrganizationsService.deriveAvailableSlug`) so the
 * frontend never has to second-guess what the canonical slug should be.
 *
 * `system` (Module 2 integration) — OHADA accounting system. Required
 * because the choice is *immutable* after creation (cf. design D2 of
 * Module 2): a missing value here would force a downstream migration to
 * pick one. Custom error code `ACCOUNTING_SYSTEM_REQUIRED` is mapped by
 * the global filter to the value sent by `IsIn` here.
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

  @IsIn([...ACCOUNTING_SYSTEMS], {
    message: `system must be one of: ${ACCOUNTING_SYSTEMS.join(', ')}`,
  })
  system!: AccountingSystem;
}
