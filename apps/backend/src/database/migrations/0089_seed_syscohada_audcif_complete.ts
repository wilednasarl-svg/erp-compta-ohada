import { type MigrationInterface, type QueryRunner } from 'typeorm';

import { OHADA_REFERENCE_CHART } from '../../modules/accounting-plan/seed/ohada-syscohada-audcif';

/**
 * W1.1 — Seed PCG SYSCOHADA AUDCIF complet (extension critique).
 *
 * Cette migration est **strictement additive** : elle insère les ∼322
 * nouveaux comptes critiques manquants identifiés par l'audit doctrinal
 * (synthèse Tome 1 — opérations courantes + Tome 2 — opérations
 * spécifiques) sans toucher aux 171 comptes de la colonne vertébrale
 * déjà présents (migration 0011).
 *
 * Couverture :
 *   - Classe 1 : capitaux détaillés (101/104/105/106), réserves
 *     (111/112/118), résultats (121/129/131/139), subventions
 *     d'investissement (141/142/148), provisions réglementées
 *     (151/152/154/155/156), emprunts détaillés (161..168, 1684),
 *     location-acquisition (172/173/174), provisions risques et
 *     charges (191..198, 1984), liquidation (1374).
 *   - Classe 2 : charges immobilisées (201/202/206), incorporelles
 *     (211..219), terrains (221..229), bâtiments (231..239), matériel
 *     (241..249), avances (251/252), titres (261..278), amortissements
 *     détaillés (281..285), dépréciations (291..297).
 *   - Classe 3 : stocks détaillés (311/321/322/331..335, 341/351/361/
 *     371/372/381/388), dépréciations (391..397).
 *   - Classe 4 : fournisseurs (4011/4012/403/404/405, 4081/4086,
 *     4091/4094/4098), clients (4111/4112, 4131..4133, 414/415/417,
 *     4181/4186, 4191/4194/4198), personnel (4212/4232/4281/4286/4287),
 *     organismes sociaux (4311..4313, 4381/4382/4386/4387), État
 *     (4426/4435/4458/4471/4472/4486/4487/4491/4493..4498), organismes
 *     internationaux (451/458), associés (461/462/465/4582), comptes
 *     d'attente et FX (4751/4752, 4781/4782, 4791/4792), CCA/PCA détail
 *     (4861/4862/4868), HAO (481/4818/485/4858), dépréciations CT
 *     (491/4912, 492..497, 499/4991).
 *   - Classe 5 : valeurs à encaisser (506/512..515), effets escomptés
 *     (564/565), virements internes (581/585/588), dépréciations
 *     (591/599).
 *   - Classe 6 : achats détaillés (6011/6019/6033/6041/6051..6055,
 *     6061/6082), transports (6191), services (6224/623), frais
 *     bancaires (6311..6318), autres charges (651/654/659, 6571,
 *     6593/6594), personnel (6611/6621/6631/6641/6645), frais
 *     financiers (6711/6712, 6741..6748, 675/677/679), dotations
 *     (682, 691/6911/6912/6914/6917, 697/6971/6972).
 *   - Classe 7 : ventes détaillées (7011/7021/7031/7041/7051,
 *     7074/7078), subventions (711..718), production immobilisée
 *     (721/722), variations (734..737), autres produits (74/741/748,
 *     754/7541), revenus financiers (76/7713, 772..775, 779), transferts
 *     (782, 787), reprises (791/7911..7917, 792, 797, 7972).
 *   - Classe 8 : VNC (811/812/816), produits cessions (821/822/826),
 *     charges HAO (831/836..839), produits HAO (841/845/847/848/849),
 *     dotations HAO (851..853, 858), reprises HAO (861..863, 868),
 *     participation (871), subvention équilibre (881), IS exercices
 *     antérieurs (892).
 *
 * Stratégie d'insertion : `INSERT … ON CONFLICT (code) DO NOTHING`,
 * exécuté sur l'intégralité de `OHADA_REFERENCE_CHART`. Les comptes
 * déjà présents (issus de 0011) restent inchangés ; seuls les nouveaux
 * codes seront insérés. Cette approche garantit que :
 *   1. La migration est ré-exécutable sans risque (idempotente).
 *   2. Toute correction ultérieure de libellé sur un compte existant
 *      ne sera PAS écrasée par accident (les corrections passent par
 *      une migration dédiée d'UPDATE).
 *
 * Le `down()` ne supprime QUE les codes ajoutés par cette migration
 * (`NEW_CODES_W11`), pour permettre un rollback propre sans toucher
 * aux 171 comptes de la colonne vertébrale.
 */

