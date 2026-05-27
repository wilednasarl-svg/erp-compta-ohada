import { ApiProperty } from '@nestjs/swagger';

import type {
  AgingBalanceReport,
  AnalyticAxisSummary,
  AnnexeNoteDetailReport,
  AnnexeReport,
  BalanceSheetReport,
  CashTrendReport,
  ComparativeBalanceReport,
  FinancialRatiosReport,
  GeneralLedgerReport,
  ImportDiagnosticReport,
  MarginByAxisReport,
  MultiYearBalanceReport,
  ProfitLossReport,
  SigReport,
  TrialBalanceReport,
} from '../../services/reports.service';
import type { CashFlowReport } from '../../services/cash-flow.service';
import type { DsfValidationReport } from '../../services/dsf-validator.service';

export class TrialBalanceReportEnvelope {
  @ApiProperty({ type: 'object', description: 'Balance générale OHADA' })
  report!: TrialBalanceReport;
}

export class ComparativeBalanceReportEnvelope {
  @ApiProperty({ type: 'object', description: 'Balance comparative N / N-1' })
  report!: ComparativeBalanceReport;
}

export class MultiYearBalanceReportEnvelope {
  @ApiProperty({ type: 'object', description: 'Balance pluri-exercices' })
  report!: MultiYearBalanceReport;
}

export class GeneralLedgerReportEnvelope {
  @ApiProperty({ type: 'object', description: 'Grand livre d\'un compte' })
  report!: GeneralLedgerReport;
}

export class ProfitLossReportEnvelope {
  @ApiProperty({ type: 'object', description: 'Compte de résultat' })
  report!: ProfitLossReport;
}

export class SigReportEnvelope {
  @ApiProperty({ type: 'object', description: 'Soldes Intermédiaires de Gestion' })
  report!: SigReport;
}

export class BalanceSheetReportEnvelope {
  @ApiProperty({ type: 'object', description: 'Bilan OHADA' })
  report!: BalanceSheetReport;
}

export class TftReportEnvelope {
  @ApiProperty({ type: 'object', description: 'Tableau Flux Trésorerie (CashFlowReport — Tome 3 p. 34)' })
  report!: CashFlowReport;
}

export class AnnexeReportEnvelope {
  @ApiProperty({ type: 'object', description: 'Annexe Notes 1-36 SYSCOHADA' })
  report!: AnnexeReport;
}

export class AnnexeNoteDetailReportEnvelope {
  @ApiProperty({ type: 'object', description: 'Détail d\'une note d\'annexe' })
  report!: AnnexeNoteDetailReport;
}

export class AgingBalanceReportEnvelope {
  @ApiProperty({ type: 'object', description: 'Balance âgée clients ou fournisseurs' })
  report!: AgingBalanceReport;
}

export class CashTrendReportEnvelope {
  @ApiProperty({ type: 'object', description: 'Trésorerie nette glissante mois par mois' })
  report!: CashTrendReport;
}

export class FinancialRatiosReportEnvelope {
  @ApiProperty({ type: 'object', description: 'Ratios financiers SYSCOHADA' })
  report!: FinancialRatiosReport;
}

export class MarginByAxisReportEnvelope {
  @ApiProperty({ type: 'object', description: 'Marge brute par axe analytique' })
  report!: MarginByAxisReport;
}

export class ImportDiagnosticReportEnvelope {
  @ApiProperty({ type: 'object', description: 'Diagnostic de session d\'import' })
  report!: ImportDiagnosticReport;
}

export class DsfValidationReportEnvelope {
  @ApiProperty({ type: 'object', description: 'Rapport de validation pré-dépôt DSF' })
  report!: DsfValidationReport;
}

export class AnalyticAxisSummaryListResponse {
  @ApiProperty({ type: 'object', isArray: true, description: 'Axes analytiques utilisés' })
  axes!: AnalyticAxisSummary[];
}
