import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { CLOCK, SystemClock } from '../../common/time/clock';
import { AuditModule } from '../audit/audit.module';
import { MfaConfigEntity } from './entities/mfa-config.entity';
import { RefreshTokenEntity } from './entities/refresh-token.entity';
import { UserEntity } from './entities/user.entity';
import { MfaConfigRepository } from './repositories/mfa-config.repository';
import { RefreshTokenRepository } from './repositories/refresh-token.repository';
import { UserRepository } from './repositories/user.repository';
import { EncryptionService } from './services/encryption.service';
import { JwtTokenService } from './services/jwt-token.service';
import { PasswordService } from './services/password.service';
import { RefreshTokenService } from './services/refresh-token.service';

/**
 * `AuthModule` — owns the `users`, `refresh_tokens`, and `mfa_configs`
 * tables and the crypto/token services that operate on them. Controllers
 * (signup/login/refresh/mfa) land in subsequent micro-tasks (BE-AUTH-*).
 *
 * Services wired so far:
 *   - `PasswordService`     (BE-CRYPTO-01) — argon2id.
 *   - `EncryptionService`   (BE-CRYPTO-02) — AES-256-GCM for MFA secrets.
 *   - `JwtTokenService`     (BE-CRYPTO-03) — HS256 access + mfa_challenge.
 *   - `RefreshTokenService` (BE-CRYPTO-04) — rotation + reuse detection.
 *
 * `RefreshTokenService` consumes `AuthEventRepository` (audit journal),
 * hence the explicit `AuditModule` import. The `CLOCK` provider is
 * registered here (`SystemClock` in production) so both crypto services
 * can inject a deterministic clock in tests by overriding this provider.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([UserEntity, RefreshTokenEntity, MfaConfigEntity]),
    AuditModule,
  ],
  providers: [
    { provide: CLOCK, useClass: SystemClock },
    UserRepository,
    RefreshTokenRepository,
    MfaConfigRepository,
    PasswordService,
    EncryptionService,
    JwtTokenService,
    RefreshTokenService,
  ],
  exports: [
    UserRepository,
    RefreshTokenRepository,
    MfaConfigRepository,
    PasswordService,
    EncryptionService,
    JwtTokenService,
    RefreshTokenService,
    TypeOrmModule,
  ],
})
export class AuthModule {}
