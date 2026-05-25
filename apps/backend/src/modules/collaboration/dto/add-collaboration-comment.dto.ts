import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * `POST /collaboration/requests/:id/comments` body. L'`authorId` est
 * dérivé du JWT côté controller — interdit ici.
 */
export class AddCollaborationCommentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(10_000)
  body!: string;
}
