/**
 * Wire types for the Module 2 plan comptable OHADA endpoints. Mirrors
 * `apps/backend/src/modules/accounting-plan/services/chart-of-accounts.service.ts#AccountView`
 * and the reference catalogue projection. Drift from the backend is a
 * bug — keep in sync.
 */

export const ACCOUNTING_SYSTEMS = ['NORMAL', 'MINIMAL', 'ALLEGE'] as const;
export type AccountingSystem = (typeof ACCOUNTING_SYSTEMS)[number];

export const ACCOUNTING_SYSTEM_LABELS: Record<AccountingSystem, string> = {
  NORMAL: 'Système Normal',
  MINIMAL: 'Système Minimal de Trésorerie',
  ALLEGE: 'Système Allégé',
};

export type AccountType = 'TITLE' | 'POSTING';
export type NormalBalance = 'D' | 'C';

export interface AccountView {
  readonly id: string;
  readonly code: string;
  readonly label: string;
  readonly class: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  readonly accountType: AccountType;
  readonly normalBalance: NormalBalance;
  readonly parentId: string | null;
  readonly isCustom: boolean;
  readonly isActive: boolean;
}

export interface ReferenceAccountView {
  readonly id: string;
  readonly code: string;
  readonly label: string;
  readonly class: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  readonly accountType: AccountType;
  readonly normalBalance: NormalBalance;
  readonly applicableSystems: ReadonlyArray<AccountingSystem>;
}
