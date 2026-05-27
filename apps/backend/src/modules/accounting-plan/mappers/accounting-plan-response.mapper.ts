import type { AccountView } from '../services/chart-of-accounts.service';
import type { ReferenceAccountView } from '../services/reference-chart.service';
import {
  AccountEnvelopeResponse,
  AccountViewResponse,
  ImportChartResponse,
  ListAccountsResponse,
  ListReferenceAccountsResponse,
  ReferenceAccountViewResponse,
} from '../dto/responses';

export function toAccountViewResponse(view: AccountView): AccountViewResponse {
  return {
    id: view.id,
    code: view.code,
    label: view.label,
    class: view.class,
    accountType: view.accountType,
    normalBalance: view.normalBalance,
    parentId: view.parentId,
    isCustom: view.isCustom,
    isActive: view.isActive,
  };
}

export function toListAccounts(
  views: ReadonlyArray<AccountView>,
): ListAccountsResponse {
  return { accounts: views.map(toAccountViewResponse) };
}

export function toAccountEnvelope(view: AccountView): AccountEnvelopeResponse {
  return { account: toAccountViewResponse(view) };
}

export function toImportChart(result: {
  added: number;
  skipped: number;
}): ImportChartResponse {
  return { added: result.added, skipped: result.skipped };
}

export function toReferenceAccountViewResponse(
  view: ReferenceAccountView,
): ReferenceAccountViewResponse {
  return {
    id: view.id,
    code: view.code,
    label: view.label,
    class: view.class,
    accountType: view.accountType,
    normalBalance: view.normalBalance,
    applicableSystems: view.applicableSystems,
  };
}

export function toListReferenceAccounts(
  views: ReadonlyArray<ReferenceAccountView>,
): ListReferenceAccountsResponse {
  return { accounts: views.map(toReferenceAccountViewResponse) };
}
