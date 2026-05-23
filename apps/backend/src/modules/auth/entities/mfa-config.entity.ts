import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { UserEntity } from './user.entity';

/**
 * `mfa_configs` row (BE-DB-09) — per-user TOTP (RFC 6238) configuration plus
 * hashed backup codes.
 *
 * Mirrors `database/migrations/0009_create_mfa_configs.ts`. `secretEncrypted`
 * holds the AES-256-GCM ciphertext (`iv | tag | ciphertext`) produced by
 * `EncryptionService` (BE-CRYPTO-02); the plaintext secret never persists.
 * `backupCodesHashed` is a Postgres `TEXT[]` of argon2id hashes — each is
 * consumed single-use by the service.
 *
 * `enabled` flips from `false` to `true` only after the user submits a
 * valid 6-digit TOTP code via `POST /auth/mfa/verify`. UNIQUE(user_id) is
 * enforced at the DB layer.
 */
@Entity({ name: 'mfa_configs' })
export class MfaConfigEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('uq_mfa_configs_user_id', { unique: true })
  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ name: 'secret_encrypted', type: 'bytea' })
  secretEncrypted!: Buffer;

  @Column({ type: 'boolean', default: false })
  enabled!: boolean;

  @Column({ name: 'activated_at', type: 'timestamptz', nullable: true })
  activatedAt!: Date | null;

  @Column({
    name: 'backup_codes_hashed',
    type: 'text',
    array: true,
    default: () => "'{}'",
  })
  backupCodesHashed!: string[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @OneToOne(() => UserEntity, (user) => user.mfaConfig, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user?: UserEntity;
}
