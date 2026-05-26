/**
 * Builder pour les notes annexes "texte libre" : N32 (effectif), N33
 * (engagements hors bilan), N34 (parties liées), N35 (événements
 * postérieurs à la clôture), N36 (informations sectorielles).
 *
 * Ces notes n'ont pas de source comptable agrégeable : le comptable
 * remplit le `freeComment` via l'endpoint dédié. Le handler renvoie
 * { rows: [], applicable: true } pour signaler que la note doit
 * apparaître dans la liasse (case texte libre obligatoire).
 *
 * Si le comptable la marque N/A explicitement, c'est persisté côté
 * `note_annexe_comments.applicable = false` et override le handler.
 */
import type { NoteHandler } from '../types';

export const freeCommentNote: NoteHandler = async () => ({
  rows: [],
  applicable: true,
});
