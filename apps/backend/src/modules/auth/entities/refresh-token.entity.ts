import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { UserEntity } from './user.entity';
import { OrganizationEntity } from '../../organizations/entities/organization.entity';

/**
 * `refresh_tokens` row (BE-DB-08) — opaque refresh token (256-bit random,
 * SHA-256-hashed in `tokenHash`) supporting rotation + reuse detection
 * (see `specs/auth/spec.md`).
 *
 * Mirrors `database/migrations/0008_create_refresh_tokens.ts`. All tokens
 * issued by a single login share a `familyId`; if a `used_at IS NOT NULL`
 * token is replayed, the service revokes the whole family and emits
 * `auth.refresh_token_reuse_detected`.
 *
 * `organizationId` is nullable because a freshly-logged-in user has not yet
 * called `POST /auth/select-organization`. When non-null, all reads from
 * `RefreshTokenRepository` MUST scope by `userId` (and by `organizationId`
 * for tenant-scoped revocations).
 */
@Entity({ name: 'refresh_tokens' })
export class RefreshTokenEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('ix_refresh_tokens_user_id')
  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId!: string | null;

  @Index('uq_refresh_tokens_token_hash', { unique: true })
  @Column({ name: 'token_hash', type: 'text' })
  tokenHash!: string;

  @Index('ix_refresh_tokens_family_id')
  @Column({ name: 'family_id', type: 'uuid' })
  familyId!: string;

  @Column({ name: 'used_at', type: 'timestamptz', nullable: true })
  usedAt!: Date | null;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @ManyToOne(() => UserEntity, (user) => user.refreshTokens, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user?: UserEntity;

  @ManyToOne(() => OrganizationEntity, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'organization_id' })
  organization?: OrganizationEntity | null;
}
