import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { PermissionEntity } from '../entities/permission.entity';
import { RolePermissionEntity } from '../entities/role-permission.entity';

/**
 * `RolePermissionRepository` (BE-DB-11) — read access for the seeded RBAC
 * matrix (`role_id, permission_id`).
 *
 * `role_permissions` is a global join table. Writes are not exposed at the
 * data layer: the matrix is seeded by migration 0005 and any future runtime
 * mutation will go through a dedicated admin service (out of scope for
 * Module 1).
 */
@Injectable()
export class RolePermissionRepository {
  constructor(
    @InjectRepository(RolePermissionEntity)
    private readonly repo: Repository<RolePermissionEntity>,
  ) {}

  async listPermissionCodesForRole(roleId: string): Promise<string[]> {
    const rows = await this.repo
      .createQueryBuilder('rp')
      .innerJoinAndMapOne('rp.permission', PermissionEntity, 'p', 'p.id = rp.permission_id')
      .where('rp.role_id = :roleId', { roleId })
      .getMany();
    return rows
      .map((row) => row.permission?.code)
      .filter((code): code is string => typeof code === 'string')
      .sort();
  }

  async roleHasPermission(roleId: string, permissionCode: string): Promise<boolean> {
    const count = await this.repo
      .createQueryBuilder('rp')
      .innerJoin(PermissionEntity, 'p', 'p.id = rp.permission_id')
      .where('rp.role_id = :roleId AND p.code = :permissionCode', { roleId, permissionCode })
      .getCount();
    return count > 0;
  }
}
