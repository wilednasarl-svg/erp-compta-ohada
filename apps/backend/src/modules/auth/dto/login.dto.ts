import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';

/**
 * `POST /auth/login` body. Credential failure (bad email or bad password)
 * is reported as a single generic `AUTH_INVALID_CREDENTIALS` from the
 * service layer — the DTO only enforces presence and format.
 */
export class LoginDto {
  @IsEmail({}, { message: 'email must be a valid email address' })
  @IsNotEmpty()
  @MaxLength(254)
  email!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  password!: string;
}
