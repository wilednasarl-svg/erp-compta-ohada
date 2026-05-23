import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { MfaConfigEntity } from './entities/mfa-config.entity';
import { RefreshTokenEntity } from './entities/refresh-token.entity';
import { UserEntity } from './entities/user.entity';
import { MfaConfigRepository } from './repositories/mfa-config.repository';
import { RefreshTokenRepository } from './repositories/refresh-token.repository';
import { UserRepository } from './repositories/user.repository';

/**
 * `AuthModule` — owns the `users`, `refresh_tokens`, and `mfa_configs`
 * tables. Controllers, services (PasswordService, JwtTokenService,
 * RefreshTokenService, AuthEventsService client, etc.) land in
 * subsequent micro-tasks (BE-CRYPTO-*, BE-AUTH-*).
 */
@Module({
  imports: [TypeOrmModule.forFeature([UserEntity, RefreshTokenEntity, MfaConfigEntity])],
  providers: [UserRepository, RefreshTokenRepository, MfaConfigRepository],
  exports: [UserRepository, RefreshTokenRepository, MfaConfigRepository, TypeOrmModule],
})
export class AuthModule {}
