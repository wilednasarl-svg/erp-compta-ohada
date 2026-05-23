import { IsIn, IsString } from 'class-validator';

/**
 * `PATCH /organizations/:id/members/:userId` body. `roleCode` is matched
 * against `roles.code` (the catalog seeded by migration 0003). The
 * allow-list is duplicated here from `SystemRoleCode` to keep the wire
 * contract self-contained — a frontend never needs to import a backend
 * type to know which strings are valid.
 *
 * The `MembershipsService.changeRole` step is the authoritative gate:
 * even if a future role is added to the catalog without updating this
 * list, the service will still reject unknown codes with 404 / 422.
 */
const ROLE_CODES: ReadonlyArray<string> = [
  'admin',
  'expert_comptable',
  'chef_mission',
  'comptable',
  'auditeur',
  'client_readonly',
];

export class ChangeMemberRoleDto {
  @IsString()
  @IsIn([...ROLE_CODES], { message: `roleCode must be one of: ${ROLE_CODES.join(', ')}` })
  roleCode!: string;
}
