import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { MfaConfigEntity } from './entities/mfa-config.entity';
import { RefreshTokenEntity } from './entities/refresh-token.entity';
import { UserEntity } from './entities/user.entity';
import { MfaConfigRepository } from './repositories/mfa-config.repository';
import { RefreshTokenRepository } from './repositories/refresh-token.repository';
import { UserRepository } from './repositories/user.repository';
import { EncryptionService } from './services/encryption.service';
import { PasswordService } from './services/password.service';

/**
 * `AuthModule` — owns the `users`, `refresh_tokens`, and `mfa_configs`
 * tables. Controllers and the remaining services (JwtTokenService,
 * RefreshTokenService, AuthEventsService client, etc.) land in subsequent
 * micro-tasks (BE-AUTH-*). `PasswordService` (BE-CRYPTO-01) and
 * `EncryptionService` (BE-CRYPTO-02) are already wired and exported here so
 * downstream services can depend on them.
 */
@Module({
  imports: [TypeOrmModule.forFeature([UserEntity, RefreshTokenEntity, MfaConfigEntity])],
  providers: [
    UserRepository,
    RefreshTokenRepository,
    MfaConfigRepository,
    PasswordService,
    EncryptionService,
  ],
  exports: [
    UserRepository,
    RefreshTokenRepository,
    MfaConfigRepository,
    PasswordService,
    EncryptionService,
    TypeOrmModule,
  ],
})
export class AuthModule {}
