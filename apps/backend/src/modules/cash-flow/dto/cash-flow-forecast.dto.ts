import {
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MinLength,
} from 'class-validator';

export type CashFlowForecastType = 'inflow' | 'outflow';
export type CashFlowForecastStatus = 'pending' | 'realized' | 'cancelled';

export class CreateCashFlowForecastDto {
  @IsString()
  @MinLength(1, { message: 'Le titre est requis' })
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsEnum(['inflow', 'outflow'])
  type!: CashFlowForecastType;

  @IsString()
  @Matches(/^\d+(\.\d{1,2})?$/, {
    message: 'Montant invalide, utilisez le format décimal (ex: 1500.50)',
  })
  amount!: string;

  @IsISO8601({ strict: true }, { message: 'Date invalide, format YYYY-MM-DD attendu' })
  expectedDate!: string;

  @IsOptional()
  @IsEnum(['pending', 'realized', 'cancelled'])
  status?: CashFlowForecastStatus;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  recurrence?: string;

  @IsOptional()
  @IsUUID()
  bankAccountId?: string;
}

export class UpdateCashFlowForecastDto {
  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'Le titre est requis' })
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(['inflow', 'outflow'])
  type?: CashFlowForecastType;

  @IsOptional()
  @IsString()
  @Matches(/^\d+(\.\d{1,2})?$/, {
    message: 'Montant invalide, utilisez le format décimal (ex: 1500.50)',
  })
  amount?: string;

  @IsOptional()
  @IsISO8601({ strict: true }, { message: 'Date invalide, format YYYY-MM-DD attendu' })
  expectedDate?: string;

  @IsOptional()
  @IsEnum(['pending', 'realized', 'cancelled'])
  status?: CashFlowForecastStatus;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  recurrence?: string;

  @IsOptional()
  @IsUUID()
  bankAccountId?: string;
}

export class CashFlowForecastResponseDto {
  id!: string;
  organizationId!: string;
  title!: string;
  description!: string | null;
  type!: CashFlowForecastType;
  amount!: string;
  expectedDate!: string;
  status!: CashFlowForecastStatus;
  category!: string | null;
  recurrence!: string | null;
  bankAccountId!: string | null;
  createdById!: string | null;
  createdAt!: Date;
  updatedAt!: Date;
}
