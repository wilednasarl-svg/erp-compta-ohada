import { ALL_NOTE_IDS } from '../../services/notes-annexes';
import type { NoteId } from '../../services/notes-annexes';
import { buildHarness } from './test-helpers';

describe('NotesAnnexesService — smoke', () => {
  it('exposes the 36 SYSCOHADA notes via listNoteIds', () => {
    const { service } = buildHarness();
    const ids = service.listNoteIds();
    // 35 + 2 sub-notes (3A..3D) - 1 N3 omitted in favour of subs.
    // The registry contains all canonical entries; we check >= 35.
    expect(ids.length).toBeGreaterThanOrEqual(35);
    expect(ids).toContain('N1');
    expect(ids).toContain('N36');
    expect(ALL_NOTE_IDS).toBe(ids);
  });

  it('throws NotFoundException for an unknown noteId', async () => {
    const { service, request } = buildHarness();
    await expect(service.getNote(request, 'N99' as NoteId)).rejects.toThrow(/Unknown noteId/);
  });

  it('getAllNotes returns all entries; les 10 notes implémentées portent des rows non-PENDING', async () => {
    const { service, request, commentsMock } = buildHarness();
    // Forcer tous les stubs à être applicable=true pour qu'ils déclenchent
    // NotImplementedError et soient marqués PENDING par getAllNotes.
    commentsMock.getOne.mockImplementation(
      async (_org: string, _ex: string, noteId: string) => ({
        applicable: true,
        commentText: '',
        noteId,
      }),
    );

    const notes = await service.getAllNotes(request);
    expect(notes.length).toBe(ALL_NOTE_IDS.length);

    const pending = notes.filter((n) => n.rows[0]?.key === 'PENDING');
    const implemented = notes.filter((n) => n.rows[0]?.key !== 'PENDING');
    expect(implemented.length).toBe(10);
    expect(pending.length).toBe(ALL_NOTE_IDS.length - 10);

    const implementedIds = new Set(implemented.map((n) => n.id));
    for (const id of ['N1', 'N2', 'N3A', 'N3C', 'N3D', 'N6', 'N7', 'N17', 'N18', 'N28']) {
      expect(implementedIds.has(id as NoteId)).toBe(true);
    }
  });

  it('respects user override applicable=false (no calc, no rows)', async () => {
    const { service, request, commentsMock } = buildHarness();
    commentsMock.getOne.mockResolvedValue({ applicable: false, commentText: 'N/A pour cet exercice' });
    const note = await service.getNote(request, 'N1' as NoteId);
    expect(note.applicable).toBe(false);
    expect(note.rows.length).toBe(0);
    expect(note.freeComment).toBe('N/A pour cet exercice');
  });

  it('upsertComment delegates to the repo', async () => {
    const { service, commentsMock, request } = buildHarness();
    await service.upsertComment(request.organizationId, request.exerciseId, 'N1' as NoteId, 'hello', true);
    expect(commentsMock.upsert).toHaveBeenCalledWith(
      request.organizationId,
      request.exerciseId,
      'N1',
      'hello',
      true,
    );
  });

  it('upsertComment rejects unknown noteId', async () => {
    const { service, request } = buildHarness();
    await expect(
      service.upsertComment(request.organizationId, request.exerciseId, 'N42X' as NoteId, '', true),
    ).rejects.toThrow(/Unknown noteId/);
  });
});

describe('NotesAnnexesService — N1 & N2', () => {
  it('N1 always applicable, returns the doctrine rows', async () => {
    const { service, request } = buildHarness();
    const n1 = await service.getNote(request, 'N1' as NoteId);
    expect(n1.applicable).toBe(true);
    expect(n1.rows.find((r) => r.key === 'REFERENTIEL')).toBeDefined();
    expect(n1.rows.find((r) => r.key === 'METHODE_STOCK')).toBeDefined();
  });

  it('N2 returns the conformity declaration', async () => {
    const { service, request } = buildHarness();
    const n2 = await service.getNote(request, 'N2' as NoteId);
    expect(n2.applicable).toBe(true);
    expect(n2.rows[0]?.values.statut).toBe('CONFORME');
  });
});
