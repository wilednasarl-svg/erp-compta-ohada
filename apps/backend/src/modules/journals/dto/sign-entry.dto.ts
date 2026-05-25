import { IsOptional, IsString, MaxLength } from 'class-validator';

export class SignEntryDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;
}
