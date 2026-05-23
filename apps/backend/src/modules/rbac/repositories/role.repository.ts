import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { RoleEntity } from '../entities/role.entity';

/**
 * `RoleRepository` (BE-DB-11) — read access for the seeded role catalog.
 *
 * `roles` is a global, non-tenant-scoped catalog (the six system roles are
 * shared across every organization). Writes are intentionally not exposed:
 * system roles are seeded by migration 0003 and must never be mutated via
 * the API (specs/rbac, "RBAC_SYSTEM_ROLE_LOCKED").
 */
@Injectable()
export class RoleRepository {
  constructor(
    @InjectRepository(RoleEntity)
    private readonly repo: Repository<RoleEntity>,
  ) {}

  async findById(id: string): Promise<RoleEntity | null> {
    return this.repo.findOne({ where: { id } });
  }

  async findByCode(code: string): Promise<RoleEntity | null> {
    return this.repo.findOne({ where: { code } });
  }

  async findManyByCodes(codes: readonly string[]): Promise<RoleEntity[]> {
    if (codes.length === 0) {
      return [];
    }
    return this.repo.find({ where: { code: In([...codes]) } });
  }

  async listAll(): Promise<RoleEntity[]> {
    return this.repo.find({ order: { code: 'ASC' } });
  }
}
