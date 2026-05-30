import { Injectable } from '@nestjs/common';

import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import type { TenantId } from '../../../common/persistence/tenant-scope';
import { FiscalTaxBracketEntity } from '../entities/fiscal-tax-bracket.entity';
import {
  FiscalTaxBracketRepository,
  type BracketInput,
} from '../repositories/fiscal-tax-bracket.repository';
import { CI_DEFAULT_ITS_BRACKETS } from '../types/fiscal.types';

@Injectable()
export class FiscalBracketsService {
  constructor(private readonly brackets: FiscalTaxBracketRepository) {}

  async list(organizationId: TenantId, taxCode: string): Promise<FiscalTaxBracketEntity[]> {
    return this.brackets.list(organizationId, taxCode);
  }

  /**
   * Remplace le barème d'un impôt à une date d'effet après validation :
   * ordres uniques et croissants, bornes ascendantes et non chevauchantes,
   * une seule tranche ouverte (en dernier).
   */
  async replace(
    organizationId: TenantId,
    taxCode: string,
    effectiveFrom: string,
    brackets: ReadonlyArray<BracketInput>,
  ): Promise<FiscalTaxBracketEntity[]> {
    this.validate(brackets);
    return this.brackets.replace(organizationId, taxCode, effectiveFrom, brackets);
  }

  /**
   * Seede le barème ITS CI par défaut pour l'exercice (1er janvier), si aucun
   * barème n'existe déjà à cette date. Retourne le nombre de tranches créées.
   */
  async seedItsDefaults(
    organizationId: TenantId,
    fiscalYear: number,
  ): Promise<{ created: number }> {
    const effectiveFrom = `${fiscalYear}-01-01`;
    const existing = await this.brackets.countForDate(organizationId, 'ITS', effectiveFrom);
    if (existing > 0) return { created: 0 };
    const saved = await this.brackets.replace(
      organizationId,
      'ITS',
      effectiveFrom,
      CI_DEFAULT_ITS_BRACKETS.map((b) => ({ ...b })),
    );
    return { created: saved.length };
  }

  private validate(brackets: ReadonlyArray<BracketInput>): void {
    if (brackets.length === 0) {
      throw new AppException(ERROR_CODES.FISCAL_BRACKET_INVALID, {
        message: 'Au moins une tranche est requise',
      });
    }
    const sorted = [...brackets].sort((a, b) => a.bracketOrder - b.bracketOrder);
    let previousUpper: number | null = 0;
    for (let i = 0; i < sorted.length; i += 1) {
      const b = sorted[i];
      const from = Number(b.fromAmount);
      const to = b.toAmount == null ? null : Number(b.toAmount);
      const isLast = i === sorted.length - 1;

      if (previousUpper !== null && from !== previousUpper) {
        throw new AppException(ERROR_CODES.FISCAL_BRACKET_INVALID, {
          message: `Tranche ${b.bracketOrder} : borne inférieure ${from} ≠ borne supérieure précédente ${previousUpper}`,
          details: { bracketOrder: b.bracketOrder },
        });
      }
      if (to !== null && to <= from) {
        throw new AppException(ERROR_CODES.FISCAL_BRACKET_INVALID, {
          message: `Tranche ${b.bracketOrder} : borne supérieure ≤ inférieure`,
          details: { bracketOrder: b.bracketOrder },
        });
      }
      if (to === null && !isLast) {
        throw new AppException(ERROR_CODES.FISCAL_BRACKET_INVALID, {
          message: 'Seule la dernière tranche peut être ouverte (sans borne supérieure)',
          details: { bracketOrder: b.bracketOrder },
        });
      }
      previousUpper = to;
    }
  }
}
