import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * `PATCH /organizations/:id/chart-of-accounts/:accountId` body. Only
 * `label` and `isActive` are mutable post-creation.
 *
 * `code` is intentionally NOT declared here — `ValidationPipe`'s
 * `whitelist + forbidNonWhitelisted` strips it, but the service ALSO
 * surfaces `CHART_ACCOUNT_IMMUTABLE_CODE` (422) if a caller sneaks it
 * past validation (e.g., via `whitelist: false` in a test harness or
 * `transformOptions` quirk). Defence in depth.
 *
 * Both fields are optional but at least one must be provided for the
 * request to do anything (a fully empty PATCH is a silent no-op, mapped
 * to `200` with the unchanged view — no audit noise).
 */
export class UpdateAccountDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  label?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
