/**
 * Note 16B bis — Actifs et passifs éventuels (Tome 3 p. 53).
 *
 * Doctrine : actifs nantis (hypothèques, nantissements, gages…) et
 * passifs garantis par des sûretés réelles données par l'entité.
 * Symétrique de N1 (dettes garanties) du côté des actifs.
 *
 * Ce handler reste en commentaire libre tant qu'aucune entité
 * `pledged_assets` / `hypothecs` n'est livrée (hors scope C3, cf.
 * follow-up Note 1). Le handler retourne un placeholder vide pour
 * permettre au comptable d'expliciter les sûretés via le commentaire
 * libre ; les colonnes attendues sont préfigurées dans la première
 * ligne « placeholder » qui sert de modèle UI (clé `TEMPLATE`).
 */
import type { NoteHandler } from '../types';

export const handleN16bbisSuretesDonnees: NoteHandler = async () => ({
  rows: [],
  applicable: true,
});
