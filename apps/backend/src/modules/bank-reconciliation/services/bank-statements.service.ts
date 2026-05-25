import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { DataSource } from 'typeorm';

import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import { AuditTrailService, type AuditContext } from '../../audit/services/audit-trail.service';
import { ImportBankStatementDto } from '../dto/import-bank-statement.dto';
import { BankStatementEntity } from '../entities/bank-statement.entity';
import { BankStatementLineEntity } from '../entities/bank-statement-line.entity';
import { BankStatementLinesRepository } from '../repositories/bank-statement-lines.repository';
import { BankStatementsRepository } from '../repositories/bank-statements.repository';
import { BankAccountsService } from './bank-accounts.service';
import { BankCsvParseError, parseBankCsv, type ParsedBankLine } from './bank-statement-csv-parser';

/**
 * `BankStatementsService` — import + listing des relevés bancaires.
 *
 * L'import est atomique : parse → hash SHA-256 → vérif duplicate →
 * insertion en-tête + N lignes en une seule transaction.
 */
@Injectable()
export class BankStatementsService {
  private static readonly MODULE = 'bank-reconciliation' as const;
  private readonly logger = new Logger(BankStatementsService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly accountsService: BankAccountsService,
    private readonly statementsRepo: BankStatementsRepository,
    private readonly linesRepo: BankStatementLinesRepository,
    private readonly audit: AuditTrailService,
  ) {}

  async listByBankAccount(
    bankAccountId: string,
    organizationId: TenantId,
  ): Promise<BankStatementEntity[]> {
    assertTenantId(organizationId);
    await this.accountsService.findById(bankAccountId, organizationId);
    return this.statementsRepo.listByBankAccount(organizationId, bankAccountId);
  }

  async getStatementWithLines(
    statementId: string,
    organizationId: TenantId,
  ): Promise<{ statement: BankStatementEntity; lines: BankStatementLineEntity[] }> {
    assertTenantId(organizationId);
    const statement = await this.statementsRepo.findById(statementId, organizationId);
    if (!statement) {
      throw new AppException(ERROR_CODES.BANK_STATEMENT_NOT_FOUND, {
        message: `Bank statement '${statementId}' not found.`,
      });
    }
    const lines = await this.linesRepo.listByStatement(statementId, organizationId);
    return { statement, lines };
  }

  async importStatement(
    bankAccountId: string,
    organizationId: TenantId,
    dto: ImportBankStatementDto,
    actorId: string,
    ctx: AuditContext,
  ): Promise<{ statement: BankStatementEntity; linesCount: number }> {
    assertTenantId(organizationId);

    const account = await this.accountsService.findById(bankAccountId, organizationId);

    const csvText = Buffer.from(dto.fileContent, 'base64').toString('utf8');
    const fileHash = createHash('sha256').update(csvText).digest('hex');

    const duplicate = await this.statementsRepo.findByHash(organizationId, bankAccountId, fileHash);
    if (duplicate) {
      throw new AppException(ERROR_CODES.BANK_STATEMENT_DUPLICATE, {
        message: `A statement with the same file hash was already imported (id=${duplicate.id}).`,
      });
    }

    let parsed: ReadonlyArray<ParsedBankLine>;
    try {
      const result = parseBankCsv(csvText);
      parsed = result.lines;
    } catch (e) {
      if (e instanceof BankCsvParseError) {
        throw new AppException(ERROR_CODES.BANK_STATEMENT_PARSE_FAILED, {
          message: `Parse failed at row ${e.rowIndex + 1}: ${e.message}`,
        });
      }
      throw e;
    }

    if (parsed.length === 0) {
      throw new AppException(ERROR_CODES.BANK_STATEMENT_EMPTY, {
        message: 'Bank statement contains no lines.',
      });
    }

    return this.dataSource.transaction(async (manager) => {
      const statement = await this.statementsRepo.create(
        {
          organizationId,
          bankAccountId,
          periodStart: dto.periodStart,
          periodEnd: dto.periodEnd,
          openingBalance: dto.openingBalance,
          closingBalance: dto.closingBalance,
          currency: account.currency,
          importedFileName: dto.fileName,
          importedFileHash: fileHash,
          importedLinesCount: parsed.length,
          matchedLinesCount: 0,
          status: 'imported',
          importedById: actorId,
          importedAt: new Date(),
        },
        manager,
      );

      await this.linesRepo.createMany(
        parsed.map((line) => ({
          organizationId,
          bankStatementId: statement.id,
          bankAccountId,
          lineOrder: line.lineOrder,
          operationDate: line.operationDate,
          valueDate: line.valueDate,
          label: line.label,
          bankReference: line.bankReference,
          amount: line.amount,
          matchStatus: 'unmatched' as const,
        })),
        manager,
      );

      await this.emitAudit(
        'bank_statement_imported',
        statement.id,
        {
          bankAccountCode: account.code,
          fileName: dto.fileName,
          fileHash,
          linesCount: parsed.length,
          periodStart: dto.periodStart,
          periodEnd: dto.periodEnd,
        },
        ctx,
        actorId,
        organizationId,
      );

      return { statement, linesCount: parsed.length };
    });
  }

  private async emitAudit(
    action: string,
    entityId: string,
    data: Record<string, unknown>,
    ctx: AuditContext,
    actorId: string,
    organizationId: TenantId | string,
  ): Promise<void> {
    await this.audit
      .record({
        module: BankStatementsService.MODULE,
        action,
        entityType: 'bank_statement',
        entityId,
        after: data,
        ctx: { ...ctx, userId: actorId, organizationId },
      })
      .catch((e) => this.logger.warn(`Audit failed: ${String(e)}`));
  }
}
