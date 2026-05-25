import { Injectable, NotFoundException } from '@nestjs/common';

import { assertTenantId, type TenantId } from '../../../../common/persistence/tenant-scope';
import type { NoteAnnexeCommentsRepository } from '../../repositories/note-annexe-comments.repository';
import { ALL_NOTE_IDS, NOTE_REGISTRY } from './note-registry';
import {
  type NoteAccountsDeps,
  type NoteAssetsDeps,
  type NoteComputationContext,
  type NoteContent,
  type NoteHandlerDependencies,
  type NoteId,
  type NoteInventoryDeps,
  type NoteReportsDeps,
  NotImplementedError,
} from './types';

/** Bundle d'entrée du service. Tous les paramètres scoping sont obligatoires. */
export interface GetNoteRequest {
  readonly organizationId: TenantId | string;
  readonly exerciseId: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly fiscalYear: number;
}

/**
 * `NotesAnnexesService` — orchestrateur du moteur de Notes annexes
 * SYSCOHADA (W2.4).
 *
 * Flux `getNote(req, noteId)` :
 *   1. Récupère l'entrée du registry (sinon `NotFoundException`).
 *   2. Récupère le commentaire libre persisté si présent.
 *   3. Si la note est marquée `applicable: false` par le comptable,
 *      court-circuite le calcul et renvoie `{ rows: [] }`.
 *   4. Sinon, exécute le handler. Si le handler jette
 *      `NotImplementedError`, le re-jette tel quel (l'API distingue).
 *
 * Pas de cache : les notes sont recalculées à chaque appel. La donnée
 * source (registres comptables, assets, stocks) n'est pas re-projetée
 * — c'est le repository qui agrège côté SQL.
 */
@Injectable()
export class NotesAnnexesService {
  constructor(
    private readonly commentsRepo: NoteAnnexeCommentsRepository,
    private readonly reportsDeps: NoteReportsDeps,
    private readonly assetsDeps: NoteAssetsDeps,
    private readonly inventoryDeps: NoteInventoryDeps,
    private readonly accountsDeps: NoteAccountsDeps,
  ) {}

  /** Tous les NoteIds (36 IDs). */
  listNoteIds(): ReadonlyArray<NoteId> {
    return ALL_NOTE_IDS;
  }

  async getNote(req: GetNoteRequest, noteId: NoteId): Promise<NoteContent> {
    assertTenantId(req.organizationId);
    const entry = NOTE_REGISTRY.get(noteId);
    if (!entry) {
      throw new NotFoundException(`Unknown noteId: ${noteId}`);
    }

    const comment = await this.commentsRepo.getOne(req.organizationId, req.exerciseId, noteId);
    // Si pas de commentaire persisté, on prend l'applicableByDefault de la métadata.
    const applicableFromUser = comment ? comment.applicable : entry.metadata.applicableByDefault;
    const freeComment = comment?.commentText ?? '';

    if (!applicableFromUser) {
      return {
        id: noteId,
        metadata: entry.metadata,
        applicable: false,
        rows: [],
        freeComment,
        computedAt: new Date().toISOString(),
      };
    }

    const ctx: NoteComputationContext = {
      organizationId: req.organizationId,
      exerciseId: req.exerciseId,
      periodStart: req.periodStart,
      periodEnd: req.periodEnd,
      fiscalYear: req.fiscalYear,
    };
    const deps: NoteHandlerDependencies = {
      reports: this.reportsDeps,
      assets: this.assetsDeps,
      inventory: this.inventoryDeps,
      accounts: this.accountsDeps,
    };

    const handlerResult = await entry.handler(ctx, deps);
    return {
      id: noteId,
      metadata: entry.metadata,
      applicable: handlerResult.applicable,
      rows: handlerResult.rows,
      freeComment,
      computedAt: new Date().toISOString(),
    };
  }

  /**
   * Calcule TOUTES les notes du registry. Les notes en stub
   * (`NotImplementedError`) sont retournées comme `applicable: false`
   * avec un row de marquage — le frontend pourra afficher "Pending W2.4.b"
   * sans crash.
   */
  async getAllNotes(req: GetNoteRequest): Promise<ReadonlyArray<NoteContent>> {
    assertTenantId(req.organizationId);
    const out: NoteContent[] = [];
    for (const noteId of ALL_NOTE_IDS) {
      try {
        const note = await this.getNote(req, noteId);
        out.push(note);
      } catch (err: unknown) {
        if (err instanceof NotImplementedError) {
          const entry = NOTE_REGISTRY.get(noteId)!;
          out.push({
            id: noteId,
            metadata: entry.metadata,
            applicable: false,
            rows: [
              {
                key: 'PENDING',
                label: 'Implémentation en attente (W2.4.b)',
                values: { statut: 'PENDING' },
              },
            ],
            computedAt: new Date().toISOString(),
          });
          continue;
        }
        throw err;
      }
    }
    return out;
  }

  async upsertComment(
    organizationId: TenantId | string,
    exerciseId: string,
    noteId: NoteId,
    commentText: string,
    applicable: boolean,
  ): Promise<void> {
    assertTenantId(organizationId);
    const entry = NOTE_REGISTRY.get(noteId);
    if (!entry) throw new NotFoundException(`Unknown noteId: ${noteId}`);
    await this.commentsRepo.upsert(organizationId, exerciseId, noteId, commentText, applicable);
  }
}
