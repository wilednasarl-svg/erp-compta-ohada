import { ApiProperty } from '@nestjs/swagger';

import type { JournalEntryStatus } from '../../types/journal.types';
import type { JournalEntrySourceType } from '../../entities/journal-entry.entity';
import { JournalEntryLineResponse } from './journal-entry-line.response';

const JOURNAL_ENTRY_STATUSES: ReadonlyArray<JournalEntryStatus> = [
  'draft',
  'validated',
  'cancelled',
];

const JOURNAL_ENTRY_SOURCE_TYPES: ReadonlyArray<JournalEntrySourceType> = [
  'manual',
  'import',
  'depreciation',
  'bank_reconciliation',
  'impairment',
  'tax_centralization',
];

/**
 * Item de liste d'écritures (`GET /entries`) — en-tête seul, sans
 * lignes. Forme JSON alignée sur la sérialisation TypeORM historique
 * de `JournalEntryEntity` (sans les relations FK).
 */
export class JournalEntryListItemResponse {
  @ApiProperty({ description: "UUID de l'écriture", format: 'uuid' })
  id!: string;

  @ApiProperty({ description: "UUID de l'organisation", format: 'uuid' })
  organizationId!: string;

  @ApiProperty({ description: 'UUID du journal', format: 'uuid' })
  journalId!: string;

  @ApiProperty({ description: 'UUID de la période comptable', format: 'uuid' })
  periodId!: string;

  @ApiProperty({
    description: "Numéro de l'écriture dans le journal (séquence par journal/org)",
    type: Number,
  })
  entryNumber!: number;

  @ApiProperty({
    description: 'Date comptable au format ISO (YYYY-MM-DD)',
    type: String,
    example: '2026-05-31',
  })
  entryDate!: string;

  @ApiProperty({ description: "Libellé de l'écriture", type: String })
  description!: string;

  @ApiProperty({
    description: 'Référence externe (facture, pièce justificative)',
    nullable: true,
    type: String,
  })
  reference!: string | null;

  @ApiProperty({ description: "Statut de l'écriture", enum: JOURNAL_ENTRY_STATUSES })
  status!: JournalEntryStatus;

  @ApiProperty({
    description: "Origine de l'écriture",
    enum: JOURNAL_ENTRY_SOURCE_TYPES,
  })
  sourceType!: JournalEntrySourceType;

  @ApiProperty({
    description: "UUID de la session d'import (si sourceType=import)",
    nullable: true,
    type: String,
    format: 'uuid',
  })
  sourceImportSessionId!: string | null;

  @ApiProperty({
    description: "UUID de l'écriture annulée (si contre-passation)",
    nullable: true,
    type: String,
    format: 'uuid',
  })
  cancelsId!: string | null;

  @ApiProperty({
    description: 'UUID du créateur',
    nullable: true,
    type: String,
    format: 'uuid',
  })
  createdById!: string | null;

  @ApiProperty({
    description: 'UUID du validateur',
    nullable: true,
    type: String,
    format: 'uuid',
  })
  validatedById!: string | null;

  @ApiProperty({
    description: 'Date de validation',
    nullable: true,
    type: String,
    format: 'date-time',
  })
  validatedAt!: Date | null;

  @ApiProperty({
    description: "Date d'annulation",
    nullable: true,
    type: String,
    format: 'date-time',
  })
  cancelledAt!: Date | null;

  @ApiProperty({
    description: "UUID de l'annulateur",
    nullable: true,
    type: String,
    format: 'uuid',
  })
  cancelledById!: string | null;

  @ApiProperty({
    description: "Motif d'annulation",
    nullable: true,
    type: String,
  })
  cancelledReason!: string | null;

  @ApiProperty({ description: 'Date de création', type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ description: 'Date de modification', type: String, format: 'date-time' })
  updatedAt!: Date;
}

/**
 * Détail d'écriture (`GET /entries/:id`, créations / validations /
 * contre-passations) — inclut les lignes et le code journal résolu.
 * Forme JSON alignée sur `EntryView` (cf. EntriesService.buildView).
 */
export class JournalEntryDetailResponse {
  @ApiProperty({ description: "UUID de l'écriture", format: 'uuid' })
  id!: string;

  @ApiProperty({ description: "UUID de l'organisation", format: 'uuid' })
  organizationId!: string;

  @ApiProperty({ description: 'Code court du journal (AC, VT, BQ, OD)', type: String })
  journalCode!: string;

  @ApiProperty({ description: 'UUID de la période comptable', format: 'uuid' })
  periodId!: string;

  @ApiProperty({ description: "Numéro de l'écriture", type: Number })
  entryNumber!: number;

  @ApiProperty({ description: 'Date comptable (YYYY-MM-DD)', type: String })
  entryDate!: string;

  @ApiProperty({ description: 'Libellé', type: String })
  description!: string;

  @ApiProperty({ description: 'Référence externe', nullable: true, type: String })
  reference!: string | null;

  @ApiProperty({ description: 'Statut', enum: JOURNAL_ENTRY_STATUSES })
  status!: string;

  @ApiProperty({ description: 'Origine', enum: JOURNAL_ENTRY_SOURCE_TYPES })
  sourceType!: string;

  @ApiProperty({ description: 'UUID du créateur', nullable: true, type: String, format: 'uuid' })
  createdById!: string | null;

  @ApiProperty({
    description: 'Date de validation',
    nullable: true,
    type: String,
    format: 'date-time',
  })
  validatedAt!: Date | null;

  @ApiProperty({
    description: "Date d'annulation",
    nullable: true,
    type: String,
    format: 'date-time',
  })
  cancelledAt!: Date | null;

  @ApiProperty({
    description: "Lignes débit/crédit de l'écriture",
    type: () => [JournalEntryLineResponse],
  })
  lines!: JournalEntryLineResponse[];
}
