import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  OneToMany,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { MfaConfigEntity } from './mfa-config.entity';
import { RefreshTokenEntity } from './refresh-token.entity';
import { AuthEventEntity } from '../../audit/entities/auth-event.entity';
import { MembershipEntity } from '../../rbac/entities/membership.entity';

/**
 * `users` row (BE-DB-02) — authentication identity, global to the platform
 * (no `organization_id`: a single human can belong to several organizations
 * through `memberships`).
 *
 * Mirrors `database/migrations/0002_create_users.ts`. `email` uses the
 * PostgreSQL `citext` extension so that case variants collide on the UNIQUE
 * constraint without the application normalizing casing. `passwordHash`
 * stores the argon2id digest produced by `PasswordService` (BE-CRYPTO-01);
 * the plaintext never persists. `deletedAt` enables soft-delete.
 */
@Entity({ name: 'users' })
export class UserEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('uq_users_email', { unique: true })
  @Column({ type: 'citext' })
  email!: string;

  @Column({ name: 'password_hash', type: 'text' })
  passwordHash!: string;

  @Column({ name: 'first_name', type: 'text', nullable: true })
  firstName!: string | null;

  @Column({ name: 'last_name', type: 'text', nullable: true })
  lastName!: string | null;

  @Column({ type: 'text', default: 'fr-FR' })
  locale!: string;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @Index('ix_users_deleted_at')
  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;

  @OneToMany(() => MembershipEntity, (membership) => membership.user)
  memberships?: MembershipEntity[];

  @OneToMany(() => RefreshTokenEntity, (token) => token.user)
  refreshTokens?: RefreshTokenEntity[];

  @OneToOne(() => MfaConfigEntity, (mfa) => mfa.user)
  mfaConfig?: MfaConfigEntity | null;

  @OneToMany(() => AuthEventEntity, (event) => event.user)
  authEvents?: AuthEventEntity[];
}
