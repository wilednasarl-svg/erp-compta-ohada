import { ApiProperty } from '@nestjs/swagger';
import {
  IsInt,
  IsNotEmpty,
  IsNumberString,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class UpsertPayrollLineDto {
  @ApiProperty({ example: 2026 })
  @IsInt()
  @Min(2000)
  @Max(2200)
  periodYear!: number;

  @ApiProperty({ example: 3, description: 'Mois 1-12' })
  @IsInt()
  @Min(1)
  @Max(12)
  periodMonth!: number;

  @ApiProperty({ example: 'MAT-001', description: 'Matricule / référence salarié' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  employeeRef!: string;

  @ApiProperty({ example: '350000.00', description: 'Salaire brut du mois' })
  @IsNumberString({ no_symbols: false })
  @Matches(/^\d{1,16}(\.\d{1,2})?$/)
  grossSalary!: string;
}
