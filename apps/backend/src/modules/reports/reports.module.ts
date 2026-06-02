import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AccountingPlanModule } from '../accounting-plan/accounting-plan.module';
import { OrganizationAccountRepository } from '../accounting-plan/repositories/organization-account.repository';
import { ActuarialCommitmentsModule } from '../actuarial-commitments/actuarial-commitments.module';
import { ActuarialCommitmentsService } from '../actuarial-commitments/services/actuarial-commitments.service';
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
import { ReportInputCatalogController } from './controllers/report-input-catalog.controller';
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
  NoteActuarialCommitmentsDeps,
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
    ActuarialCommitmentsModule,
    AssetsModule,
    InventoryModule,
    JournalsModule,
    OrganizationsModule,
  ],
  controllers: [ReportsController, ReportInputCatalogController],
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
    // AccountingPlanModule) ou sur `CashFlowService` (TFT et indicateurs).
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
        actuarialCommitmentsService: ActuarialCommitmentsService,
      ): NotesAnnexesService => {
        const reports: NoteReportsDeps = {
          accountBalancesAsAt: (orgId, asAtDate) =>
            reportsRepo.accountBalancesAsAt(orgId, asAtDate),
          accountMovementsBetween: (orgId, fromDate, toDate) =>
            reportsRepo.accountMovementsBetween(orgId, fromDate, toDate),
        };

        const assets: NoteAssetsDeps = {
          findAllForExercise: async (
            orgId,
            fiscalYear,
          ): Promise<ReadonlyArray<NoteAssetRecord>> => {
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

            const num = (s: string | null | undefined): number => {
              const n = Number(s);
              return Number.isFinite(n) ? n : 0;
            };
            const dec = (n: number): string => n.toFixed(2);

            // ── SIG (cascade XA→XI + postes produits/charges) ──────────
            const soldeByCode = (code: string): string =>
              sig.soldes.find((s) => s.code === code)?.amount ?? '0.00';
            const produitByCode = (code: string): number =>
              num(sig.produits.find((p) => p.code === code)?.amount);
            const chargeByCode = (code: string): number =>
              num(sig.charges.find((c) => c.code === code)?.amount);

            // ── Bilan : totaux de masse (AZ, BK, BT, DP, DT) + postes
            //    HAO (BA actif circulant HAO ; DH passif circulant HAO).
            //    Source de vérité : `actifMasses`/`passifMasses` (35
            //    postes lettrés), pas les buckets legacy `sections`.
            const masseTotal = (
              masses: ReadonlyArray<{ code: string; total: string }>,
              code: string,
            ): number => num(masses.find((m) => m.code === code)?.total);
            const posteNet = (
              masses: ReadonlyArray<{
                rubriques: ReadonlyArray<{ postes: ReadonlyArray<{ code: string; net: string }> }>;
              }>,
              code: string,
            ): number => {
              for (const m of masses) {
                for (const r of m.rubriques) {
                  const p = r.postes.find((x) => x.code === code);
                  if (p) return num(p.net);
                }
              }
              return 0;
            };

            // ── Section 2 — CAFG additive (composantes SIG) ────────────
            const ebe = num(soldeByCode('XD'));
            const revenusFinanciers =
              produitByCode('TK') + produitByCode('TL') + produitByCode('TM');
            const produitsHAO = produitByCode('TO');
            const fraisFinanciers = chargeByCode('RM');
            const impotsResultat = chargeByCode('RS');
            const cafg = ebe + revenusFinanciers + produitsHAO - fraisFinanciers - impotsResultat;
            // Dividendes versés : pas de source comptable propre exposée
            // ici (le compte 465/472 « dividendes à payer » n'est pas un
            // flux de distribution fiable). Documenté à 0.
            const dividendes = 0;
            const autofinancement = cafg - dividendes;

            // ── Section 4 — Structure financière ───────────────────────
            const actifImmobilise = masseTotal(bilan.actifMasses, 'AZ');
            const actifCirculantTotal = masseTotal(bilan.actifMasses, 'BK');
            const passifCirculantTotal = masseTotal(bilan.passifMasses, 'DP');
            const actifCircHAO = posteNet(bilan.actifMasses, 'BA');
            const passifCircHAO = posteNet(bilan.passifMasses, 'DH');
            const actifCircExploitation = actifCirculantTotal - actifCircHAO;
            const passifCircExploitation = passifCirculantTotal - passifCircHAO;
            const capitauxPropres = masseTotal(bilan.passifMasses, 'CP');
            const dettesFinancieres = masseTotal(bilan.passifMasses, 'DD');
            const ressourcesStables = capitauxPropres + dettesFinancieres;
            const fondsRoulement = ressourcesStables - actifImmobilise;
            const besoinFinExploitation = actifCircExploitation - passifCircExploitation;
            const besoinFinHAO = actifCircHAO - passifCircHAO;
            const besoinFinGlobal = besoinFinExploitation + besoinFinHAO;
            const tresorerieNette = fondsRoulement - besoinFinGlobal;
            // Trésorerie actif/passif depuis les MÊMES masses (BT/DT) que
            // ci-dessus : garantit l'identité de contrôle
            //   trésorerie nette (5) = trésorerie actif − trésorerie passif
            // et la cohérence avec l'endettement financier net (section 6).
            const tresorerieActif = masseTotal(bilan.actifMasses, 'BT');
            const tresoreriePassif = masseTotal(bilan.passifMasses, 'DT');

            return {
              // Section 1 — Activité (cascade SIG)
              chiffreAffaires: soldeByCode('XB'),
              margeCommerciale: soldeByCode('XA'),
              valeurAjoutee: soldeByCode('XC'),
              excedentBrutExploitation: soldeByCode('XD'),
              resultatExploitation: soldeByCode('XE'),
              resultatFinancier: soldeByCode('XF'),
              resultatAO: soldeByCode('XG'),
              resultatHAO: soldeByCode('XH'),
              resultatNet: soldeByCode('XI'),

              // Section 2 — CAFG additive
              cafgExploitation: dec(ebe),
              revenusFinanciers: dec(revenusFinanciers),
              produitsHAO: dec(produitsHAO),
              fraisFinanciers: dec(fraisFinanciers),
              impotsResultat: dec(impotsResultat),
              cafg: dec(cafg),
              dividendes: dec(dividendes),
              autofinancement: dec(autofinancement),

              // Section 4 — Structure financière
              actifImmobilise: dec(actifImmobilise),
              actifCircExploitation: dec(actifCircExploitation),
              passifCircExploitation: dec(passifCircExploitation),
              actifCircHAO: dec(actifCircHAO),
              passifCircHAO: dec(passifCircHAO),
              fondsRoulement: dec(fondsRoulement),
              besoinFinExploitation: dec(besoinFinExploitation),
              besoinFinHAO: dec(besoinFinHAO),
              besoinFinGlobal: dec(besoinFinGlobal),
              tresorerieNette: dec(tresorerieNette),

              // Section 5 — Variation de la trésorerie (TFT)
              fluxOperationnels: flux.operatingFlows.subtotal,
              fluxInvestissement: flux.investingFlows.subtotal,
              fluxFinancement: flux.financingFlowsTotal,

              // Données de bilan partagées (masses lettrées — source de
              // vérité DSF). Cohérentes avec la section structure ci-dessus.
              totalActif: bilan.actif.total,
              totalCapitauxPropres: dec(capitauxPropres),
              dettesFinancieres: dec(dettesFinancieres),
              actifCirculant: dec(actifCirculantTotal),
              tresorerieActif: dec(tresorerieActif),
              passifCirculant: dec(passifCirculantTotal),
              tresoreriePassif: dec(tresoreriePassif),
              variationTresorerie: flux.netCashVariation,
            };
          },
        };

        // E2 — actuarialCommitments dep : expose les snapshots stables
        // des évaluations actuarielles actives à la Note 16B. Le service
        // applicatif convertit ses entités TypeORM via `toSnapshot` pour
        // garder un contrat de lecture découplé.
        const actuarialCommitments: NoteActuarialCommitmentsDeps = {
          listActiveByOrg: async (orgId) => {
            const rows = await actuarialCommitmentsService.listByOrg(orgId as never, {
              status: 'active',
            });
            return rows.map((row) => actuarialCommitmentsService.toSnapshot(row));
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
          actuarialCommitments,
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
        ActuarialCommitmentsService,
      ],
    },
  ],
  exports: [
    ReportsService,
    CashFlowService,
    DsfValidatorService,
    DsfIdentificationService,
    FiscalYearSnapshotsService,
    SubsequentEventsService,
    NotesAnnexesService,
  ],
})
export class ReportsModule {}
