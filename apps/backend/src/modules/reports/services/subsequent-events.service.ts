import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';

import { type TenantId } from '../../../common/persistence/tenant-scope';
import { AccountingPeriodRepository } from '../../journals/repositories/accounting-period.repository';
import {
  SubsequentEventEntity,
  type SubsequentEventClassification,
} from '../entities/subsequent-event.entity';
import {
  SubsequentEventsRepository,
  type CreateSubsequentEventInput,
  type UpdateSubsequentEventInput,
} from '../repositories/subsequent-events.repository';

export interface RecordEventInput {
  readonly eventDate: string;
  readonly classification: SubsequentEventClassification;
  readonly description: string;
  readonly financialImpact?: string | null;
  readonly journalEntryId?: string | null;
}

/**
 * `SubsequentEventsService` — W5.7. Workflow de saisie et de
 * classification des événements postérieurs à la clôture pour la
 * Note 35 SYSCOHADA.
 *
 * Invariants métier :
 *   - `eventDate` DOIT être > date de clôture de l'exercice (un
 *     événement antérieur à la clôture n'est pas "postérieur" — il
 *     se traite dans l'exercice normalement).
 *   - L'exercice référencé doit exister et être annuel.
 *   - `description` non vide (la doctrine OHADA exige un libellé
 *     qualitatif, déjà tracé par CHECK SQL — on duplique côté service
 *     pour fail-fast à la création).
 */
@Injectable()
export class SubsequentEventsService {
  private readonly logger = new Logger(SubsequentEventsService.name);

  constructor(
    private readonly periodRepo: AccountingPeriodRepository,
    private readonly eventsRepo: SubsequentEventsRepository,
  ) {}

  async record(
    organizationId: TenantId,
    exerciseId: string,
    actorId: string,
    input: RecordEventInput,
  ): Promise<SubsequentEventEntity> {
    const period = await this.periodRepo.findById(exerciseId, organizationId);
    if (!period) {
      throw new NotFoundException(`Accounting period ${exerciseId} not found.`);
    }
    if (period.kind !== 'ANNUAL') {
      throw new NotFoundException(
        `Period ${exerciseId} is not an annual exercise (kind=${period.kind}).`,
      );
    }
    if (input.eventDate <= period.endDate) {
      throw new BadRequestException(
        `Event date ${input.eventDate} must be strictly after the closing date ${period.endDate}.`,
      );
    }
    if (input.description.trim().length === 0) {
      throw new BadRequestException('Event description must not be empty.');
    }

    const payload: CreateSubsequentEventInput = {
      organizationId,
      exerciseId: period.id,
      eventDate: input.eventDate,
      classification: input.classification,
      description: input.description.trim(),
      financialImpact: input.financialImpact ?? null,
      journalEntryId: input.journalEntryId ?? null,
      createdById: actorId,
    };
    const created = await this.eventsRepo.create(payload);
    this.logger.log(
      `Subsequent event recorded org=${organizationId} exercise=${exerciseId} ` +
        `id=${created.id} classification=${input.classification}`,
    );
    return created;
  }

  async list(
    organizationId: TenantId,
    exerciseId: string,
  ): Promise<ReadonlyArray<SubsequentEventEntity>> {
    return this.eventsRepo.listByExercise(organizationId, exerciseId);
  }

  async get(organizationId: TenantId, id: string): Promise<SubsequentEventEntity> {
    const event = await this.eventsRepo.findById(organizationId, id);
    if (!event) {
      throw new NotFoundException(`Subsequent event ${id} not found.`);
    }
    return event;
  }

  async update(
    organizationId: TenantId,
    id: string,
    patch: UpdateSubsequentEventInput,
  ): Promise<SubsequentEventEntity> {
    if (patch.description !== undefined && patch.description.trim().length === 0) {
      throw new BadRequestException('Event description must not be empty.');
    }
    if (patch.eventDate !== undefined) {
      const event = await this.get(organizationId, id);
      const period = await this.periodRepo.findById(event.exerciseId, organizationId);
      if (period && patch.eventDate <= period.endDate) {
        throw new BadRequestException(
          `Event date ${patch.eventDate} must be strictly after the closing date ${period.endDate}.`,
        );
      }
    }
    const updated = await this.eventsRepo.update(organizationId, id, patch);
    if (!updated) {
      throw new NotFoundException(`Subsequent event ${id} not found.`);
    }
    return updated;
  }

  /**
   * Workflow à 4 yeux : un second utilisateur (≠ `createdById`)
   * valide la classification. Bloque la review par le créateur.
   */
  async markReviewed(
    organizationId: TenantId,
    id: string,
    reviewerId: string,
  ): Promise<SubsequentEventEntity> {
    const event = await this.get(organizationId, id);
    if (event.createdById === reviewerId) {
      throw new BadRequestException(
        'A subsequent event cannot be reviewed by its own author (four-eyes principle).',
      );
    }
    const updated = await this.eventsRepo.markReviewed(organizationId, id, reviewerId);
    if (!updated) {
      throw new NotFoundException(`Subsequent event ${id} not found.`);
    }
    return updated;
  }

  async delete(organizationId: TenantId, id: string): Promise<void> {
    const deleted = await this.eventsRepo.delete(organizationId, id);
    if (!deleted) {
      throw new NotFoundException(`Subsequent event ${id} not found.`);
    }
  }
}
