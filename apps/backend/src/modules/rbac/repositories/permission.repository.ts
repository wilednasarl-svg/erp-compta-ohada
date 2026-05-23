import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { PermissionEntity } from '../entities/permission.entity';

/**
 * `PermissionRepository` (BE-DB-11) — read access for the seeded permission
 * catalog.
 *
 * `permissions` is a global catalog. Writes are not exposed: codes are
 * seeded by migration 0004 and referenced verbatim by controller decorators
 * (`@RequirePermission(...)`), so they must not drift at runtime.
 */
@Injectable()
export class PermissionRepository {
  constructor(
    @InjectRepository(PermissionEntity)
    private readonly repo: Repository<PermissionEntity>,
  ) {}

  async findByCode(code: string): Promise<PermissionEntity | null> {
    return this.repo.findOne({ where: { code } });
  }

  async findManyByCodes(codes: readonly string[]): Promise<PermissionEntity[]> {
    if (codes.length === 0) {
      return [];
    }
    return this.repo.find({ where: { code: In([...codes]) } });
  }

  async listAll(): Promise<PermissionEntity[]> {
    return this.repo.find({ order: { code: 'ASC' } });
  }
}
