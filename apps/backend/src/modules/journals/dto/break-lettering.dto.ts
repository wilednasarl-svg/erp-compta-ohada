import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class BreakLetteringDto {
  @ApiProperty({ description: 'Reason for breaking the lettering (audit trail).' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}
