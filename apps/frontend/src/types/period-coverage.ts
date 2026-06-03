/**
 * Couverture en périodes comptables d'une plage de dates — miroir de
 * `PeriodsService.analyzeCoverage` / `ensureFiscalYearsForRange` (backend).
 * Sert à proposer, à l'import, la création des exercices manquants couvrant
 * les dates des écritures importées.
 */
export interface PeriodCoverageYear {
  readonly year: number;
  readonly present: boolean;
}

export interface ClosedPeriodConflict {
  readonly id: string;
  readonly label: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly kind: string;
}

export interface PeriodCoverageGaps {
  readonly fromDate: string;
  readonly toDate: string;
  readonly years: ReadonlyArray<PeriodCoverageYear>;
  readonly missingYears: ReadonlyArray<number>;
  readonly closedConflicts: ReadonlyArray<ClosedPeriodConflict>;
  readonly hasGaps: boolean;
}

export interface CoverageResponse {
  readonly coverage: PeriodCoverageGaps;
}

export interface EnsureCoverageResult {
  readonly createdYears: ReadonlyArray<number>;
  readonly existingYears: ReadonlyArray<number>;
}

export interface EnsureCoverageResponse {
  readonly result: EnsureCoverageResult;
}
