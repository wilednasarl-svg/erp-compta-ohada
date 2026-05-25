import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

export class RejectEntryDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}
