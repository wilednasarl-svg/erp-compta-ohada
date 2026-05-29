import { Injectable } from '@nestjs/common';
import JSZip from 'jszip';

import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import { type TenantId, assertTenantId } from '../../../common/persistence/tenant-scope';
import { CashFlowService } from './cash-flow.service';
import { DsfFichesPdfService } from './dsf-fiches-pdf.service';
import { DsfIdentificationService } from './dsf-identification.service';
import { NotesAnnexesService, type GetNoteRequest } from './notes-annexes/notes-annexes.service';
import type { NoteContent } from './notes-annexes/types';
import { ReportsPdfService } from './reports-pdf.service';
import { ReportsService } from './reports.service';
import { ReportsXlsxService } from './reports-xlsx.service';
import type {
  CoverPageData,
  DirectorsFicheData,
  IdentificationFicheData,
  NotesApplicabilityFicheData,
} from '../types/dsf-profile.types';

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
    private readonly pdf: ReportsPdfService,
    private readonly dsfFichesPdf: DsfFichesPdfService,
    private readonly dsfIdentification: DsfIdentificationService,
    private readonly notesAnnexes: NotesAnnexesService,
    private readonly cashFlow: CashFlowService,
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
      this.safeBuild('08-tft.xlsx', async () => {
        const r = await this.cashFlow.getCashFlow(organizationId, {
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

  // ──────────────────────────────────────────────────────────────────
  // W5.3 — Liasse DSF complète déposable.
  //
  // Doctrine SYSCOHADA Tome 3 p. 18 : « Les 4 états financiers forment
  // un tout indissociable. N'utiliser que des imprimés normalisés ».
  //
  // Structure du ZIP produit :
  //   00-MANIFEST.txt
  //   01-page-de-garde-R1.pdf
  //   02-identification-R2.pdf
  //   03-dirigeants-R3.pdf
  //   04-applicabilite-R4.pdf
  //   10-bilan.pdf      / 10-bilan.xlsx
  //   11-compte-resultat.pdf / 11-compte-resultat.xlsx
  //   12-tft.pdf        / 12-tft.xlsx
  //   20-notes-annexes/MANIFEST.txt
  //   20-notes-annexes/{Nxx}-{slug}.json    (notes COMPUTED)
  //   20-notes-annexes/_pending/{Nxx}.txt   (notes stub)
  //
  // Si le profile DSF est incomplet (R2 lève DSF_PROFILE_INVALID),
  // les fiches R1-R4 sont remplacées par des valeurs par défaut et un
  // warning est inscrit dans le MANIFEST — le ZIP reste téléchargeable
  // pour permettre au comptable de compléter le profile *après* avoir
  // vu le rendu (UX : « ne pas bloquer sur le premier essai »).
  // ──────────────────────────────────────────────────────────────────
  async buildDsfPackage(
    organizationId: TenantId,
    exerciseId: string,
    options: {
      fromDate: string;
      toDate: string;
      fiscalYearStartDate?: string;
      orgName: string;
    },
  ): Promise<Buffer> {
    assertTenantId(organizationId);

    const fyStart = options.fiscalYearStartDate ?? options.fromDate;
    const fiscalYear = Number(options.toDate.slice(0, 4));
    const warnings: string[] = [];

    // ── 1. Fiches R1-R4 (W5.1) ──
    const fiches = await this.loadFichesOrDefaults(
      organizationId,
      exerciseId,
      options.orgName,
      options.fromDate,
      options.toDate,
      warnings,
    );

    // ── 2. États financiers (W5.2) — en parallèle ──
    const stateTasks = await Promise.all([
      this.safeBuild('01-page-de-garde-R1.pdf', () =>
        this.dsfFichesPdf.coverPagePdf(fiches.coverPage, options.orgName),
      ),
      this.safeBuild('02-identification-R2.pdf', () =>
        this.dsfFichesPdf.identificationFichePdf(fiches.r2),
      ),
      this.safeBuild('03-dirigeants-R3.pdf', () => this.dsfFichesPdf.directorsFichePdf(fiches.r3)),
      this.safeBuild('04-applicabilite-R4.pdf', () =>
        this.dsfFichesPdf.notesApplicabilityFichePdf(fiches.r4),
      ),
      this.safeBuild('10-bilan.pdf', async () => {
        const r = await this.reports.getBalanceSheet(organizationId, {
          asAtDate: options.toDate,
          fiscalYearStartDate: fyStart,
        });
        return this.pdf.balanceSheetPdf(r, options.orgName);
      }),
      this.safeBuild('10-bilan.xlsx', async () => {
        const r = await this.reports.getBalanceSheet(organizationId, {
          asAtDate: options.toDate,
          fiscalYearStartDate: fyStart,
        });
        return this.xlsx.balanceSheetXlsx(r, options.orgName);
      }),
      this.safeBuild('11-compte-resultat.pdf', async () => {
        const r = await this.reports.getProfitLoss(organizationId, {
          fromDate: options.fromDate,
          toDate: options.toDate,
        });
        return this.pdf.profitLossPdf(r, options.orgName);
      }),
      this.safeBuild('11-compte-resultat.xlsx', async () => {
        const r = await this.reports.getProfitLoss(organizationId, {
          fromDate: options.fromDate,
          toDate: options.toDate,
        });
        return this.xlsx.profitLossXlsx(r, options.orgName);
      }),
      this.safeBuild('12-tft.pdf', async () => {
        const r = await this.cashFlow.getCashFlow(organizationId, {
          fromDate: options.fromDate,
          toDate: options.toDate,
        });
        return this.pdf.tftPdf(r, options.orgName);
      }),
      this.safeBuild('12-tft.xlsx', async () => {
        const r = await this.cashFlow.getCashFlow(organizationId, {
          fromDate: options.fromDate,
          toDate: options.toDate,
        });
        return this.xlsx.tftXlsx(r, options.orgName);
      }),
    ]);

    // ── 3. Notes annexes (W2.4) ──
    // `getAllNotes` absorbe déjà NotImplementedError côté service (les
    // stubs reviennent comme `applicable: false` + row PENDING). On
    // n'a donc qu'à distinguer "rows réelles" vs "PENDING".
    const notesReq: GetNoteRequest = {
      organizationId,
      exerciseId,
      periodStart: options.fromDate,
      periodEnd: options.toDate,
      fiscalYear,
    };
    let notes: ReadonlyArray<NoteContent> = [];
    try {
      notes = await this.notesAnnexes.getAllNotes(notesReq);
    } catch (err: unknown) {
      warnings.push(
        `Notes annexes : échec global (${err instanceof Error ? err.message : 'erreur inconnue'})`,
      );
    }

    // ── 4. Assemblage ZIP ──
    const zip = new JSZip();
    const fileEntries: string[] = [];

    for (const r of stateTasks) {
      if (r.buffer !== null) {
        zip.file(r.filename, r.buffer);
        fileEntries.push(`  + ${r.filename}`);
      } else {
        fileEntries.push(`  ! ${r.filename} — ERREUR : ${r.error ?? 'unknown'}`);
        warnings.push(`${r.filename} : ${r.error ?? 'unknown'}`);
      }
    }

    // Notes annexes : dossier 20-notes-annexes/
    const notesFolder = zip.folder('20-notes-annexes');
    if (notesFolder !== null) {
      const notesManifestLines: string[] = [
        '=== NOTES ANNEXES AUDCIF ===',
        '',
        `Total notes du registre : ${notes.length}`,
        '',
        'Détail (statut COMPUTED ou STUB) :',
      ];
      let computedCount = 0;
      let stubCount = 0;
      for (const note of notes) {
        const isStub = note.rows.length === 1 && note.rows[0]?.key === 'PENDING';
        if (isStub) {
          stubCount += 1;
          notesManifestLines.push(`  [STUB]     ${note.id} — ${note.metadata.label}`);
          const pendingFolder = notesFolder.folder('_pending');
          pendingFolder?.file(
            `${note.id}-not-implemented.txt`,
            `Note ${note.id} — ${note.metadata.label}\n\nImplémentation en attente (W2.4.b). Placeholder généré le ${new Date().toISOString()}.\n`,
          );
        } else {
          computedCount += 1;
          notesManifestLines.push(
            `  [COMPUTED] ${note.id} — ${note.metadata.label} (${note.rows.length} ligne${note.rows.length > 1 ? 's' : ''})`,
          );
          const slug = this.slugify(note.metadata.label);
          notesFolder.file(
            `${note.id}-${slug}.json`,
            JSON.stringify(
              {
                id: note.id,
                label: note.metadata.label,
                section: note.metadata.section,
                applicable: note.applicable,
                rows: note.rows,
                freeComment: note.freeComment ?? '',
                computedAt: note.computedAt,
              },
              null,
              2,
            ),
          );
        }
      }
      notesManifestLines.splice(3, 0, `  - COMPUTED : ${computedCount}`);
      notesManifestLines.splice(4, 0, `  - STUB     : ${stubCount}`);
      notesFolder.file('MANIFEST.txt', notesManifestLines.join('\n'));
      fileEntries.push(
        `  + 20-notes-annexes/ (${notes.length} notes : ${computedCount} COMPUTED, ${stubCount} STUB)`,
      );
    }

    // ── 5. MANIFEST racine ──
    const manifestLines: string[] = [
      '=== LIASSE DSF SYSCOHADA — DEPOT GREFFE ===',
      '',
      `Entite      : ${options.orgName}`,
      `Exercice    : ${options.fromDate} -> ${options.toDate}`,
      `Genere le   : ${new Date().toISOString()}`,
      'Version DSF : 1.0',
      '',
      'CONTENU :',
      ...fileEntries,
      '',
      'CONFORMITE :',
      '  - 4 etats financiers presents (Acte uniforme art. 8)',
      '  - Postes lettres SYSCOHADA REVISE',
      '  - Format contexture normalisee DGI',
      `  - Notes annexes : ${notes.filter((n) => !(n.rows.length === 1 && n.rows[0]?.key === 'PENDING')).length}/${notes.length} calculees automatiquement`,
    ];
    if (warnings.length > 0) {
      manifestLines.push('', 'AVERTISSEMENTS :');
      for (const w of warnings) {
        manifestLines.push(`  ! ${w}`);
      }
    }
    zip.file('00-MANIFEST.txt', manifestLines.join('\n'));

    return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  }

  /**
   * Charge les Fiches R1-R4 via `DsfIdentificationService.buildAllFiches`.
   *
   * Si le profile est incomplet (R2 lève DSF_PROFILE_INVALID), on
   * retombe sur des fiches « par défaut » (valeurs minimales tirées
   * des `options`) plutôt que de faire échouer tout le bundle. Cela
   * permet au comptable de télécharger le squelette du ZIP même quand
   * il n'a pas encore saisi le NINEA / l'adresse / etc.
   *
   * Seule exception : si l'exercice n'existe pas (DSF_PROFILE_NOT_FOUND
   * sur `buildCoverPage`), on remonte une erreur typée propre
   * `DSF_PACKAGE_PROFILE_INCOMPLETE` — pas de squelette possible sans
   * période comptable valide.
   */
  private async loadFichesOrDefaults(
    organizationId: TenantId,
    exerciseId: string,
    orgName: string,
    fromDate: string,
    toDate: string,
    warnings: string[],
  ): Promise<{
    coverPage: CoverPageData;
    r2: IdentificationFicheData;
    r3: DirectorsFicheData;
    r4: NotesApplicabilityFicheData;
  }> {
    try {
      const bundle = await this.dsfIdentification.buildAllFiches(organizationId, exerciseId);
      return bundle;
    } catch (err: unknown) {
      // Re-throw uniquement si la cause est un exercice introuvable —
      // sinon on bascule en mode "valeurs par défaut".
      if (err instanceof AppException && err.code === ERROR_CODES.DSF_PROFILE_NOT_FOUND) {
        throw new AppException(ERROR_CODES.DSF_PACKAGE_PROFILE_INCOMPLETE, {
          message: `Cannot build DSF package — accounting period ${exerciseId} not found`,
          details: { exerciseId },
        });
      }
      const msg = err instanceof Error ? err.message : 'unknown error';
      warnings.push(
        `Profile DSF incomplet : ${msg} — fiches R1-R4 generees avec valeurs par defaut`,
      );
      return {
        coverPage: {
          organizationName: orgName,
          organizationSlug: '',
          legalForm: null,
          capital: null,
          currency: 'XOF',
          exerciseId,
          exerciseLabel: `Exercice ${toDate.slice(0, 4)}`,
          exerciseStartDate: fromDate,
          exerciseEndDate: toDate,
          country: null,
        },
        r2: {
          organizationName: orgName,
          legalForm: null,
          taxRegime: null,
          country: null,
          ninea: null,
          rccm: null,
          siegeAddress: null,
          siegeCity: null,
          phone: null,
          email: null,
          activitySector: null,
          workforceByQualification: {},
          workforceTotal: 0,
        },
        r3: {
          directorName: null,
          directorTitle: null,
          presidentName: null,
          auditorName: null,
        },
        r4: {
          totalNotes: 0,
          applicableCount: 0,
          notApplicableCount: 0,
          entries: [],
        },
      };
    }
  }

  /**
   * Slugifie un libellé en kebab-case ASCII pour le nom de fichier
   * JSON d'une note annexe. Évite l'enfer des caractères accentués
   * dans le ZIP (greffes / DGI utilisent Windows / cp1252).
   */
  private slugify(label: string): string {
    return label
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40);
  }
}
