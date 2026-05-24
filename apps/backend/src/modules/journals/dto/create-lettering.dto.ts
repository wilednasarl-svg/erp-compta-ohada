import { ApiProperty } from '@nestjs/swagger';
import { ArrayMinSize, ArrayUnique, IsArray, IsUUID } from 'class-validator';

export class CreateLetteringDto {
  @ApiProperty({
    description:
      'IDs of `journal_entry_lines` to reconcile together. Must be at least 2, all on the same partner account, balanced (sum debit == sum credit), and not already lettered.',
    type: [String],
    example: ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'],
  })
  @IsArray()
  @ArrayMinSize(2)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  journalEntryLineIds!: string[];
}
