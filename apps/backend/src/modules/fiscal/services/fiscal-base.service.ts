import { Injectable } from '@nestjs/common';

import type { TenantId } from '../../../common/persistence/tenant-scope';
import { periodBounds, subtractAmounts } from '../lib/fiscal-calc';
import { FiscalBaseRepository } from '../repositories/fiscal-base.repository';
import type { FiscalBaseKind } from '../types/fiscal.types';

/**
 * Dérive la base imposable depuis la comptabilité réelle (écritures
 * validées), selon le `base_kind` du paramètre fiscal.
 *
 * Conventions de signe SYSCOHADA :
 *   - produits (classe 7) : solde créditeur → crédit − débit
 *   - charges (classe 6)  : solde débiteur  → débit − crédit
 *   - TVA collectée (443) : crédit − débit  ; déductible (445) : débit − crédit
 *
 * ⚠️ `salary_capped` renvoie ici la masse salariale BRUTE agrégée — le
 * plafonnement CNPS est par salarié et ne peut être appliqué exactement au
 * niveau agrégé. Le plafond du paramètre s'applique ensuite sur le total
 * (exact pour un effectif réduit, approché sinon). Préférer une base saisie
 * ou le futur module RH pour un plafonnement par tête.
 */
@Injectable()
export class FiscalBaseService {
  constructor(private readonly base: FiscalBaseRepository) {}

  async computeBase(
    organizationId: TenantId,
    baseKind: FiscalBaseKind,
    periodYear: number,
    periodMonth: number | null,
  ): Promise<string> {
    const { fromDate, toDate } = periodBounds(periodYear, periodMonth);

    switch (baseKind) {
      case 'turnover':
        return this.creditMinusDebit(organizationId, fromDate, toDate, ['7']);

      case 'salary_gross':
      case 'salary_capped':
        return this.debitMinusCredit(organizationId, fromDate, toDate, ['66']);

      case 'accounting_result': {
        const produits = await this.creditMinusDebit(organizationId, fromDate, toDate, ['7']);
        const charges = await this.debitMinusCredit(organizationId, fromDate, toDate, ['6']);
        return subtractAmounts(produits, charges);
      }

      case 'vat_net': {
        const collectee = await this.creditMinusDebit(organizationId, fromDate, toDate, ['443']);
        const deductible = await this.debitMinusCredit(organizationId, fromDate, toDate, ['445']);
        return subtractAmounts(collectee, deductible);
      }

      case 'custom':
      default:
        return '0.00';
    }
  }

  private async creditMinusDebit(
    organizationId: TenantId,
    fromDate: string,
    toDate: string,
    prefixes: readonly string[],
  ): Promise<string> {
    const sum = await this.base.sumByPrefixes(organizationId, fromDate, toDate, prefixes);
    return subtractAmounts(sum.totalCredit, sum.totalDebit);
  }

  private async debitMinusCredit(
    organizationId: TenantId,
    fromDate: string,
    toDate: string,
    prefixes: readonly string[],
  ): Promise<string> {
    const sum = await this.base.sumByPrefixes(organizationId, fromDate, toDate, prefixes);
    return subtractAmounts(sum.totalDebit, sum.totalCredit);
  }
}
