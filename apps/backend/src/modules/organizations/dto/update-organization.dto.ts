import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * `PATCH /organizations/:id` body. Only `name` is mutable.
 *
 * The spec scenario "Slug change is rejected" mandates that any `slug` in
 * the request is ignored AND that a request whose ONLY field is `slug`
 * responds 422. ValidationPipe enforces the latter implicitly: with
 * `whitelist: true` + `forbidNonWhitelisted: true` already wired
 * globally in `main.ts` (BE-BOOT-01), an unknown property triggers a
 * 422 `VALIDATION_ERROR`. The "empty body" 422 is enforced in
 * `OrganizationsService.update`.
 */
export class UpdateOrganizationDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;
}
