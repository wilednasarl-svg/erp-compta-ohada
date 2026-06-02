/**
 * Note 16C - Actifs et passifs eventuels (Tome 3 p. 53).
 *
 * Doctrine : actifs nantis (hypotheques, nantissements, gages...) et
 * passifs garantis par des suretes reelles donnees par l'entite.
 * Symetrique de N1 (dettes garanties) du cote des actifs.
 *
 * Ce handler reste en commentaire libre tant qu'aucune entite
 * `pledged_assets` / `hypothecs` n'est livree. Il retourne une note
 * applicable vide afin que le comptable documente le detail en saisie libre.
 */
import type { NoteHandler } from '../types';

// eslint-disable-next-line @typescript-eslint/require-await -- conforms to the async NoteHandler contract; returns a static row set.
export const handleN16cActifsPassifsEventuels: NoteHandler = async () => ({
  rows: [],
  applicable: true,
});
