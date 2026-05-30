import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumberString, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

/**
 * Mise à jour d'une ligne budgétaire. La clé naturelle (exercice, période,
 * compte, axes, type, scénario) n'est PAS modifiable — supprimer/recréer
 * pour la changer. Seuls montant, devise, taux et annotations évoluent.
 */
export class UpdateBudgetLineDto {
  @ApiPropertyOptional({ description: 'Libellé du compte' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  accountLabel?: string;

  @ApiPropertyOptional({ description: 'Montant budgété (string NUMERIC)' })
  @IsOptional()
  @IsNumberString({ no_symbols: false })
  @Matches(/^-?\d{1,16}(\.\d{1,2})?$/)
  amount?: string;

  @ApiPropertyOptional({ description: 'Devise ISO 4217' })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{3}$/)
  currency?: string;

  @ApiPropertyOptional({ description: 'Taux de change vers XOF' })
  @IsOptional()
  @IsNumberString({ no_symbols: false })
  @Matches(/^\d{1,6}(\.\d{1,6})?$/)
  exchangeRate?: string;

  @ApiPropertyOptional({ description: 'Commentaire' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;

  @ApiPropertyOptional({ description: 'Hypothèse de construction' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  hypothesis?: string;
}
