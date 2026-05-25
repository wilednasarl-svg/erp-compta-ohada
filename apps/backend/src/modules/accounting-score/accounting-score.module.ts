import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AccountingPeriodEntity } from '../journals/entities/accounting-period.entity';
import { AccountingPeriodRepository } from '../journals/repositories/accounting-period.repository';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { RbacModule } from '../rbac/rbac.module';
import { AccountingScoreController } from './controllers/accounting-score.controller';
import { AccountingScoreEntity } from './entities/accounting-score.entity';
import { AccountingScoreRepository } from './repositories/accounting-score.repository';
import { AccountingScoreService } from './services/accounting-score.service';

/**
 * AccountingScoreModule — Module 20 wave 1.
 *
 * Score de santé comptable 0-100 par exercice, agrégé sur 4 critères
 * (anomalies, justificatifs manquants, rapprochements, retards
 * workflow). Heuristique pure, ZÉRO appel ML/LLM en wave 1. L'API est
 * stable pour qu'une wave 2 ML puisse remplacer le calculateur derrière
 * la même interface publique sans casser le contrat HTTP.
 *
 * Loose-coupling : aucune dépendance TS sur AiModule / DocumentsModule /
 * BankReconciliationModule / WorkflowsModule. Toutes les lectures
 * passent par SQL brut sur les tables sources (ai_anomalies,
 * document_entries, bank_statement_lines, accounting_periods). Si une
 * table source n'existe pas encore dans la DB cible, le critère retombe
 * sur 0 sans crasher.
 *
 * AuthModule + RbacModule importés pour les guards locaux
 * (cf. mémoire `nest-useguards-requires-module-imports`).
 *
 * On enregistre `AccountingPeriodEntity` localement parce que
 * JournalsModule n'exporte pas `AccountingPeriodRepository`.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([AccountingScoreEntity, AccountingPeriodEntity]),
    AuthModule,
    RbacModule,
    AuditModule,
  ],
  controllers: [AccountingScoreController],
  providers: [AccountingPeriodRepository, AccountingScoreRepository, AccountingScoreService],
  exports: [AccountingScoreService],
})
export class AccountingScoreModule {}
