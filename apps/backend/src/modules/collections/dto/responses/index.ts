import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ReceivableDetailRowResponse {
  @ApiProperty() partnerAccountId!: string;
  @ApiProperty() partnerCode!: string;
  @ApiProperty() partnerLabel!: string;
  @ApiPropertyOptional({ nullable: true }) invoiceNumber!: string | null;
  @ApiPropertyOptional({ nullable: true }) dueDate!: string | null;
  @ApiProperty({ description: 'Montant net (string DECIMAL)', example: '1200000.00' })
  amount!: string;
  @ApiPropertyOptional({ type: Number, nullable: true, description: 'Jours de retard (null si sans échéance)' })
  overdueDays!: number | null;
  @ApiProperty({ description: 'Tranche d’ancienneté', example: 'd31_60' })
  bucket!: string;
}

export class ReceivablesDetailResponse {
  @ApiProperty() referenceDate!: string;
  @ApiProperty({ type: [ReceivableDetailRowResponse] })
  rows!: ReceivableDetailRowResponse[];
}

export class DunningCandidateResponse {
  @ApiProperty() partnerAccountId!: string;
  @ApiProperty() partnerCode!: string;
  @ApiProperty() partnerLabel!: string;
  @ApiProperty({ example: '1500000.00' }) totalOpen!: string;
  @ApiProperty({ example: '600000.00' }) totalOverdue!: string;
  @ApiProperty({ type: Number, example: 42 }) maxOverdueDays!: number;
  @ApiProperty({ example: 'first' }) level!: string;
  @ApiProperty({ example: '1re relance' }) levelLabel!: string;
  @ApiProperty({ type: Number }) invoiceCount!: number;
  @ApiProperty({ type: Number }) overdueInvoiceCount!: number;
}

export class DunningCandidatesResponse {
  @ApiProperty() referenceDate!: string;
  @ApiProperty({ type: [DunningCandidateResponse] })
  candidates!: DunningCandidateResponse[];
}

export class DunningLetterResponse {
  @ApiProperty() subject!: string;
  @ApiProperty({ description: 'Corps texte de la lettre (sauts de ligne \\n)' })
  body!: string;
}
