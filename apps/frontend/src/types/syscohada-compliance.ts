/**
 * Types du rapport de conformité SYSCOHADA (moteur AUDCIF).
 *
 * Miroir de `SyscohadaComplianceService` (backend) : l'endpoint
 * `GET /organizations/:id/syscohada-compliance` évalue un catalogue de
 * contrôles exécutables sur les données réelles de l'exercice et renvoie,
 * pour chaque contrôle, un statut, l'éventuelle anomalie détectée, l'article
 * de l'Acte uniforme qui le fonde et la recommandation de correction.
 */
import type { SyscohadaControlWithEvidence, SyscohadaDomain } from './syscohada-knowledge';

export type ComplianceStatus = 'pass' | 'fail' | 'not_evaluable';

/** `compliant` = tout conforme · `partial` = sous réserves (warnings/info ou
 *  contrôle non évaluable) · `non_compliant` = un contrôle BLOQUANT échoue. */
export type ComplianceVerdict = 'compliant' | 'non_compliant' | 'partial';

export interface ComplianceCheckResult {
  readonly controlId: string;
  readonly domain: SyscohadaDomain;
  readonly status: ComplianceStatus;
  readonly detail: string;
  readonly data?: Readonly<Record<string, unknown>>;
  readonly control: SyscohadaControlWithEvidence | null;
  /** « Comment corriger » — présent seulement quand le contrôle échoue. */
  readonly recommendation: string | null;
}

export interface SyscohadaComplianceReport {
  readonly organizationId: string;
  readonly fiscalYearStartDate: string;
  readonly asAtDate: string;
  readonly evaluatedAt: string;
  readonly verdict: ComplianceVerdict;
  readonly counts: {
    readonly pass: number;
    readonly fail: number;
    readonly notEvaluable: number;
  };
  readonly results: ReadonlyArray<ComplianceCheckResult>;
}

export interface SyscohadaComplianceResponse {
  readonly report: SyscohadaComplianceReport;
}
