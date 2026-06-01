import type { Repository } from 'typeorm';

import { asTenantId } from '../../../common/persistence/tenant-scope';
import type { DocumentEntity } from '../entities/document.entity';
import { DocumentRepository } from './document.repository';

/**
 * Focused unit test for the `category` MIME mapping in
 * `DocumentRepository.listForOrg`. We stub the TypeORM QueryBuilder and
 * capture every `andWhere(sql, params)` call so we can assert the exact
 * SQL fragment + named parameters emitted per category — no DB needed.
 *
 * The repository has no DB-backed spec in the suite (the module is
 * otherwise exercised through `DocumentsService` mocks), so this keeps
 * the harness lightweight and matches the mock-based style already used
 * in `documents.service.spec.ts`.
 */

interface CapturedWhere {
  readonly sql: string;
  readonly params?: Record<string, unknown>;
}

interface FakeQueryBuilder {
  readonly andWhere: jest.Mock;
  readonly orderBy: jest.Mock;
  readonly skip: jest.Mock;
  readonly take: jest.Mock;
  readonly getCount: jest.Mock;
  readonly getMany: jest.Mock;
}

const ORG = asTenantId('org_a');
const PAGINATION = { page: 1, pageSize: 20 } as const;

function buildQueryBuilder(captured: CapturedWhere[]): FakeQueryBuilder {
  const qb: FakeQueryBuilder = {
    andWhere: jest.fn((sql: string, params?: Record<string, unknown>) => {
      captured.push({ sql, params });
      return qb;
    }),
    orderBy: jest.fn(() => qb),
    skip: jest.fn(() => qb),
    take: jest.fn(() => qb),
    getCount: jest.fn().mockResolvedValue(0),
    getMany: jest.fn().mockResolvedValue([]),
  };
  return qb;
}

function buildRepo(qb: FakeQueryBuilder): DocumentRepository {
  // `.where(...)` returns the same builder; we only assert the
  // `.andWhere(...)` chain so a minimal stub is enough.
  const typeormRepo = {
    createQueryBuilder: jest.fn(() => ({ where: jest.fn(() => qb) })),
  } as unknown as Repository<DocumentEntity>;
  return new DocumentRepository(typeormRepo);
}

/** Returns the first captured clause whose SQL mentions `doc.mime_type`. */
function findMimeClause(captured: CapturedWhere[]): CapturedWhere | undefined {
  return captured.find((c) => c.sql.includes('doc.mime_type'));
}

describe('DocumentRepository.listForOrg — category SQL mapping', () => {
  let captured: CapturedWhere[];
  let repo: DocumentRepository;

  beforeEach(() => {
    captured = [];
    repo = buildRepo(buildQueryBuilder(captured));
  });

  it("maps 'pdf' to an exact application/pdf equality with a distinct named param", async () => {
    await repo.listForOrg(ORG, { category: 'pdf' }, PAGINATION);

    const clause = findMimeClause(captured);
    expect(clause?.sql).toBe('doc.mime_type = :catPdf');
    expect(clause?.params).toEqual({ catPdf: 'application/pdf' });
  });

  it("maps 'image' to a LIKE 'image/%' predicate", async () => {
    await repo.listForOrg(ORG, { category: 'image' }, PAGINATION);

    const clause = findMimeClause(captured);
    expect(clause?.sql).toBe("doc.mime_type LIKE 'image/%'");
  });

  it("maps 'spreadsheet' to an IN list of the csv/xls/xlsx/ods MIME types", async () => {
    await repo.listForOrg(ORG, { category: 'spreadsheet' }, PAGINATION);

    const clause = findMimeClause(captured);
    expect(clause?.sql).toBe('doc.mime_type IN (:...catSpreadsheet)');
    expect(clause?.params).toEqual({
      catSpreadsheet: [
        'text/csv',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.oasis.opendocument.spreadsheet',
      ],
    });
  });

  it("maps 'document' to an IN list of the word-processor/plain-text MIME types", async () => {
    await repo.listForOrg(ORG, { category: 'document' }, PAGINATION);

    const clause = findMimeClause(captured);
    expect(clause?.sql).toBe('doc.mime_type IN (:...catDocument)');
    expect(clause?.params).toEqual({
      catDocument: [
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.oasis.opendocument.text',
        'text/plain',
      ],
    });
  });

  it("maps 'other' to the negation of every pdf/image/spreadsheet/document bucket", async () => {
    await repo.listForOrg(ORG, { category: 'other' }, PAGINATION);

    const clause = findMimeClause(captured);
    expect(clause?.sql).toContain("doc.mime_type NOT LIKE 'image/%'");
    expect(clause?.sql).toContain('doc.mime_type <> :catOtherPdf');
    expect(clause?.sql).toContain('doc.mime_type NOT IN (:...catOtherSpreadsheet)');
    expect(clause?.sql).toContain('doc.mime_type NOT IN (:...catOtherDocument)');
    expect(clause?.params).toEqual({
      catOtherPdf: 'application/pdf',
      catOtherSpreadsheet: [
        'text/csv',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.oasis.opendocument.spreadsheet',
      ],
      catOtherDocument: [
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.oasis.opendocument.text',
        'text/plain',
      ],
    });
  });

  it('keeps category independent from mimeType — both clauses coexist', async () => {
    await repo.listForOrg(ORG, { mimeType: 'application/pdf', category: 'image' }, PAGINATION);

    const exact = captured.find((c) => c.sql === 'doc.mime_type = :mimeType');
    const cat = captured.find((c) => c.sql === "doc.mime_type LIKE 'image/%'");
    expect(exact?.params).toEqual({ mimeType: 'application/pdf' });
    expect(cat).toBeDefined();
  });

  it('emits no mime_type clause when category is absent', async () => {
    await repo.listForOrg(ORG, {}, PAGINATION);
    expect(findMimeClause(captured)).toBeUndefined();
  });
});
