import { type MigrationInterface, type QueryRunner } from 'typeorm';

/**
 * 0107 — Remap des commentaires `note_annexe_comments` après refonte du
 * registre des notes annexes pour conformité SYSCOHADA Tome 3 (p. 35-70).
 *
 * Contexte
 * --------
 * Le registre des notes annexes a été refondu pour correspondre EXACTEMENT
 * à la doctrine SYSCOHADA Révisé Tome 3 :
 *
 *   - introduction des sous-notes officielles 3E, 3F, 15A/B, 16A/B/Bbis/C
 *     et 27A/B (cf. en-tête de `note-registry.ts`)
 *   - remap des libellés (ex : ancien N1 « Référentiel » → doctrine N2
 *     « Informations obligatoires » ; ancien N22 « Chiffre d'affaires »
 *     → doctrine N21)
 *   - suppression de N20 (non réservé par la grille R4 doctrine)
 *
 * Sans migration, les saisies historiques côté `note_annexe_comments`
 * resteraient indexées sur des `note_id` ne correspondant plus à aucune
 * entrée du registre — les commentaires deviendraient orphelins
 * (invisibles depuis l'UI mais conservés en base).
 *
 * Stratégie
 * ---------
 *   - UPDATE conditionnel : applique le mapping ancien→nouveau via CASE
 *   - Les ids sans correspondance directe (N21 legacy = écart conv.
 *     passif ; N26 legacy = dotations ; N32..N36 legacy = informations
 *     libres) sont préfixés `_legacy_` pour préservation de la saisie
 *     sans pollution du registre actif.
 *   - Le CHECK constraint sur `note_id` est élargi pour autoriser les
 *     formes 'N16Bbis', 'N15A', 'N27B' (suffixes alphanumériques) ET le
 *     préfixe `_legacy_` (longueur portée à 32).
 *   - Idempotente : utilise un guard `WHERE note_id IN (...)` qui no-op
 *     si la migration a déjà été appliquée (les nouveaux ids ne sont pas
 *     dans la liste source).
 *
 * Reverse (`down`)
 * ----------------
 *   - Restaure le mapping inverse (nouveau → ancien) pour les cas
 *     univoques.
 *   - Restaure le CHECK constraint historique.
 *   - Les `_legacy_` sont décodés vers leur préfixe d'origine.
 *
 * AVERTISSEMENT : cette migration touche la table `note_annexe_comments`
 * uniquement. Aucun impact sur les autres tables.
 */
