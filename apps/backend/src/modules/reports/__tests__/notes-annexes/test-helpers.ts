/**
 * Harness commun pour les tests Notes annexes.
 * Fournit une factory `buildHarness` qui retourne :
 *   - le service NotesAnnexesService
 *   - les mocks des dépendances (reports, assets, inventory, accounts, comments)
 *   - une `request` GetNoteRequest pré-remplie (exercice 2026)
 */

import { asTenantId } from '../../../../common/persistence/tenant-scope';
import type { NoteAnnexeCommentsRepository } from '../../repositories/note-annexe-comments.repository';
import type {
  GetNoteRequest,
  NoteAccountsDeps,
  NoteAssetsDeps,
  NoteCashFlowDeps,
  NoteInventoryDeps,
  NoteReportsDeps,
} from '../../services/notes-annexes';
import { NotesAnnexesService } from '../../services/notes-annexes';

export const ORG_ID = asTenantId('00000000-0000-4000-8000-000000000001');
export const EXERCISE_ID = '00000000-0000-4000-8000-000000000099';

export interface Harness {
  service: NotesAnnexesService;
  reportsMock: { accountBalancesAsAt: jest.Mock };
  assetsMock: { findAllForExercise: jest.Mock; findDepreciationForYear: jest.Mock };
  inventoryMock: { findAllItems: jest.Mock };
  accountsMock: { findById: jest.Mock };
  cashFlowMock: { getCashFlow: jest.Mock };
  commentsMock: {
    getOne: jest.Mock;
    getByExercise: jest.Mock;
    upsert: jest.Mock;
  };
  request: GetNoteRequest;
}

export function buildHarness(): Harness {
  const reportsMock = { accountBalancesAsAt: jest.fn().mockResolvedValue([]) };
  const assetsMock = {
    findAllForExercise: jest.fn().mockResolvedValue([]),
    findDepreciationForYear: jest.fn().mockResolvedValue([]),
  };
  const inventoryMock = { findAllItems: jest.fn().mockResolvedValue([]) };
  const accountsMock = { findById: jest.fn().mockResolvedValue(null) };
  const cashFlowMock = { getCashFlow: jest.fn() };
  const commentsMock = {
    getOne: jest.fn().mockResolvedValue(null),
    getByExercise: jest.fn().mockResolvedValue([]),
    upsert: jest.fn().mockResolvedValue(undefined),
  };

  const service = new NotesAnnexesService(
    commentsMock as unknown as NoteAnnexeCommentsRepository,
    reportsMock as unknown as NoteReportsDeps,
    assetsMock as unknown as NoteAssetsDeps,
    inventoryMock as unknown as NoteInventoryDeps,
    accountsMock as unknown as NoteAccountsDeps,
    cashFlowMock as unknown as NoteCashFlowDeps,
  );

  const request: GetNoteRequest = {
    organizationId: ORG_ID,
    exerciseId: EXERCISE_ID,
    periodStart: '2026-01-01',
    periodEnd: '2026-12-31',
    fiscalYear: 2026,
  };

  return {
    service,
    reportsMock,
    assetsMock,
    inventoryMock,
    accountsMock,
    cashFlowMock,
    commentsMock,
    request,
  };
}
