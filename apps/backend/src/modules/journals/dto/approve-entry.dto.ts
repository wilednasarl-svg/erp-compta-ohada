import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ApproveEntryDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;
}