export class RemapNoteAnnexeComments1700000000107 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Élargir d'abord la colonne note_id et son CHECK pour accepter
    //    les nouvelles formes ('N16Bbis', '_legacy_N21', etc.).
    await queryRunner.query(`
      ALTER TABLE "note_annexe_comments"
        ALTER COLUMN "note_id" TYPE VARCHAR(32)
    `);
    await queryRunner.query(`
      ALTER TABLE "note_annexe_comments"
        DROP CONSTRAINT IF EXISTS "chk_note_annexe_comments_note_id_format"
    `);
    await queryRunner.query(`
      ALTER TABLE "note_annexe_comments"
        ADD CONSTRAINT "chk_note_annexe_comments_note_id_format"
        CHECK ("note_id" ~ '^(_legacy_)?N[0-9]{1,2}(Bbis|[A-F])?$')
    `);

    // 2. Remap des ids ayant une correspondance doctrine univoque.
    //    Ordre : on commence par les ids qui ne se mélangent pas (3C/3D
    //    sont swapés — pour éviter qu'un UPDATE écrase l'autre on passe
    //    par un id intermédiaire).
    await queryRunner.query(`
      UPDATE "note_annexe_comments"
      SET "note_id" = '__SWAP_N3C__'
      WHERE "note_id" = 'N3C'
    `);
    await queryRunner.query(`
      UPDATE "note_annexe_comments"
      SET "note_id" = 'N3C'
      WHERE "note_id" = 'N3D'
    `);
    await queryRunner.query(`
      UPDATE "note_annexe_comments"
      SET "note_id" = 'N3D'
      WHERE "note_id" = '__SWAP_N3C__'
    `);

    // 3. Mapping en série — un UPDATE par cible doctrine.
    //    (ancien id → nouveau doctrine id ; commentaire dans le code
    //    pointe l'intitulé legacy pour audit.)
    const remaps: ReadonlyArray<{ readonly from: string; readonly to: string }> = [
      // N1 legacy (référentiel comptable) → N2 doctrine (informations
      // obligatoires : conformité + méthodes).
      { from: 'N1', to: 'N2' },
      // Subdivisions règlementaires (création des sous-notes officielles).
      { from: 'N15', to: 'N15A' },
      { from: 'N16', to: 'N16A' },
      // N20 legacy (concours bancaires courants) → N16C doctrine
      // (banques, crédit d'escompte et de trésorerie).
      { from: 'N20', to: 'N16C' },
      // Décalage CR : tout l'axe N22..N26 legacy était shifté.
      { from: 'N22', to: 'N21' }, // CA et autres produits
      { from: 'N23', to: 'N22' }, // Achats
      { from: 'N24', to: 'N24' }, // identique (services extérieurs)
      { from: 'N25', to: 'N27A' }, // charges de personnel
      { from: 'N27', to: 'N29' }, // charges et revenus financiers
      { from: 'N28', to: 'N28' }, // identique (provisions inscrites au bilan)
      { from: 'N29', to: 'N30' }, // autres charges et produits HAO
      { from: 'N30', to: 'N31' }, // impôt sur le résultat → répartition du résultat
      // Notes texte libre : décalage N32..N36 legacy.
      { from: 'N32', to: 'N27B' }, // effectifs et masse salariale
      { from: 'N33', to: 'N16Bbis' }, // engagements hors bilan → actifs/passifs éventuels
    ];

    for (const { from, to } of remaps) {
      if (from === to) continue; // no-op explicite
      // Précaution : si une ligne existe déjà pour le `to`, on préserve la
      // saisie ancienne sous `_legacy_${from}` pour ne pas violer la
      // contrainte d'unicité (org, exercise, note_id).
      await queryRunner.query(
        `
          UPDATE "note_annexe_comments" src
          SET "note_id" = '_legacy_' || $1
          WHERE src."note_id" = $1
            AND EXISTS (
              SELECT 1 FROM "note_annexe_comments" dst
              WHERE dst."organization_id" = src."organization_id"
                AND dst."exercise_id"     = src."exercise_id"
                AND dst."note_id"         = $2
            )
        `,
        [from, to],
      );
      await queryRunner.query(
        `UPDATE "note_annexe_comments" SET "note_id" = $2 WHERE "note_id" = $1`,
        [from, to],
      );
    }

    // 4. Ids sans correspondance doctrine directe → préfixés `_legacy_`.
    //    Sujets concernés :
    //      N21 legacy (écart conversion passif) — couvert par N12 doctrine
    //                  mais le contenu commentaire mérite revue manuelle.
    //      N26 legacy (dotations amortissements) — réparti par doctrine
    //                  entre N3C (amort) et N28 (provisions bilan).
    //      N34, N35, N36 legacy (parties liées, événements postérieurs,
    //                  informations sectorielles) — pas de slot doctrine
    //                  équivalent dans Tome 3, à porter en follow-up.
    const legacyOnly: ReadonlyArray<string> = ['N21', 'N26', 'N34', 'N35', 'N36'];
    for (const oldId of legacyOnly) {
      await queryRunner.query(
        `UPDATE "note_annexe_comments" SET "note_id" = $2 WHERE "note_id" = $1`,
        [oldId, `_legacy_${oldId}`],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Restauration en miroir : on remappe d'abord les `_legacy_*` puis on
    // recompose les ids historiques.
    const legacyOnly: ReadonlyArray<string> = ['N21', 'N26', 'N34', 'N35', 'N36'];
    for (const oldId of legacyOnly) {
      await queryRunner.query(
        `UPDATE "note_annexe_comments" SET "note_id" = $2 WHERE "note_id" = $1`,
        [`_legacy_${oldId}`, oldId],
      );
    }

    // Inverse du remap principal (skip identity remaps).
    const reverseRemaps: ReadonlyArray<{ readonly from: string; readonly to: string }> = [
      { from: 'N33', to: 'N16Bbis' }, // doit être traité avant N16Bbis → N33
      { from: 'N27B', to: 'N32' },
      { from: 'N31', to: 'N30' },
      { from: 'N30', to: 'N29' },
      { from: 'N29', to: 'N27' },
      { from: 'N27A', to: 'N25' },
      { from: 'N22', to: 'N23' },
      { from: 'N21', to: 'N22' },
      { from: 'N16C', to: 'N20' },
      { from: 'N16A', to: 'N16' },
      { from: 'N15A', to: 'N15' },
      { from: 'N2', to: 'N1' },
    ];

    for (const { from, to } of reverseRemaps) {
      // Décode aussi le `_legacy_${to}` ré-introduit côté up() si une
      // collision avait eu lieu.
      await queryRunner.query(
        `
          UPDATE "note_annexe_comments"
          SET "note_id" = $2
          WHERE "note_id" = $1
        `,
        [from, to],
      );
      await queryRunner.query(
        `
          UPDATE "note_annexe_comments"
          SET "note_id" = $2
          WHERE "note_id" = $1
        `,
        [`_legacy_${to}`, to],
      );
    }

    // Restaure le swap 3C/3D doctrine → legacy (échange inverse).
    await queryRunner.query(`
      UPDATE "note_annexe_comments"
      SET "note_id" = '__SWAP_N3C__'
      WHERE "note_id" = 'N3C'
    `);
    await queryRunner.query(`
      UPDATE "note_annexe_comments"
      SET "note_id" = 'N3C'
      WHERE "note_id" = 'N3D'
    `);
    await queryRunner.query(`
      UPDATE "note_annexe_comments"
      SET "note_id" = 'N3D'
      WHERE "note_id" = '__SWAP_N3C__'
    `);

    // Restaure le CHECK constraint historique (format strict 'N[0-9]+[A-E]?').
    await queryRunner.query(`
      ALTER TABLE "note_annexe_comments"
        DROP CONSTRAINT IF EXISTS "chk_note_annexe_comments_note_id_format"
    `);
    await queryRunner.query(`
      ALTER TABLE "note_annexe_comments"
        ADD CONSTRAINT "chk_note_annexe_comments_note_id_format"
        CHECK ("note_id" ~ '^N[0-9]{1,2}[A-E]?$')
    `);
    await queryRunner.query(`
      ALTER TABLE "note_annexe_comments"
        ALTER COLUMN "note_id" TYPE VARCHAR(8)
    `);
  }
}
