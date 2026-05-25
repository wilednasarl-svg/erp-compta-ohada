import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import { NoteAnnexeCommentEntity } from '../entities/note-annexe-comment.entity';

/**
 * `NoteAnnexeCommentsRepository` — accès à la table
 * `note_annexe_comments`. Stocke les annotations libres et l'override
 * `applicable` que le comptable peut saisir sur chaque note pour un
 * exercice donné.
 *
 * SECURITY : toutes les méthodes scopent sur `organizationId` via
 * `assertTenantId`. Aucune méthode publique ne renvoie de données hors
 * tenant.
 */
@Injectable()
export class NoteAnnexeCommentsRepository {
  constructor(
    @InjectRepository(NoteAnnexeCommentEntity)
    private readonly repo: Repository<NoteAnnexeCommentEntity>,
  ) {}

  async getByExercise(
    organizationId: TenantId | string,
    exerciseId: string,
    noteId?: string,
  ): Promise<ReadonlyArray<NoteAnnexeCommentEntity>> {
    assertTenantId(organizationId);
    const where: Record<string, string> = { organizationId, exerciseId };
    if (noteId !== undefined) where.noteId = noteId;
    return this.repo.find({ where });
  }

  async getOne(
    organizationId: TenantId | string,
    exerciseId: string,
    noteId: string,
  ): Promise<NoteAnnexeCommentEntity | null> {
    assertTenantId(organizationId);
    return this.repo.findOne({ where: { organizationId, exerciseId, noteId } });
  }

  async upsert(
    organizationId: TenantId | string,
    exerciseId: string,
    noteId: string,
    commentText: string,
    applicable: boolean,
  ): Promise<NoteAnnexeCommentEntity> {
    assertTenantId(organizationId);
    const existing = await this.repo.findOne({
      where: { organizationId, exerciseId, noteId },
    });
    if (existing) {
      existing.commentText = commentText;
      existing.applicable = applicable;
      return this.repo.save(existing);
    }
    const created = this.repo.create({
      organizationId,
      exerciseId,
      noteId,
      commentText,
      applicable,
    });
    return this.repo.save(created);
  }
}
