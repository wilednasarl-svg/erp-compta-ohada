import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/**
 * `POST /auth/refresh` and `POST /auth/logout` body — both consume the
 * opaque refresh token in the request body (never the URL, never a
 * header, so it doesn't end up in proxy logs).
 */
export class RefreshTokenDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  refreshToken!: string;
}
