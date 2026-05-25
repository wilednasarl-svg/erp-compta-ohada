import { Injectable } from '@nestjs/common';
import JSZip from 'jszip';

import { type TenantId, assertTenantId } from '../../../common/persistence/tenant-scope';
import { ReportsService } from './reports.service';
import { ReportsXlsxService } from './reports-xlsx.service';

/**
 * Génère un dossier annuel SYSCOHADA complet en un ZIP unique.
 *
 * Bundle livré (V1) :
 *   01-balance-generale.xlsx
 *   02-balance-comparative-N-N-1.xlsx
 *   03-compte-resultat-officiel.xlsx
 *   04-bilan-officiel.xlsx
 *   05-sig.xlsx
 *   06-ratios-financiers.xlsx
 *   07-tafire.xlsx
 *   08-tft.xlsx
 *   09-annexe.xlsx
 *   10-balance-agee-clients.xlsx
 *   11-balance-agee-fournisseurs.xlsx
 *   00-MANIFEST.txt — liste des fichiers + paramètres + horodatage
 *
 * Chaque XLSX est généré en parallèle puis assemblé dans le ZIP. Pas
 * de migration de schéma, pas de table de packages persistée — un
 * appel = un ZIP fraîchement calculé à partir des écritures validées.
 */
@Injectable()
export class ReportsPackageService {
  constructor(
    private readonly reports: ReportsService,
    private readonly xlsx: ReportsXlsxService,
  ) {}

  async buildAnnualPackage(
    organizationId: TenantId,
    query: {
      fromDate: string;
      toDate: string;
      fiscalYearStartDate?: string;
      orgName: string;
    },
  ): Promise<Buffer> {
    assertTenantId(organizationId);
    const fyStart = query.fiscalYearStartDate ?? query.fromDate;

    // Previous-year dates for comparative balance (heuristique : 1 an pile).
    const prevFrom = `${Number(query.fromDate.slice(0, 4)) - 1}${query.fromDate.slice(4)}`;
    const prevTo = `${Number(query.toDate.slice(0, 4)) - 1}${query.toDate.slice(4)}`;

    // Fire all reports in parallel — they read the same DB so I/O
    // overlap is the main gain. Errors are caught per-report and turned
    // into a manifest entry rather than failing the whole package.
    const tasks = [
      this.safeBuild('01-balance-generale.xlsx', async () => {
        const r = await this.reports.getTrialBalance(organizationId, {
          fromDate: query.fromDate,
          toDate: query.toDate,
          hideEmpty: true,
        });
        return this.xlsx.trialBalanceXlsx(r, query.orgName);
      }),
      this.safeBuild('02-balance-comparative-N-N-1.xlsx', async () => {
        const r = await this.reports.getComparativeBalance(organizationId, {
          fromDate: query.fromDate,
          toDate: query.toDate,
          previousFromDate: prevFrom,
          previousToDate: prevTo,
          hideEmpty: true,
        });
        return this.xlsx.comparativeBalanceXlsx(r, query.orgName);
      }),
      this.safeBuild('03-compte-resultat-officiel.xlsx', async () => {
        const r = await this.reports.getSig(organizationId, {
          fromDate: query.fromDate,
          toDate: query.toDate,
          compareWith: { fromDate: prevFrom, toDate: prevTo },
        });
        return this.xlsx.profitLossOfficialXlsx(r, query.orgName);
      }),
      this.safeBuild('04-bilan-officiel.xlsx', async () => {
        const r = await this.reports.getBalanceSheet(organizationId, {
          asAtDate: query.toDate,
          fiscalYearStartDate: fyStart,
        });
        return this.xlsx.balanceSheetOfficialXlsx(r, query.orgName);
      }),
      this.safeBuild('05-sig.xlsx', async () => {
        const r = await this.reports.getSig(organizationId, {
          fromDate: query.fromDate,
          toDate: query.toDate,
          compareWith: { fromDate: prevFrom, toDate: prevTo },
        });
        return this.xlsx.sigXlsx(r, query.orgName);
      }),
      this.safeBuild('06-ratios-financiers.xlsx', async () => {
        const r = await this.reports.getFinancialRatios(organizationId, {
          asAtDate: query.toDate,
          fiscalYearStartDate: fyStart,
        });
        return this.xlsx.financialRatiosXlsx(r, query.orgName);
      }),
      this.safeBuild('07-tafire.xlsx', async () => {
        const r = await this.reports.getTafire(organizationId, {
          fromDate: query.fromDate,
          toDate: query.toDate,
        });
        return this.xlsx.tafireXlsx(r, query.orgName);
      }),
      this.safeBuild('08-tft.xlsx', async () => {
        const r = await this.reports.getTft(organizationId, {
          fromDate: query.fromDate,
          toDate: query.toDate,
        });
        return this.xlsx.tftXlsx(r, query.orgName);
      }),
      this.safeBuild('09-annexe.xlsx', async () => {
        const r = await this.reports.getAnnexe(organizationId, {
          asAtDate: query.toDate,
          fiscalYearStartDate: fyStart,
        });
        return this.xlsx.annexeXlsx(r, query.orgName);
      }),
      this.safeBuild('10-balance-agee-clients.xlsx', async () => {
        const r = await this.reports.getAgingBalance(organizationId, {
          side: 'CLIENT',
          asAtDate: query.toDate,
        });
        return this.xlsx.agingBalanceXlsx(r, query.orgName);
      }),
      this.safeBuild('11-balance-agee-fournisseurs.xlsx', async () => {
        const r = await this.reports.getAgingBalance(organizationId, {
          side: 'FOURNISSEUR',
          asAtDate: query.toDate,
        });
        return this.xlsx.agingBalanceXlsx(r, query.orgName);
      }),
    ];

    const results = await Promise.all(tasks);
    const zip = new JSZip();

    const manifestLines: string[] = [
      `Dossier annuel SYSCOHADA AUDCIF`,
      `Organisation : ${query.orgName}`,
      `Période : du ${query.fromDate} au ${query.toDate}`,
      `Début exercice fiscal : ${fyStart}`,
      `Comparatif N-1 : ${prevFrom} → ${prevTo}`,
      `Généré le : ${new Date().toISOString()}`,
      ``,
      `Fichiers inclus :`,
    ];
    for (const r of results) {
      if (r.buffer !== null) {
        zip.file(r.filename, r.buffer);
        manifestLines.push(`  ✓ ${r.filename}`);
      } else {
        manifestLines.push(`  ✗ ${r.filename} — ERREUR : ${r.error}`);
      }
    }
    zip.file('00-MANIFEST.txt', manifestLines.join('\n'));

    return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  }

  private async safeBuild(
    filename: string,
    builder: () => Promise<Buffer>,
  ): Promise<{ filename: string; buffer: Buffer | null; error?: string }> {
    try {
      const buffer = await builder();
      return { filename, buffer };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return { filename, buffer: null, error: msg };
    }
  }
}
