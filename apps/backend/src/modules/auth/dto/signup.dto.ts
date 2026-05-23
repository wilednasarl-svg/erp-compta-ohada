import { IsEmail, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * `POST /auth/signup` body. Business validation (password ≥ 12 chars) lives
 * in `AuthService.signup` so the response carries the spec-mandated
 * `AUTH_WEAK_PASSWORD` code (422) instead of the generic `VALIDATION_ERROR`
 * that the global pipe emits for purely structural issues.
 */
export class SignupDto {
  @IsEmail({}, { message: 'email must be a valid email address' })
  @IsNotEmpty()
  @MaxLength(254)
  email!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  password!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  lastName?: string;
}
