import { Injectable } from '@nestjs/common';
import * as XLSX from 'xlsx';

import type { TenantId } from '../../../common/persistence/tenant-scope';
import { BUDGET_TEMPLATE_HEADERS } from '../lib/budget-template';
import type { BudgetLineEntity } from '../entities/budget-line.entity';
import { BudgetAxisRepository } from '../repositories/budget-axis.repository';

/** Exemples pédagogiques injectés dans le template vierge (comptes SYSCOHADA). */
const EXAMPLE_ROWS: readonly (readonly (string | number)[])[] = [
  [
    2026,
    '2026-01',
    'OPEX',
    'BI',
    '7011',
    'Ventes de marchandises',
    'COMM',
    '',
    '',
    '',
    45000000,
    'XOF',
    1,
    'Objectif Q1',
    '',
  ],
  [
    2026,
    '2026-01',
    'OPEX',
    'BI',
    '6011',
    'Achats de marchandises',
    'LOG',
    '',
    '',
    '',
    27000000,
    'XOF',
    1,
    'Marge cible 40%',
    '',
  ],
  [
    2026,
    '2026-01',
    'OPEX',
    'BI',
    '6221',
    'Locations immobilières',
    'COMM',
    '',
    'ABJ-PLAT',
    '',
    1500000,
    'XOF',
    1,
    'Loyer Plateau',
    '',
  ],
  [
    2026,
    '2026-04',
    'CAPEX',
    'BI',
    '2441',
    'Matériel informatique',
    'IT',
    'PRJ-2026-001',
    '',
    '',
    12000000,
    'XOF',
    1,
    '30 postes',
    '',
  ],
  [
    2026,
    '2026-01',
    'RH',
    'BI',
    '6611',
    'Appointements salaires',
    'RH',
    '',
    '',
    '',
    18000000,
    'XOF',
    1,
    '42 agents',
    '',
  ],
];

/** Notice expliquant chaque colonne (feuille NOTICE du classeur). */
const NOTICE_ROWS: readonly (readonly string[])[] = [
  ['Colonne', 'Obligatoire', 'Description'],
  ['exercice', 'Oui', 'Année budgétaire (AAAA), ex. 2026'],
  ['periode', 'Non', 'AAAA-MM (mensuel) ou vide (annuel). Ex. 2026-03'],
  ['type_budget', 'Oui', 'OPEX | CAPEX | TRESO | RH'],
  ['scenario', 'Non', 'BI (budget initial) | BR (révisé) | REAL (réalisé). Défaut BI'],
  ['code_compte', 'Oui', 'Compte SYSCOHADA (1-12 chiffres), ex. 6221'],
  ['libelle_compte', 'Non', 'Libellé du compte'],
  ['code_cc', 'Non', 'Code centre de coût (doit exister comme axe cost_center)'],
  ['code_projet', 'Non', 'Code projet (axe project)'],
  ['code_agence', 'Non', 'Code agence (axe agency)'],
  ['code_produit', 'Non', 'Code produit (axe product)'],
  ['montant_budgete', 'Oui', 'Montant signé (négatif autorisé pour décaissements). Ex. 1500000.00'],
  ['devise', 'Non', 'ISO 4217. Défaut XOF'],
  ['taux_change', 'Non', 'Taux vers XOF. Défaut 1'],
  ['commentaire', 'Non', 'Commentaire libre'],
  ['hypothese', 'Non', 'Hypothèse de construction'],
];

@Injectable()
export class BudgetTemplateService {
  constructor(private readonly axes: BudgetAxisRepository) {}

  /** Génère le template vierge documenté (feuilles BUDGET + NOTICE). */
  buildTemplate(): Buffer {
    const budgetRows: (string | number)[][] = [
      [...BUDGET_TEMPLATE_HEADERS],
      ...EXAMPLE_ROWS.map((r) => [...r]),
    ];
    const budgetSheet = XLSX.utils.aoa_to_sheet(budgetRows);
    const noticeSheet = XLSX.utils.aoa_to_sheet(NOTICE_ROWS.map((r) => [...r]));

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, budgetSheet, 'BUDGET');
    XLSX.utils.book_append_sheet(wb, noticeSheet, 'NOTICE');
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  }

  /** Exporte des lignes budgétaires au format plat (réimportable tel quel). */
  async exportLines(organizationId: TenantId, lines: readonly BudgetLineEntity[]): Promise<Buffer> {
    const codeById = await this.buildAxisCodeIndex(organizationId);
    const code = (id: string | null): string => (id ? (codeById.get(id) ?? '') : '');

    const rows: (string | number)[][] = [[...BUDGET_TEMPLATE_HEADERS]];
    for (const line of lines) {
      rows.push([
        line.fiscalYear,
        line.periodMonth ? `${line.fiscalYear}-${String(line.periodMonth).padStart(2, '0')}` : '',
        line.budgetType,
        line.scenario,
        line.accountCode,
        line.accountLabel ?? '',
        code(line.costCenterAxisId),
        code(line.projectAxisId),
        code(line.agencyAxisId),
        code(line.productAxisId),
        line.amount,
        line.currency,
        line.exchangeRate,
        line.comment ?? '',
        line.hypothesis ?? '',
      ]);
    }

    const sheet = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, 'BUDGET');
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  }

  private async buildAxisCodeIndex(organizationId: TenantId): Promise<Map<string, string>> {
    const all = await this.axes.list(organizationId, {});
    const index = new Map<string, string>();
    for (const axis of all) index.set(axis.id, axis.code);
    return index;
  }
}
