import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { type EntityManager, IsNull, Repository } from 'typeorm';

import { OrganizationEntity } from '../entities/organization.entity';

/**
 * `OrganizationRepository` (BE-DB-11) — data access for the tenant root.
 *
 * Notes on the multi-tenant invariant: `organizations` IS the tenant root,
 * not a tenant-scoped table — `id` is the organization id. So this
 * repository legitimately exposes `findById(id)` and `findBySlug(slug)`
 * without requiring an upstream `organizationId` parameter; the caller has
 * to know which org they are addressing in the first place.
 *
 * Soft-deleted rows (`deletedAt IS NOT NULL`) are excluded from every
 * "find active" path.
 */
@Injectable()
export class OrganizationRepository {
  constructor(
    @InjectRepository(OrganizationEntity)
    private readonly repo: Repository<OrganizationEntity>,
  ) {}

  async findActiveById(id: string): Promise<OrganizationEntity | null> {
    return this.repo.findOne({ where: { id, deletedAt: IsNull() } });
  }

  async findActiveBySlug(slug: string): Promise<OrganizationEntity | null> {
    return this.repo.findOne({ where: { slug, deletedAt: IsNull() } });
  }

  async slugExists(slug: string): Promise<boolean> {
    return (await this.repo.count({ where: { slug } })) > 0;
  }

  /**
   * Persist a new organisation row. When `manager` is supplied, the
   * insert joins that outer transaction (used by `OrganizationsService
   * .create` to atomically bundle org + membership + accounting config
   * + chart clone). Without it, a self-contained save runs.
   */
  async create(
    input: {
      name: string;
      slug: string;
      type: OrganizationEntity['type'];
    },
    manager?: EntityManager,
  ): Promise<OrganizationEntity> {
    const repo = manager !== undefined ? manager.getRepository(OrganizationEntity) : this.repo;
    const entity = repo.create(input);
    return repo.save(entity);
  }

  async updateName(id: string, name: string): Promise<OrganizationEntity | null> {
    await this.repo.update({ id, deletedAt: IsNull() }, { name });
    return this.findActiveById(id);
  }

  async softDelete(id: string): Promise<void> {
    await this.repo.softDelete({ id });
  }
}
