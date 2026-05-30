import { Injectable } from '@nestjs/common';
import * as XLSX from 'xlsx';

import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import type { TenantId } from '../../../common/persistence/tenant-scope';
import { BudgetAxisRepository } from '../repositories/budget-axis.repository';
import {
  buildHeaderMap,
  mapTemplateRow,
  type ParsedTemplateRow,
  type RawRecord,
} from '../lib/budget-template';
import { BudgetLinesService } from './budget-lines.service';
import type { BudgetAxisType } from '../types/budget.types';

export interface BudgetImportRowError {
  readonly row: number;
  readonly messages: string[];
}

export interface BudgetImportReport {
  readonly totalRows: number;
  readonly created: number;
  readonly updated: number;
  readonly skipped: number;
  readonly errors: BudgetImportRowError[];
}

/** Cap dur de lignes traitées (anti zip-bomb / classeur géant). */
const MAX_IMPORT_ROWS = 50_000;

@Injectable()
export class BudgetImportService {
  constructor(
    private readonly lines: BudgetLinesService,
    private readonly axes: BudgetAxisRepository,
  ) {}

  /**
   * Parse un classeur (.xlsx/.xls) puis importe ses lignes. Prend la
   * feuille `BUDGET` si elle existe, sinon la première feuille.
   */
  async parseAndImport(
    organizationId: TenantId,
    buffer: Buffer,
    actorUserId: string | null,
  ): Promise<BudgetImportReport> {
    let workbook: XLSX.WorkBook;
    try {
      // `cellFormula: false` neutralise l'évaluation de formules (vecteur
      // d'attaque SheetJS) ; `sheetRows` borne le nombre de lignes lues.
      workbook = XLSX.read(buffer, {
        type: 'buffer',
        cellFormula: false,
        sheetRows: MAX_IMPORT_ROWS + 1,
        raw: false,
      });
    } catch {
      throw new AppException(ERROR_CODES.BUDGET_IMPORT_INVALID_FORMAT, {
        message: 'Fichier illisible (classeur Excel/CSV attendu)',
      });
    }

    const sheetName =
      workbook.SheetNames.find((n) => n.trim().toUpperCase() === 'BUDGET') ??
      workbook.SheetNames[0];
    const sheet = sheetName ? workbook.Sheets[sheetName] : undefined;
    if (!sheet) {
      throw new AppException(ERROR_CODES.BUDGET_IMPORT_EMPTY, {
        message: 'Aucune feuille exploitable dans le classeur',
      });
    }

    const records = XLSX.utils.sheet_to_json<RawRecord>(sheet, { defval: '', raw: false });
    return this.importRecords(organizationId, records, actorUserId);
  }

  /**
   * Importe une liste d'enregistrements déjà parsés (en-tête → valeur).
   * Séparé de la lecture XLSX pour être testable sans I/O fichier.
   */
  async importRecords(
    organizationId: TenantId,
    records: readonly RawRecord[],
    actorUserId: string | null,
  ): Promise<BudgetImportReport> {
    if (records.length === 0) {
      throw new AppException(ERROR_CODES.BUDGET_IMPORT_EMPTY, {
        message: 'Le fichier ne contient aucune ligne de données',
      });
    }
    if (records.length > MAX_IMPORT_ROWS) {
      throw new AppException(ERROR_CODES.BUDGET_IMPORT_INVALID_FORMAT, {
        message: `Trop de lignes (${records.length} > ${MAX_IMPORT_ROWS})`,
      });
    }

    const headerMap = buildHeaderMap(Object.keys(records[0]));
    const axisIndex = await this.buildAxisIndex(organizationId);

    const errors: BudgetImportRowError[] = [];
    let created = 0;
    let updated = 0;

    for (let i = 0; i < records.length; i += 1) {
      const rowNumber = i + 1;
      const mapped = mapTemplateRow(records[i], headerMap);
      if ('errors' in mapped) {
        errors.push({ row: rowNumber, messages: mapped.errors });
        continue;
      }

      const resolution = this.resolveAxes(mapped.row, axisIndex);
      if ('errors' in resolution) {
        errors.push({ row: rowNumber, messages: resolution.errors });
        continue;
      }

      try {
        const result = await this.lines.upsert(organizationId, {
          fiscalYear: mapped.row.fiscalYear,
          periodMonth: mapped.row.periodMonth,
          budgetType: mapped.row.budgetType,
          scenario: mapped.row.scenario,
          accountCode: mapped.row.accountCode,
          accountLabel: mapped.row.accountLabel ?? undefined,
          costCenterAxisId: resolution.ids.costCenterAxisId,
          projectAxisId: resolution.ids.projectAxisId,
          agencyAxisId: resolution.ids.agencyAxisId,
          productAxisId: resolution.ids.productAxisId,
          amount: mapped.row.amount,
          currency: mapped.row.currency,
          exchangeRate: mapped.row.exchangeRate,
          comment: mapped.row.comment ?? undefined,
          hypothesis: mapped.row.hypothesis ?? undefined,
          createdById: actorUserId,
        });
        if (result.action === 'created') created += 1;
        else updated += 1;
      } catch (error: unknown) {
        const message =
          error instanceof AppException ? error.message : 'Erreur inattendue à l’insertion';
        errors.push({ row: rowNumber, messages: [message] });
      }
    }

    return {
      totalRows: records.length,
      created,
      updated,
      skipped: errors.length,
      errors,
    };
  }

  /** Précharge les axes de l'org : `${type}:${code}` → id. */
  private async buildAxisIndex(organizationId: TenantId): Promise<Map<string, string>> {
    const all = await this.axes.list(organizationId, {});
    const index = new Map<string, string>();
    for (const axis of all) {
      index.set(`${axis.axisType}:${axis.code}`, axis.id);
    }
    return index;
  }

  /** Résout les codes d'axe en ids ; code inconnu → erreur de ligne. */
  private resolveAxes(
    row: ParsedTemplateRow,
    axisIndex: Map<string, string>,
  ):
    | {
        ids: {
          costCenterAxisId?: string;
          projectAxisId?: string;
          agencyAxisId?: string;
          productAxisId?: string;
        };
      }
    | { errors: string[] } {
    const errors: string[] = [];
    const resolve = (code: string | null, type: BudgetAxisType): string | undefined => {
      if (!code) return undefined;
      const id = axisIndex.get(`${type}:${code}`);
      if (!id) {
        errors.push(`Axe ${type} "${code}" introuvable (créez-le d'abord)`);
        return undefined;
      }
      return id;
    };

    const ids = {
      costCenterAxisId: resolve(row.costCenterCode, 'cost_center'),
      projectAxisId: resolve(row.projectCode, 'project'),
      agencyAxisId: resolve(row.agencyCode, 'agency'),
      productAxisId: resolve(row.productCode, 'product'),
    };

    if (errors.length > 0) return { errors };
    return { ids };
  }
}
