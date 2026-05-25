import type { TvaCodeEntity } from '../entities/tva-code.entity';
import type { TvaDeclarationLineEntity } from '../entities/tva-declaration-line.entity';
import type { TvaDeclarationEntity } from '../entities/tva-declaration.entity';
import {
  toEnvelopeCode,
  toEnvelopeDeclaration,
  toListCodes,
  toListDeclarations,
  toTvaCodeResponse,
  toTvaDeclarationLineResponse,
  toTvaDeclarationResponse,
} from './tva-response.mapper';

const FIXED_DATE = new Date('2026-05-25T10:00:00.000Z');

function buildLine(overrides: Partial<TvaDeclarationLineEntity> = {}): TvaDeclarationLineEntity {
  return {
    id: 'line-1',
    declarationId: 'decl-1',
    declaration: undefined as never,
    direction: 'collected',
    accountPrefix: '443',
    accountLabel: 'TVA collectée',
    amount: '1850000.00',
    createdAt: FIXED_DATE,
    ...overrides,
  } as TvaDeclarationLineEntity;
}

function buildDeclaration(
  overrides: Partial<TvaDeclarationEntity> = {},
): TvaDeclarationEntity {
  return {
    id: 'decl-1',
    organizationId: 'org-1',
    organization: undefined as never,
    periodYear: 2026,
    periodMonth: 5,
    status: 'calculated',
    tvaCollecteeTotal: '1850000.00',
    tvaDeductibleBsTotal: '420000.00',
    tvaDeductibleImmoTotal: '180000.00',
    tvaADecaisser: '1250000.00',
    creditTvaReportable: '0.00',
    computedAt: FIXED_DATE,
    computedById: 'user-1',
    cancelledAt: null,
    cancelledById: null,
    cancelledReason: null,
    createdAt: FIXED_DATE,
    updatedAt: FIXED_DATE,
    lines: [buildLine()],
    ...overrides,
  } as TvaDeclarationEntity;
}

function buildCode(overrides: Partial<TvaCodeEntity> = {}): TvaCodeEntity {
  return {
    id: 'code-1',
    organizationId: 'org-1',
    organization: undefined as never,
    code: 'TVA-N-18',
    label: 'TVA Normale 18%',
    rate: '18.00',
    type: 'both',
    kind: 'normal',
    isActive: true,
    createdAt: FIXED_DATE,
    updatedAt: FIXED_DATE,
    ...overrides,
  } as TvaCodeEntity;
}

describe('tva-response.mapper', () => {
  describe('toTvaDeclarationLineResponse', () => {
    it('maps every line field including string amount and nullable label', () => {
      const line = buildLine({ accountLabel: null });
      const dto = toTvaDeclarationLineResponse(line);

      expect(dto).toEqual({
        id: 'line-1',
        declarationId: 'decl-1',
        direction: 'collected',
        accountPrefix: '443',
        accountLabel: null,
        amount: '1850000.00',
        createdAt: FIXED_DATE,
      });
    });
  });

  describe('toTvaDeclarationResponse', () => {
    it('maps a declaration including its lines', () => {
      const decl = buildDeclaration();
      const dto = toTvaDeclarationResponse(decl);

      expect(dto.id).toBe('decl-1');
      expect(dto.organizationId).toBe('org-1');
      expect(dto.status).toBe('calculated');
      expect(dto.tvaCollecteeTotal).toBe('1850000.00');
      expect(dto.lines).toHaveLength(1);
      expect(dto.lines[0]).toEqual({
        id: 'line-1',
        declarationId: 'decl-1',
        direction: 'collected',
        accountPrefix: '443',
        accountLabel: 'TVA collectée',
        amount: '1850000.00',
        createdAt: FIXED_DATE,
      });
    });

    it('falls back to an empty array when lines is not loaded', () => {
      const decl = buildDeclaration({ lines: undefined as never });
      const dto = toTvaDeclarationResponse(decl);
      expect(dto.lines).toEqual([]);
    });

    it('does not mutate the source entity', () => {
      const decl = buildDeclaration();
      const snapshot = JSON.parse(JSON.stringify(decl));

      toTvaDeclarationResponse(decl);

      expect(JSON.parse(JSON.stringify(decl))).toEqual(snapshot);
    });

    it('is idempotent (same input → equal output)', () => {
      const decl = buildDeclaration();
      const dto1 = toTvaDeclarationResponse(decl);
      const dto2 = toTvaDeclarationResponse(decl);

      expect(dto1).toEqual(dto2);
    });
  });

  describe('toTvaCodeResponse', () => {
    it('maps a tva code with rate kept as string', () => {
      const code = buildCode();
      const dto = toTvaCodeResponse(code);

      expect(dto).toEqual({
        id: 'code-1',
        organizationId: 'org-1',
        code: 'TVA-N-18',
        label: 'TVA Normale 18%',
        rate: '18.00',
        type: 'both',
        kind: 'normal',
        isActive: true,
        createdAt: FIXED_DATE,
        updatedAt: FIXED_DATE,
      });
    });

    it('does not mutate the source entity', () => {
      const code = buildCode();
      const snapshot = JSON.parse(JSON.stringify(code));

      toTvaCodeResponse(code);

      expect(JSON.parse(JSON.stringify(code))).toEqual(snapshot);
    });

    it('is idempotent', () => {
      const code = buildCode();
      expect(toTvaCodeResponse(code)).toEqual(toTvaCodeResponse(code));
    });
  });

  describe('envelope wrappers', () => {
    it('wraps a single declaration', () => {
      const decl = buildDeclaration();
      const envelope = toEnvelopeDeclaration(decl);

      expect(envelope.declaration.id).toBe('decl-1');
      expect(envelope.declaration.lines).toHaveLength(1);
    });

    it('wraps a list of declarations', () => {
      const decl = buildDeclaration();
      const list = toListDeclarations([decl, buildDeclaration({ id: 'decl-2' })]);

      expect(list.declarations).toHaveLength(2);
      expect(list.declarations[0]?.id).toBe('decl-1');
      expect(list.declarations[1]?.id).toBe('decl-2');
    });

    it('wraps a single code', () => {
      const code = buildCode();
      const envelope = toEnvelopeCode(code);

      expect(envelope.code.id).toBe('code-1');
    });

    it('wraps a list of codes', () => {
      const list = toListCodes([buildCode(), buildCode({ id: 'code-2', code: 'TVA-N-09' })]);

      expect(list.codes).toHaveLength(2);
      expect(list.codes[1]?.code).toBe('TVA-N-09');
    });
  });
});
