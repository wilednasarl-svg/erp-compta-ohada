import {
  IsDateString,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * `POST /collaboration/requests` body. Le `requesterId` est dérivé du
 * JWT côté controller — interdit ici pour empêcher l'usurpation.
 *
 * Au moins un destinataire identifié est attendu (`assigneeId`), sauf
 * cas broadcast (laissé optionnel pour la flexibilité MVP : un agent
 * cabinet peut créer une demande « ouverte » que le client viendra
 * récupérer via la liste).
 */
export class CreateCollaborationRequestDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @IsOptional()
  @IsUUID('4')
  assigneeId?: string;

  @IsOptional()
  @IsUUID('4')
  linkedEntryId?: string;

  @IsOptional()
  @IsUUID('4')
  linkedDocumentId?: string;

  /**
   * ISO date (YYYY-MM-DD). Pas de timestamp — la due-date est une date
   * comptable, pas un événement précis dans la journée.
   */
  @IsOptional()
  @IsDateString()
  dueDate?: string;
}
