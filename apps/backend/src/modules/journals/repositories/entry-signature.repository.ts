import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import { EntrySignatureEntity, type EntrySignerRole } from '../entities/entry-signature.entity';

export interface CreateSignatureInput {
  readonly organizationId: TenantId | string;
  readonly journalEntryId: string;
  readonly signerId: string;
  readonly signerRole: EntrySignerRole;
  readonly signatureHash: string;
  readonly comment?: string | null;
}

/**
 * Repository tenant-scopé pour `entry_signatures` (Module 14 wave 1).
 *
 * L'UNIQUE (entry_id, signer_role) côté SQL garantit qu'il ne peut y
 * avoir qu'une seule signature `chef_mission` et une seule
 * `expert_comptable` par entry — le service ne refait pas ce check
 * mais surface une erreur métier explicite avant l'insert pour éviter
 * le 23505 brut côté caller.
 */
@Injectable()
export class EntrySignatureRepository {
  constructor(
    @InjectRepository(EntrySignatureEntity)
    private readonly repo: Repository<EntrySignatureEntity>,
  ) {}

  async create(input: CreateSignatureInput): Promise<EntrySignatureEntity> {
    assertTenantId(input.organizationId);
    const entity = this.repo.create({
      organizationId: input.organizationId,
      journalEntryId: input.journalEntryId,
      signerId: input.signerId,
      signerRole: input.signerRole,
      signatureHash: input.signatureHash,
      comment: input.comment ?? null,
    });
    return this.repo.save(entity);
  }

  async findByEntryAndRole(
    organizationId: TenantId | string,
    journalEntryId: string,
    signerRole: EntrySignerRole,
  ): Promise<EntrySignatureEntity | null> {
    assertTenantId(organizationId);
    return this.repo.findOne({
      where: { organizationId, journalEntryId, signerRole },
    });
  }

  async listByEntry(
    organizationId: TenantId | string,
    journalEntryId: string,
  ): Promise<EntrySignatureEntity[]> {
    assertTenantId(organizationId);
    return this.repo.find({
      where: { organizationId, journalEntryId },
      order: { signedAt: 'ASC' },
    });
  }
}
