import { IsOptional, IsString, MaxLength } from 'class-validator';

export class SubmitForReviewDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;
}
