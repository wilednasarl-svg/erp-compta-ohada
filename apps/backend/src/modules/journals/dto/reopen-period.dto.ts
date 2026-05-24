import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ReopenPeriodDto {
  @ApiProperty({ description: 'Motif de reouverture obligatoire' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}
