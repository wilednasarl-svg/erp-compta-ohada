import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';

import { UserEntity } from '../entities/user.entity';

/**
 * `UserRepository` (BE-DB-11) — data access for `users`, the global
 * authentication identity.
 *
 * `users` is intentionally NOT tenant-scoped: a single human can belong to
 * several organizations through `memberships`. The multi-tenant invariant
 * therefore lives on the membership/invitation repositories instead, and
 * this repository legitimately exposes `findActiveByEmail(email)` and
 * `findActiveById(id)` without an `organizationId` parameter.
 *
 * Soft-deleted rows (`deletedAt IS NOT NULL`) are excluded from every
 * "find active" path so a re-signup never hits a tombstone.
 */
@Injectable()
export class UserRepository {
  constructor(
    @InjectRepository(UserEntity)
    private readonly repo: Repository<UserEntity>,
  ) {}

  async findActiveById(id: string): Promise<UserEntity | null> {
    return this.repo.findOne({ where: { id, deletedAt: IsNull() } });
  }

  async findActiveByEmail(email: string): Promise<UserEntity | null> {
    // `email` is `citext` in PostgreSQL, so the equality is already
    // case-insensitive at the DB layer.
    return this.repo.findOne({ where: { email, deletedAt: IsNull() } });
  }

  async emailExists(email: string): Promise<boolean> {
    return (await this.repo.count({ where: { email } })) > 0;
  }

  async create(input: {
    email: string;
    passwordHash: string;
    firstName?: string | null;
    lastName?: string | null;
    locale?: string;
  }): Promise<UserEntity> {
    const entity = this.repo.create({
      email: input.email,
      passwordHash: input.passwordHash,
      firstName: input.firstName ?? null,
      lastName: input.lastName ?? null,
      locale: input.locale ?? 'fr-FR',
      isActive: true,
    });
    return this.repo.save(entity);
  }

  async updatePasswordHash(id: string, passwordHash: string): Promise<void> {
    await this.repo.update({ id, deletedAt: IsNull() }, { passwordHash });
  }

  async setActive(id: string, isActive: boolean): Promise<void> {
    await this.repo.update({ id, deletedAt: IsNull() }, { isActive });
  }

  async softDelete(id: string): Promise<void> {
    await this.repo.softDelete({ id });
  }
}
