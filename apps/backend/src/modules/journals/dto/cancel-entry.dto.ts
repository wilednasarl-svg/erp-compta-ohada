import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CancelEntryDto {
  @ApiProperty({ description: 'Motif de la contre-passation' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}
