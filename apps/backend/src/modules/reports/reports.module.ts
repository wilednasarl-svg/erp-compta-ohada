import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AccountingPlanModule } from '../accounting-plan/accounting-plan.module';
import { OrganizationAccountRepository } from '../accounting-plan/repositories/organization-account.repository';
import { AssetsModule } from '../assets/assets.module';
import { AssetsRepository } from '../assets/repositories/assets.repository';
import { DepreciationSchedulesRepository } from '../assets/repositories/depreciation-schedules.repository';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../audit/audit.module';
import { InventoryModule } from '../inventory/inventory.module';
import { InventoryItemRepository } from '../inventory/repositories/inventory-item.repository';
import { JournalEntryLineEntity } from '../journals/entities/journal-entry-line.entity';
import { JournalsModule } from '../journals/journals.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { RbacModule } from '../rbac/rbac.module';
import { ReportsController } from './controllers/reports.controller';
import { FiscalYearSnapshotEntity } from './entities/fiscal-year-snapshot.entity';
import { NoteAnnexeCommentEntity } from './entities/note-annexe-comment.entity';
import { OrganizationDsfProfileEntity } from './entities/organization-dsf-profile.entity';
import { SubsequentEventEntity } from './entities/subsequent-event.entity';
import { FiscalYearSnapshotsRepository } from './repositories/fiscal-year-snapshots.repository';
import { NoteAnnexeCommentsRepository } from './repositories/note-annexe-comments.repository';
import { OrganizationDsfProfilesRepository } from './repositories/organization-dsf-profiles.repository';
import { ReportsRepository } from './repositories/reports.repository';
import { SubsequentEventsRepository } from './repositories/subsequent-events.repository';
import { DsfFichesPdfService } from './services/dsf-fiches-pdf.service';
import { DsfIdentificationService } from './services/dsf-identification.service';
import { DsfValidatorService } from './services/dsf-validator.service';
import { FiscalYearSnapshotsService } from './services/fiscal-year-snapshots.service';
import { CashFlowService } from './services/cash-flow.service';
import { NotesAnnexesService } from './services/notes-annexes/notes-annexes.service';
import type {
  NoteAccountsDeps,
  NoteAssetRecord,
  NoteAssetsDeps,
  NoteCashFlowDeps,
  NoteDepreciationRecord,
  NoteDsfProfileDeps,
  NoteInventoryDeps,
  NoteInventoryItem,
  NoteReportsDeps,
  NoteSynthesisIndicatorsDeps,
  NoteSynthesisSnapshot,
} from './services/notes-annexes/types';
import { ReportsPackageService } from './services/reports-package.service';
import { ReportsPdfService } from './services/reports-pdf.service';
import { ReportsService } from './services/reports.service';
import { ReportsXlsxService } from './services/reports-xlsx.service';
import { SubsequentEventsService } from './services/subsequent-events.service';

