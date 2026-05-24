import { IsNotEmpty, IsString, Matches, MaxLength, MinLength } from 'class-validator';

/**
 * `POST /organizations/:id/chart-of-accounts` body. Adds a custom
 * sub-account under an existing active parent.
 *
 * The full invariant set (parent-prefix match, parent active, uniqueness
 * within the org, parent promotion to TITLE) is enforced by
 * `ChartOfAccountsService.createCustomAccount` — the DTO only catches
 * the cheap syntactic ones (digit-only code, length bounds, non-empty
 * label) so a malformed payload fails with a clean `422 VALIDATION_ERROR`
 * before the service is even invoked.
 */
export class CreateAccountDto {
  /**
   * Code of the existing account under which the new sub-account is
   * created. MUST already exist in the org's chart (validated by the
   * service); typed as a string here, not a code-regex match, because
   * the lookup itself will return the structured error.
   */
  @IsString()
  @IsNotEmpty()
  @MaxLength(10)
  parentCode!: string;

  /**
   * New account code. Digit-only, 2–10 chars. The service additionally
   * enforces that it must start with `parentCode` and be strictly
   * longer (`CHART_ACCOUNT_INVALID_PARENT`) and be unique in the org
   * (`CHART_ACCOUNT_CODE_TAKEN`).
   */
  @IsString()
  @Matches(/^\d{2,10}$/, { message: 'code must be 2 to 10 digits' })
  code!: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(200)
  label!: string;
}
