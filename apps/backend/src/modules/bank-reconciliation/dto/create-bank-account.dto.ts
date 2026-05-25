import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, Length, Matches } from 'class-validator';

import { BANK_ACCOUNT_STATUSES, type BankAccountStatus } from '../types/bank.types';

export class CreateBankAccountDto {
  @ApiProperty({ example: 'BNQ-001' })
  @IsString()
  @Matches(/^[A-Z0-9-]{1,20}$/)
  code!: string;

  @ApiProperty({ example: 'BICICI Compte courant principal' })
  @IsString()
  @Length(1, 200)
  label!: string;

  @ApiProperty({ example: 'BICICI' })
  @IsString()
  @Length(1, 100)
  bankName!: string;

  @ApiPropertyOptional({ example: '0123456789012' })
  @IsOptional()
  @IsString()
  @Length(1, 50)
  accountNumber?: string;

  @ApiPropertyOptional({ example: 'CI93CI0080100100123456789012' })
  @IsOptional()
  @IsString()
  @Length(1, 50)
  iban?: string;

  @ApiPropertyOptional({ example: 'XOF', default: 'XOF' })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{3}$/)
  currency?: string;

  @ApiProperty({ example: 'a1b2c3d4-...' })
  @IsUUID('4')
  chartAccountId!: string;

  @ApiPropertyOptional({ example: '0.00', default: '0.00' })
  @IsOptional()
  @IsString()
  @Matches(/^-?\d+(\.\d{1,2})?$/)
  openingBalance?: string;

  @ApiPropertyOptional({ enum: BANK_ACCOUNT_STATUSES, default: 'active' })
  @IsOptional()
  @IsIn(BANK_ACCOUNT_STATUSES as ReadonlyArray<string>)
  status?: BankAccountStatus;
}