/**
 * `ReportsModule` — Module 9 financial reports (waves 1-3).
 *
 * Composes:
 *   - `ReportsRepository` for raw SQL aggregations against
 *     `journal_entry_lines` (joined with entries + accounts).
 *   - `ReportsService` for business-level projection + running balance.
 *   - `ReportsPdfService` for PDF rendering (wave 3).
 *   - `ReportsXlsxService` for Excel export (wave 3).
 *   - `ReportsController` for the REST surface (JSON + PDF/XLSX).
 *
 * AuthModule + RbacModule are imported for the controller's
 * `@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)` —
 * see memory `nest-useguards-requires-module-imports` for why both
 * imports are necessary even with APP_GUARD globally registered.
 *
 * AccountingPlanModule is imported so `OrganizationAccountRepository`
 * is available to verify the requested account exists in this tenant
 * before serving the general-ledger drill-down.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      JournalEntryLineEntity,
      NoteAnnexeCommentEntity,
      FiscalYearSnapshotEntity,
      SubsequentEventEntity,
      OrganizationDsfProfileEntity,
    ]),
    AuthModule,
    RbacModule,
    AuditModule,
    AccountingPlanModule,
    AssetsModule,
    InventoryModule,
    JournalsModule,
    OrganizationsModule,
  ],
  controllers: [ReportsController],
  providers: [
    ReportsRepository,
    NoteAnnexeCommentsRepository,
    FiscalYearSnapshotsRepository,
    SubsequentEventsRepository,
    OrganizationDsfProfilesRepository,
    ReportsService,
    ReportsPdfService,
    ReportsXlsxService,
    DsfFichesPdfService,
    DsfIdentificationService,
    ReportsPackageService,
    DsfValidatorService,
    FiscalYearSnapshotsService,
    SubsequentEventsService,
    CashFlowService,
    // W2.4 — NotesAnnexesService.
    //
    // Le service consomme 5 sous-dépendances (reports/assets/inventory/
    // accounts/cashFlow). Chacune mappe sur un repository réel exposé
    // par son module métier (AssetsModule, InventoryModule,
    // AccountingPlanModule) ou sur `CashFlowService` (TFT ventilé N31).
    //
    // Pas de cycle DI : aucun de ces modules n'importe `ReportsModule`
    // (vérifié W2.4.c) — on consomme leurs repositories directement.
    //
    // Mapping assets : `AssetEntity.assetAccountId` (UUID) doit être
    // converti en `assetAccountCode` (string SYSCOHADA) pour respecter
    // le shape `NoteAssetRecord`. On batch-load les comptes via
    // `OrganizationAccountRepository.findById` (Map UUID→code) afin
    // d'éviter le N+1.
    {
      provide: NotesAnnexesService,
      useFactory: (
        commentsRepo: NoteAnnexeCommentsRepository,
        reportsRepo: ReportsRepository,
        assetsRepo: AssetsRepository,
        depreciationRepo: DepreciationSchedulesRepository,
        inventoryItemRepo: InventoryItemRepository,
        accountsRepo: OrganizationAccountRepository,
        cashFlowService: CashFlowService,
        dsfProfilesRepo: OrganizationDsfProfilesRepository,
        reportsService: ReportsService,
      ): NotesAnnexesService => {
        const reports: NoteReportsDeps = {
          accountBalancesAsAt: (orgId, asAtDate) =>
            reportsRepo.accountBalancesAsAt(orgId, asAtDate),
        };

        const assets: NoteAssetsDeps = {
          findAllForExercise: async (orgId, fiscalYear): Promise<ReadonlyArray<NoteAssetRecord>> => {
            const all = await assetsRepo.listByOrganization(orgId);
            // Filtre : assets acquis avant ou pendant l'exercice (un
            // asset acquis en N+1 n'a pas à figurer dans la liasse N).
            const endOfYear = `${fiscalYear}-12-31`;
            const relevant = all.filter((a) => a.acquisitionDate <= endOfYear);

            // Résolution UUID → code SYSCOHADA via le plan comptable.
            const codeByAccountId = new Map<string, string>();
            for (const asset of relevant) {
              if (codeByAccountId.has(asset.assetAccountId)) continue;
              const account = await accountsRepo.findById(asset.assetAccountId, orgId);
              codeByAccountId.set(asset.assetAccountId, account?.code ?? '');
            }

            return relevant.map((a) => ({
              id: a.id,
              code: a.code,
              label: a.label,
              acquisitionDate: a.acquisitionDate,
              acquisitionCost: a.acquisitionCost,
              assetAccountCode: codeByAccountId.get(a.assetAccountId) ?? '',
              status: a.status as NoteAssetRecord['status'],
              disposalDate: a.disposalDate,
              disposalValue: a.disposalValue,
            }));
          },
          findDepreciationForYear: async (
            orgId,
            fiscalYear,
          ): Promise<ReadonlyArray<NoteDepreciationRecord>> => {
            const schedules = await depreciationRepo.listByOrgAndFiscalYear(orgId, fiscalYear);
            return schedules.map((s) => ({
              assetId: s.assetId,
              fiscalYear: s.fiscalYear,
              depreciationAmount: s.depreciationAmount,
              cumulativeDepreciation: s.cumulativeDepreciation,
              netBookValue: s.netBookValue,
            }));
          },
        };

        const inventory: NoteInventoryDeps = {
          findAllItems: async (orgId): Promise<ReadonlyArray<NoteInventoryItem>> => {
            const items = await inventoryItemRepo.listByOrganization(orgId);
            return items.map((it) => ({
              id: it.id,
              code: it.code,
              label: it.label,
              family: it.family,
              currentQty: it.currentQty,
              currentCmp: it.currentCmp,
            }));
          },
        };

        const accounts: NoteAccountsDeps = {
          findById: async (orgId, accountId) => {
            const a = await accountsRepo.findById(accountId, orgId);
            return a ? { id: a.id, code: a.code, label: a.label, class: a.class } : null;
          },
        };

        const cashFlow: NoteCashFlowDeps = {
          getCashFlow: (orgId, fromDate, toDate, previousFromDate, previousToDate) =>
            // Le branding TenantId est validé en amont par les guards ;
            // ici on caste pour ré-utiliser la signature publique.
            cashFlowService.getCashFlow(orgId as never, {
              fromDate,
              toDate,
              previousFromDate,
              previousToDate,
            }),
        };

        // C3 — dsfProfile dep : lit `workforceByQualification` du
        // profile DSF (R2) pour la Note 27B.
        const dsfProfile: NoteDsfProfileDeps = {
          getWorkforceByQualification: async (orgId) => {
            const profile = await dsfProfilesRepo.findByOrg(orgId);
            return profile?.workforceByQualification ?? {};
          },
        };

        // C3 — synthesisIndicators dep : assemble en parallèle bilan
        // + SIG + flux de trésorerie pour produire un snapshot
        // consommé par la Note 34 (Fiche de synthèse).
        const synthesisIndicators: NoteSynthesisIndicatorsDeps = {
          getSnapshot: async (orgId, periodStart, periodEnd): Promise<NoteSynthesisSnapshot> => {
            // Le branding TenantId est validé en amont par les guards ;
            // on caste pour ré-utiliser les signatures publiques de
            // `ReportsService` et `CashFlowService`.
            const tenant = orgId as never;
            const [bilan, sig, flux] = await Promise.all([
              reportsService.getBalanceSheet(tenant, {
                asAtDate: periodEnd,
                fiscalYearStartDate: periodStart,
              }),
              reportsService.getSig(tenant, { fromDate: periodStart, toDate: periodEnd }),
              cashFlowService.getCashFlow(tenant, { fromDate: periodStart, toDate: periodEnd }),
            ]);

            const sectionTotal = (
              sections: { key: string; total: string }[],
              key: string,
            ): string => sections.find((s) => s.key === key)?.total ?? '0.00';

            const soldeByCode = (code: string): string =>
              sig.soldes.find((s) => s.code === code)?.amount ?? '0.00';

            return {
              chiffreAffaires: soldeByCode('XB'),
              valeurAjoutee: soldeByCode('XC'),
              excedentBrutExploitation: soldeByCode('XD'),
              resultatExploitation: soldeByCode('XE'),
              resultatNet: soldeByCode('XI'),
              totalActif: bilan.actif.total,
              totalCapitauxPropres: sectionTotal(
                bilan.passif.sections as unknown as { key: string; total: string }[],
                'CAPITAUX_PROPRES',
              ),
              dettesFinancieres: sectionTotal(
                bilan.passif.sections as unknown as { key: string; total: string }[],
                'DETTES_FINANCIERES',
              ),
              actifCirculant: sectionTotal(
                bilan.actif.sections as unknown as { key: string; total: string }[],
                'CIRCULANT',
              ),
              tresorerieActif: sectionTotal(
                bilan.actif.sections as unknown as { key: string; total: string }[],
                'TRESORERIE_ACTIF',
              ),
              passifCirculant: sectionTotal(
                bilan.passif.sections as unknown as { key: string; total: string }[],
                'PASSIF_CIRCULANT',
              ),
              tresoreriePassif: sectionTotal(
                bilan.passif.sections as unknown as { key: string; total: string }[],
                'TRESORERIE_PASSIF',
              ),
              variationTresorerie: flux.netCashVariation,
            };
          },
        };

        return new NotesAnnexesService(
          commentsRepo,
          reports,
          assets,
          inventory,
          accounts,
          cashFlow,
          dsfProfile,
          synthesisIndicators,
        );
      },
      inject: [
        NoteAnnexeCommentsRepository,
        ReportsRepository,
        AssetsRepository,
        DepreciationSchedulesRepository,
        InventoryItemRepository,
        OrganizationAccountRepository,
        CashFlowService,
        OrganizationDsfProfilesRepository,
        ReportsService,
      ],
    },
  ],
  exports: [
    ReportsService,
    DsfValidatorService,
    DsfIdentificationService,
    FiscalYearSnapshotsService,
    SubsequentEventsService,
    NotesAnnexesService,
  ],
})
export class ReportsModule {}
