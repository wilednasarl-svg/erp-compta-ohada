import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';

/**
 * W3.3 — Cession d'immobilisation SYSCOHADA (App. 33 / 66 / 110, Tome 1 G04).
 *
 * Deux régimes comptables possibles, selon le caractère récurrent ou
 * exceptionnel de la cession :
 *   - `recurring` : cession « courante » (loueur/transporteur dont la
 *     revente fait partie du métier) — utilise 654 (VNC sortie courante)
 *     et 754 (produit cession courante).
 *   - `hao` : cession « hors activité ordinaire » — utilise 812 (VNC HAO)
 *     et 822 (produit HAO).
 *
 * `proceedsAmount` est obligatoire (mais peut valoir `'0.00'` en cas de
 * mise au rebut pur — aucune écriture de produit ne sera alors générée).
 */
export const DISPOSAL_KINDS = ['recurring', 'hao'] as const;
export type DisposalKind = (typeof DISPOSAL_KINDS)[number];

export class DisposeAssetDto {
  @ApiProperty({
    description: 'Date effective de cession ou de mise au rebut (YYYY-MM-DD).',
    example: '2026-09-30',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'disposalDate must be YYYY-MM-DD' })
  disposalDate!: string;

  @ApiProperty({
    description:
      'Prix de cession HT en monnaie locale (DECIMAL). Utiliser "0.00" pour une mise au rebut.',
    example: '500000.00',
  })
  @IsString()
  @IsNotEmpty()
  @IsNumberString()
  proceedsAmount!: string;

  @ApiProperty({
    description:
      'Régime SYSCOHADA : "recurring" pour cession courante (654/754), "hao" pour cession exceptionnelle (812/822).',
    enum: DISPOSAL_KINDS,
    example: 'hao',
  })
  @IsIn(DISPOSAL_KINDS as unknown as string[])
  disposalKind!: DisposalKind;

  @ApiPropertyOptional({
    description:
      'Compte de contrepartie pour le prix de cession. Par défaut "5121" (banque, paiement immédiat) en recurring, "485" (créance HAO) en hao. Surcharger par exemple "411xxx" pour facturation client.',
    example: '5121',
  })
  @IsOptional()
  @IsString()
  proceedsAccountCode?: string;

  @ApiPropertyOptional({
    description: 'Note libre archivée dans la piste d\'audit.',
  })
  @IsOptional()
  @IsString()
  note?: string;
}

/**
 * Codes SYSCOHADA mobilisés selon le régime de cession. Centralisés ici
 * pour éviter les "magic strings" éparpillés dans le service. Sont les
 * codes parent (3 chiffres) ; la résolution exacte en fonction du plan
 * comptable de l'organisation se fait dans `AssetsService` qui charge
 * le compte par `findByCode`.
 */
export const DISPOSAL_ACCOUNT_CODES: Readonly<
  Record<DisposalKind, { vnc: string; proceeds: string; defaultProceedsAccount: string }>
> = {
  recurring: {
    vnc: '654', // VNC sortie courante (charge).
    proceeds: '754', // Produit cession courante.
    defaultProceedsAccount: '5121', // Banque — paiement immédiat.
  },
  hao: {
    vnc: '812', // VNC HAO (charge).
    proceeds: '822', // Produit HAO.
    defaultProceedsAccount: '485', // Créance sur cession HAO.
  },
};