// Liste exhaustive des 322 codes ajoutés par W1.1. Cette liste est la
// SOURCE DE VÉRITÉ du `down()` — toute modification de la liste des
// comptes ajoutés DOIT être reflétée ici ET dans le seed.
const NEW_CODES_W11: ReadonlyArray<string> = [
  // Classe 1
  '101',
  '104',
  '105',
  '106',
  '1062',
  '109',
  '111',
  '112',
  '118',
  '121',
  '129',
  '131',
  '1374',
  '139',
  '141',
  '142',
  '148',
  '151',
  '152',
  '154',
  '155',
  '156',
  '161',
  '162',
  '163',
  '164',
  '165',
  '166',
  '167',
  '168',
  '1684',
  '172',
  '173',
  '174',
  '191',
  '192',
  '193',
  '194',
  '195',
  '196',
  '197',
  '198',
  '1984',
  // Classe 2
  '201',
  '202',
  '206',
  '211',
  '212',
  '213',
  '215',
  '218',
  '219',
  '221',
  '222',
  '223',
  '228',
  '229',
  '231',
  '232',
  '233',
  '234',
  '235',
  '238',
  '239',
  '241',
  '244',
  '245',
  '246',
  '248',
  '249',
  '251',
  '252',
  '261',
  '262',
  '265',
  '266',
  '267',
  '271',
  '272',
  '273',
  '2734',
  '274',
  '275',
  '276',
  '278',
  '281',
  '282',
  '283',
  '284',
  '285',
  '291',
  '292',
  '293',
  '294',
  '295',
  '296',
  '297',
  // Classe 3
  '311',
  '321',
  '322',
  '331',
  '332',
  '333',
  '335',
  '341',
  '351',
  '361',
  '371',
  '372',
  '381',
  '388',
  '391',
  '392',
  '393',
  '394',
  '395',
  '396',
  '397',
  // Classe 4
  '4011',
  '4012',
  '403',
  '404',
  '405',
  '4081',
  '4086',
  '4091',
  '4094',
  '4098',
  '4111',
  '4112',
  '4131',
  '4132',
  '4133',
  '414',
  '415',
  '417',
  '4181',
  '4186',
  '4191',
  '4194',
  '4198',
  '4212',
  '4232',
  '4281',
  '4286',
  '4287',
  '4311',
  '4312',
  '4313',
  '4381',
  '4382',
  '4386',
  '4387',
  '4426',
  '4435',
  '4458',
  '4471',
  '4472',
  '4486',
  '4487',
  '4491',
  '4493',
  '4494',
  '4495',
  '4498',
  '451',
  '458',
  '461',
  '462',
  '465',
  '4582',
  '472',
  '473',
  '474',
  '4751',
  '4752',
  '4781',
  '4782',
  '4791',
  '4792',
  '4861',
  '4862',
  '4868',
  '481',
  '4818',
  '485',
  '4858',
  '491',
  '4912',
  '492',
  '493',
  '494',
  '495',
  '496',
  '497',
  '499',
  '4991',
  // Classe 5
  '506',
  '512',
  '513',
  '514',
  '515',
  '564',
  '565',
  '581',
  '585',
  '588',
  '591',
  '599',
  // Classe 6
  '6011',
  '6019',
  '6033',
  '6041',
  '6051',
  '6052',
  '6053',
  '6055',
  '6061',
  '6082',
  '6191',
  '6224',
  '623',
  '6311',
  '6312',
  '6315',
  '6317',
  '6318',
  '651',
  '654',
  '6571',
  '659',
  '6593',
  '6594',
  '6611',
  '6621',
  '6631',
  '6641',
  '6645',
  '6711',
  '6712',
  '6741',
  '6742',
  '6745',
  '6748',
  '675',
  '677',
  '679',
  '682',
  '691',
  '6911',
  '6912',
  '6914',
  '6917',
  '697',
  '6971',
  '6972',
  // Classe 7
  '74',
  '76',
  '7011',
  '7021',
  '7031',
  '7041',
  '7051',
  '7074',
  '7078',
  '711',
  '712',
  '713',
  '718',
  '721',
  '722',
  '734',
  '735',
  '736',
  '737',
  '741',
  '748',
  '7541',
  '7713',
  '772',
  '773',
  '774',
  '775',
  '779',
  '782',
  '787',
  '791',
  '7911',
  '7912',
  '7913',
  '7914',
  '7917',
  '792',
  '797',
  '7972',
  // Classe 8
  '811',
  '812',
  '816',
  '821',
  '822',
  '826',
  '831',
  '836',
  '837',
  '838',
  '839',
  '841',
  '845',
  '847',
  '848',
  '849',
  '851',
  '852',
  '853',
  '858',
  '861',
  '862',
  '863',
  '868',
  '871',
  '881',
  '892',
];

export class SeedSyscohadaAudcifComplete1700000000089 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Insertion par batches de 100 pour rester lisible en log de
    // migration et conserver le même style que 0011. ON CONFLICT
    // DO NOTHING garantit l'idempotence : un re-run ne fait rien.
    const BATCH_SIZE = 100;
    for (let offset = 0; offset < OHADA_REFERENCE_CHART.length; offset += BATCH_SIZE) {
      const batch = OHADA_REFERENCE_CHART.slice(offset, offset + BATCH_SIZE);
      const placeholders: string[] = [];
      const values: unknown[] = [];
      batch.forEach((row, i) => {
        const base = i * 6;
        placeholders.push(
          `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6})`,
        );
        values.push(
          row.code,
          row.label,
          row.class,
          row.account_type,
          row.normal_balance,
          row.applicable_systems,
        );
      });
      await queryRunner.query(
        `INSERT INTO "reference_chart_accounts"
           ("code", "label", "class", "account_type", "normal_balance", "applicable_systems")
         VALUES ${placeholders.join(', ')}
         ON CONFLICT ("code") DO NOTHING`,
        values,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Suppression chirurgicale : seuls les codes ajoutés par W1.1 sont
    // retirés. Les 171 comptes de la colonne vertébrale (migration 0011)
    // restent en place. Utilise ANY($1) pour passer un seul array PG.
    await queryRunner.query(
      `DELETE FROM "reference_chart_accounts" WHERE "code" = ANY($1::text[])`,
      [NEW_CODES_W11],
    );
  }
}
