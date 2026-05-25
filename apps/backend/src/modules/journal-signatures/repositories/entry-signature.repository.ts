import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { EntrySignatureEntity } from '../entities/entry-signature.entity';
import type { SignerRole } from '../types/journal-signature.types';

export interface CreateSignatureInput {
  readonly organizationId: string;
  readonly journalEntryId: string;
  readonly signerId: string;
  readonly signerRole: SignerRole;
  readonly signatureHash: string;
  readonly comment: string | null;
}

/**
 * Repository tenant-scopé pour `entry_signatures`. Toutes les lectures
 * filtrent par `organization_id` — l'UNIQUE (entry_id, signer_role)
 * de la migration garantit l'unicité par rôle.
 */
@Injectable()
export class EntrySignatureRepository {
  constructor(
    @InjectRepository(EntrySignatureEntity)
    private readonly repo: Repository<EntrySignatureEntity>,
  ) {}

  create(input: CreateSignatureInput): Promise<EntrySignatureEntity> {
    const sig = this.repo.create({
      organizationId: input.organizationId,
      journalEntryId: input.journalEntryId,
      signerId: input.signerId,
      signerRole: input.signerRole,
      signatureHash: input.signatureHash,
      comment: input.comment,
    });
    return this.repo.save(sig);
  }

  findByEntryAndRole(
    organizationId: string,
    journalEntryId: string,
    signerRole: SignerRole,
  ): Promise<EntrySignatureEntity | null> {
    return this.repo.findOne({
      where: { organizationId, journalEntryId, signerRole },
    });
  }

  listByEntry(organizationId: string, journalEntryId: string): Promise<EntrySignatureEntity[]> {
    return this.repo.find({
      where: { organizationId, journalEntryId },
      order: { signedAt: 'ASC' },
    });
  }
}
