import { IsUUID } from 'class-validator';

/**
 * `POST /auth/select-organization` body — used after a successful
 * `POST /auth/login` (which returns the user's organizations list) to
 * upgrade the bare-bones access token into one scoped to the chosen org.
 *
 * The endpoint validates that the caller has an active membership for
 * the requested org and re-signs both the access + refresh tokens with
 * the `org_id` + `role` claims attached. From this point on, every
 * tenant-scoped route can rely on `TenantGuard` resolving the org
 * without round-trips.
 */
export class SelectOrganizationDto {
  @IsUUID('4', { message: 'organizationId must be a UUID v4' })
  organizationId!: string;
}
