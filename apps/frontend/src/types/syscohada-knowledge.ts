export type SyscohadaDomain =
  | 'accounting-plan'
  | 'journals'
  | 'assets'
  | 'inventory'
  | 'tva'
  | 'reports'
  | 'leases'
  | 'provisions'
  | 'impairments'
  | 'subsidies'
  | 'actuarial-commitments'
  | 'regularizations'
  | 'transformations'
  | 'bills-of-exchange'
  | 'multi-currency'
  | 'pledged-assets'
  | 'cash-flow'
  | 'bank-reconciliation'
  | 'ai';

export interface SyscohadaCitation {
  readonly tome: number;
  readonly sourceTitle: string;
  readonly sourceFile: string;
  readonly lineStart: number;
  readonly lineEnd: number;
}

export interface SyscohadaSearchResult extends SyscohadaCitation {
  readonly excerpt: string;
  readonly score: number;
}

export interface SyscohadaDomainReference {
  readonly domain: SyscohadaDomain;
  readonly tome: number;
  readonly topic: string;
  readonly keywords: ReadonlyArray<string>;
}

export type SyscohadaControlSeverity = 'blocking' | 'warning' | 'info';

export interface SyscohadaControl {
  readonly id: string;
  readonly domain: SyscohadaDomain;
  readonly label: string;
  readonly description: string;
  readonly severity: SyscohadaControlSeverity;
  readonly legalBasis: ReadonlyArray<string>;
  readonly tome: number;
  readonly evidenceQuery: string;
}

export interface SyscohadaControlWithEvidence extends SyscohadaControl {
  readonly citation: SyscohadaSearchResult | null;
}

export interface SyscohadaModuleGuidance {
  readonly domain: SyscohadaDomain;
  readonly references: ReadonlyArray<SyscohadaDomainReference>;
  readonly controls: ReadonlyArray<SyscohadaControlWithEvidence>;
  readonly evidence: ReadonlyArray<SyscohadaSearchResult>;
}

export interface ListSyscohadaDomainsResponse {
  readonly domains: ReadonlyArray<SyscohadaModuleGuidance>;
}

export interface SearchSyscohadaKnowledgeResponse {
  readonly results: ReadonlyArray<SyscohadaSearchResult>;
}

export interface ListSyscohadaControlsResponse {
  readonly domain: SyscohadaDomain;
  readonly controls: ReadonlyArray<SyscohadaControlWithEvidence>;
}
