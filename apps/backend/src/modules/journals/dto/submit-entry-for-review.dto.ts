import { IsOptional, IsString, MaxLength } from 'class-validator';

export class SubmitEntryForReviewDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;
}
