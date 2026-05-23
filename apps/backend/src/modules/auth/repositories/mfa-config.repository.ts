import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { MfaConfigEntity } from '../entities/mfa-config.entity';

/**
 * `MfaConfigRepository` (BE-DB-11) — data access for `mfa_configs`.
 *
 * `mfa_configs` is keyed by `user_id` (UNIQUE) and carries no
 * `organization_id` — MFA is a property of the global user identity, not
 * of a per-tenant role. The repository therefore exposes per-user
 * accessors only.
 *
 * Backup codes and the encrypted secret are stored as-is; encryption /
 * decryption lives in `EncryptionService` (BE-CRYPTO-02) and hashing of
 * backup codes lives in `PasswordService` (BE-CRYPTO-01). This repository
 * never touches plaintext secrets.
 */
@Injectable()
export class MfaConfigRepository {
  constructor(
    @InjectRepository(MfaConfigEntity)
    private readonly repo: Repository<MfaConfigEntity>,
  ) {}

  async findByUserId(userId: string): Promise<MfaConfigEntity | null> {
    return this.repo.findOne({ where: { userId } });
  }

  async upsertSecret(input: { userId: string; secretEncrypted: Buffer }): Promise<MfaConfigEntity> {
    const existing = await this.findByUserId(input.userId);
    if (existing !== null) {
      existing.secretEncrypted = input.secretEncrypted;
      existing.enabled = false;
      existing.activatedAt = null;
      existing.backupCodesHashed = [];
      return this.repo.save(existing);
    }
    const entity = this.repo.create({
      userId: input.userId,
      secretEncrypted: input.secretEncrypted,
      enabled: false,
      activatedAt: null,
      backupCodesHashed: [],
    });
    return this.repo.save(entity);
  }

  async activate(userId: string, backupCodesHashed: string[], activatedAt: Date): Promise<void> {
    await this.repo.update({ userId }, { enabled: true, activatedAt, backupCodesHashed });
  }

  async disable(userId: string): Promise<void> {
    await this.repo.update(
      { userId },
      { enabled: false, activatedAt: null, backupCodesHashed: [] },
    );
  }

  async consumeBackupCode(userId: string, remaining: string[]): Promise<void> {
    await this.repo.update({ userId }, { backupCodesHashed: remaining });
  }
}
