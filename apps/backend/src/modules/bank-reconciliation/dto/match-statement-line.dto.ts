import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsUUID } from 'class-validator';

export class MatchStatementLineDto {
  @ApiProperty({
    description:
      'UUIDs of the journal entry lines to match. Wave 1: 1:1 only — exactly one. Wave 2 will allow N for grouped operations.',
    example: ['a1b2c3d4-e5f6-7890-abcd-ef1234567890'],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1)
  @IsUUID('4', { each: true })
  journalEntryLineIds!: string[];
}
