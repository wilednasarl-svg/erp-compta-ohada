import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * `POST /auth/invitations/accept` body. Per `specs/organizations/spec.md`:
 *
 *   - Existing user → only `token` is required.
 *   - New user      → `token` + signup fields (`password`, `firstName`,
 *                     `lastName`). The service-layer
 *                     `InvitationsService.accept` enforces the "signup
 *                     fields required when the email is unknown" rule
 *                     and returns `AUTH_WEAK_PASSWORD` (422) if `password`
 *                     is missing or < 12 chars.
 *
 * The DTO marks the signup fields optional so the same endpoint serves
 * both paths; the service is the single point that validates the
 * combination is consistent with the resolved user state.
 */
export class AcceptInvitationDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  token!: string;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  password?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  lastName?: string;
}
