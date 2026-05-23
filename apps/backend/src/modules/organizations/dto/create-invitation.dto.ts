import { IsEmail, IsIn, IsNotEmpty, IsString, MaxLength } from 'class-validator';

/**
 * `POST /organizations/:id/invitations` body. The admin specifies the
 * invitee's email and the role they'll have on acceptance.
 *
 * `roleCode` is matched against `roles.code` (seed) — the service-layer
 * lookup throws `INVITATION_NOT_FOUND` (semantically wrong but the only
 * "doesn't exist" code we have here) on unknown codes; the DTO allow-list
 * makes the typical happy path fail at validation time with a clean 422.
 */
const ROLE_CODES: ReadonlyArray<string> = [
  'admin',
  'expert_comptable',
  'chef_mission',
  'comptable',
  'auditeur',
  'client_readonly',
];

export class CreateInvitationDto {
  @IsEmail({}, { message: 'email must be a valid email address' })
  @IsNotEmpty()
  @MaxLength(254)
  email!: string;

  @IsString()
  @IsIn([...ROLE_CODES], { message: `roleCode must be one of: ${ROLE_CODES.join(', ')}` })
  roleCode!: string;
}
