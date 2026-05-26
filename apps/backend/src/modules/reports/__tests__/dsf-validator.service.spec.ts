import { NotFoundException } from '@nestjs/common';

import { asTenantId } from '../../../common/persistence/tenant-scope';
import type { AccountingPeriodEntity } from '../../journals/entities/accounting-period.entity';
import type { AccountingPeriodRepository } from '../../journals/repositories/accounting-period.repository';
import type { NoteAnnexeCommentEntity } from '../entities/note-annexe-comment.entity';
import type { NoteAnnexeCommentsRepository } from '../repositories/note-annexe-comments.repository';
import { DsfValidatorService } from '../services/dsf-validator.service';
import type {
  BalanceSheetReport,
  ReportsService,
  TrialBalanceReport,
} from '../services/reports.service';

const ORG_ID = asTenantId('00000000-0000-4000-8000-000000000001');
const EXERCISE_ID = '11111111-2222-4333-8444-555555555555';

function annualPeriod(
  overrides: Partial<AccountingPeriodEntity> = {},
): AccountingPeriodEntity {
  return {
    id: EXERCISE_ID,
    organizationId: ORG_ID,
    parentId: null,
    kind: 'ANNUAL',
    label: 'Exercice 2026',
    startDate: '2026-01-01',
    endDate: '2026-12-31',
    status: 'closed',
    closedAt: new Date(),
    closedBy: null,
    reopenedReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as AccountingPeriodEntity;
}

function balancedBilan(): BalanceSheetReport {
  return {
    asAtDate: '2026-12-31',
    actif: { sections: [], total: '1000.00' },
    passif: { sections: [], total: '1000.00' },
    actifMasses: [],
    passifMasses: [],
    unclassified: [],
    totals: { actif: '1000.00', passif: '1000.00', difference: '0.00' },
    netResultIncorporated: null,
    difference: '0.00',
  } as BalanceSheetReport;
}

function balancedTrialBalance(): TrialBalanceReport {
  return {
    fromDate: '2026-01-01',
    toDate: '2026-12-31',
    rows: [],
    totals: {
      openingDebit: '0.00',
      openingCredit: '0.00',
      periodDebit: '500.00',
      periodCredit: '500.00',
      endingDebit: '1000.00',
      endingCredit: '1000.00',
    },
  };
}

function buildHarness(overrides: {
  period?: AccountingPeriodEntity | null;
  children?: AccountingPeriodEntity[];
  bilan?: BalanceSheetReport;
  trialBalance?: TrialBalanceReport;
  comments?: ReadonlyArray<NoteAnnexeCommentEntity>;
} = {}) {
  const period = overrides.period === undefined ? annualPeriod() : overrides.period;
  const children = overrides.children ?? [];
  const bilan = overrides.bilan ?? balancedBilan();
  const trialBalance = overrides.trialBalance ?? balancedTrialBalance();
  const comments = overrides.comments ?? [];

  const reports = {
    getBalanceSheet: jest.fn().mockResolvedValue(bilan),
    getTrialBalance: jest.fn().mockResolvedValue(trialBalance),
  };
  const periodRepo = {
    findById: jest.fn().mockResolvedValue(period),
    listChildren: jest.fn().mockResolvedValue(children),
  };
  const noteCommentsRepo = {
    getByExercise: jest.fn().mockResolvedValue(comments),
  };

  const service = new DsfValidatorService(
    reports as unknown as ReportsService,
    periodRepo as unknown as AccountingPeriodRepository,
    noteCommentsRepo as unknown as NoteAnnexeCommentsRepository,
  );

  return { service, reports, periodRepo, noteCommentsRepo };
}

describe('DsfValidatorService.validate — guards', () => {
  it('throws NotFoundException when the period does not exist', async () => {
    const h = buildHarness({ period: null });
    await expect(h.service.validate(ORG_ID, EXERCISE_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('throws NotFoundException when the period is not annual', async () => {
    const h = buildHarness({
      period: annualPeriod({ kind: 'MONTHLY' }),
    });
    await expect(h.service.validate(ORG_ID, EXERCISE_ID)).rejects.toThrow(/not an annual/);
  });
});

describe('DsfValidatorService.validate — verdict aggregation', () => {
  it("PASS quand tout est conforme et qu'aucun commentaire n'est requis pour les notes par défaut", async () => {
    // Tous les notes par défaut sont marquées N/A explicitement → aucun WARN.
    // Cette config simule un comptable qui a traité toutes les notes.
    const comments = mockCommentsForAllDefaultNotes(false);
    const h = buildHarness({ comments });

    const report = await h.service.validate(ORG_ID, EXERCISE_ID);

    expect(report.verdict).toBe('PASS');
    expect(report.counts).toEqual({ block: 0, warn: 0, info: 0 });
    expect(report.issues).toEqual([]);
  });

  it('BLOCK > WARN > INFO dans le verdict global', async () => {
    const h = buildHarness({
      // BLOCK : bilan déséquilibré
      bilan: {
        ...balancedBilan(),
        totals: { actif: '1500.00', passif: '1000.00', difference: '500.00' },
        difference: '500.00',
      },
      // WARN : période non clôturée
      period: annualPeriod({ status: 'open' }),
    });

    const report = await h.service.validate(ORG_ID, EXERCISE_ID);

    expect(report.verdict).toBe('BLOCK');
    expect(report.counts.block).toBeGreaterThanOrEqual(1);
    expect(report.counts.warn).toBeGreaterThanOrEqual(1);
  });

  it('WARN si que des constats non bloquants', async () => {
    const comments = mockCommentsForAllDefaultNotes(false);
    const h = buildHarness({
      period: annualPeriod({ status: 'open' }),
      comments,
    });

    const report = await h.service.validate(ORG_ID, EXERCISE_ID);

    expect(report.verdict).toBe('WARN');
    expect(report.counts.block).toBe(0);
    expect(report.counts.warn).toBeGreaterThanOrEqual(1);
  });
});

describe('DsfValidatorService.validate — checks individuels', () => {
  it('WARN PERIOD_NOT_CLOSED quand l\'exercice est ouvert', async () => {
    const comments = mockCommentsForAllDefaultNotes(false);
    const h = buildHarness({
      period: annualPeriod({ status: 'open' }),
      comments,
    });

    const report = await h.service.validate(ORG_ID, EXERCISE_ID);

    expect(report.issues.some((i) => i.code === 'PERIOD_NOT_CLOSED')).toBe(true);
  });

  it('WARN CHILD_PERIODS_OPEN quand des sous-périodes sont ouvertes', async () => {
    const comments = mockCommentsForAllDefaultNotes(false);
    const h = buildHarness({
      children: [
        annualPeriod({ id: 'm1', kind: 'MONTHLY', label: 'Janvier', status: 'open' }),
        annualPeriod({ id: 'm2', kind: 'MONTHLY', label: 'Février', status: 'closed' }),
      ],
      comments,
    });

    const report = await h.service.validate(ORG_ID, EXERCISE_ID);

    const issue = report.issues.find((i) => i.code === 'CHILD_PERIODS_OPEN');
    expect(issue).toBeDefined();
    expect(issue?.severity).toBe('WARN');
    expect(issue?.message).toContain('Janvier');
    expect(issue?.message).not.toContain('Février');
  });

  it('BLOCK BILAN_UNBALANCED quand le bilan ne tombe pas en équilibre', async () => {
    const comments = mockCommentsForAllDefaultNotes(false);
    const h = buildHarness({
      bilan: {
        ...balancedBilan(),
        totals: { actif: '1000.00', passif: '999.50', difference: '0.50' },
        difference: '0.50',
      },
      comments,
    });

    const report = await h.service.validate(ORG_ID, EXERCISE_ID);

    const issue = report.issues.find((i) => i.code === 'BILAN_UNBALANCED');
    expect(issue).toBeDefined();
    expect(issue?.severity).toBe('BLOCK');
  });

  it('tolère un écart de 0.01 sur le bilan (rounding epsilon)', async () => {
    const comments = mockCommentsForAllDefaultNotes(false);
    const h = buildHarness({
      bilan: {
        ...balancedBilan(),
        totals: { actif: '1000.01', passif: '1000.00', difference: '0.01' },
        difference: '0.01',
      },
      comments,
    });

    const report = await h.service.validate(ORG_ID, EXERCISE_ID);

    expect(report.issues.some((i) => i.code === 'BILAN_UNBALANCED')).toBe(false);
  });

  it('BLOCK TRIAL_BALANCE_UNBALANCED quand débit/crédit cumulés divergent', async () => {
    const comments = mockCommentsForAllDefaultNotes(false);
    const h = buildHarness({
      trialBalance: {
        ...balancedTrialBalance(),
        totals: {
          openingDebit: '0.00',
          openingCredit: '0.00',
          periodDebit: '500.00',
          periodCredit: '500.00',
          endingDebit: '1000.00',
          endingCredit: '990.00',
        },
      },
      comments,
    });

    const report = await h.service.validate(ORG_ID, EXERCISE_ID);

    const issue = report.issues.find((i) => i.code === 'TRIAL_BALANCE_UNBALANCED');
    expect(issue).toBeDefined();
    expect(issue?.severity).toBe('BLOCK');
  });

  it('WARN PERIOD_MOVEMENTS_UNBALANCED quand les mouvements de la période divergent', async () => {
    const comments = mockCommentsForAllDefaultNotes(false);
    const h = buildHarness({
      trialBalance: {
        ...balancedTrialBalance(),
        totals: {
          openingDebit: '0.00',
          openingCredit: '0.00',
          periodDebit: '500.00',
          periodCredit: '400.00',
          endingDebit: '1000.00',
          endingCredit: '1000.00',
        },
      },
      comments,
    });

    const report = await h.service.validate(ORG_ID, EXERCISE_ID);

    const issue = report.issues.find((i) => i.code === 'PERIOD_MOVEMENTS_UNBALANCED');
    expect(issue).toBeDefined();
    expect(issue?.severity).toBe('WARN');
  });

  it('WARN NOTE_COMMENT_MISSING pour chaque note applicable sans commentaire', async () => {
    const h = buildHarness({ comments: [] });

    const report = await h.service.validate(ORG_ID, EXERCISE_ID);

    const missing = report.issues.filter((i) => i.code === 'NOTE_COMMENT_MISSING');
    expect(missing.length).toBeGreaterThan(0);
    for (const issue of missing) {
      expect(issue.severity).toBe('WARN');
    }
  });

  it('aucun NOTE_COMMENT_MISSING quand la note est marquée non-applicable explicitement', async () => {
    const comments = mockCommentsForAllDefaultNotes(false);
    const h = buildHarness({ comments });

    const report = await h.service.validate(ORG_ID, EXERCISE_ID);

    expect(report.issues.filter((i) => i.code === 'NOTE_COMMENT_MISSING')).toEqual([]);
  });

  it('aucun NOTE_COMMENT_MISSING quand la note a un commentaire non vide', async () => {
    const comments = mockCommentsForAllDefaultNotes(true);
    const h = buildHarness({ comments });

    const report = await h.service.validate(ORG_ID, EXERCISE_ID);

    expect(report.issues.filter((i) => i.code === 'NOTE_COMMENT_MISSING')).toEqual([]);
  });

  it('INFO UNCLASSIFIED_ACCOUNTS quand le bilan a des comptes hors hiérarchie', async () => {
    const comments = mockCommentsForAllDefaultNotes(false);
    const h = buildHarness({
      bilan: {
        ...balancedBilan(),
        unclassified: [
          {
            code: '999',
            label: 'Compte exotique',
            side: 'ACTIF',
            net: '42.50',
          },
        ],
      },
      comments,
    });

    const report = await h.service.validate(ORG_ID, EXERCISE_ID);

    const issue = report.issues.find((i) => i.code === 'UNCLASSIFIED_ACCOUNTS');
    expect(issue).toBeDefined();
    expect(issue?.severity).toBe('INFO');
    expect(issue?.context?.codes).toEqual(['999']);
  });
});

describe('DsfValidatorService.validate — payload', () => {
  it('inclut bien les méta de la période dans le rapport', async () => {
    const comments = mockCommentsForAllDefaultNotes(false);
    const h = buildHarness({ comments });

    const report = await h.service.validate(ORG_ID, EXERCISE_ID);

    expect(report.exerciseId).toBe(EXERCISE_ID);
    expect(report.exerciseLabel).toBe('Exercice 2026');
    expect(report.periodStart).toBe('2026-01-01');
    expect(report.periodEnd).toBe('2026-12-31');
    expect(report.fiscalYear).toBe(2026);
    expect(typeof report.validatedAt).toBe('string');
    expect(report.validatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

// ─── helpers ──────────────────────────────────────────────────────────

/**
 * Construit un set de commentaires couvrant toutes les notes
 * `applicableByDefault: true` du registry. Permet de tester PASS
 * sans bruit de NOTE_COMMENT_MISSING.
 *
 * `withContent = true` → applicable, commentaire non vide
 * `withContent = false` → marqué N/A explicitement (applicable=false)
 */
function mockCommentsForAllDefaultNotes(withContent: boolean): NoteAnnexeCommentEntity[] {
  // Import dynamique au runtime pour éviter de re-déclarer la liste
  // des notes par défaut — on les lit directement depuis le registry.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const reg = require('../services/notes-annexes/note-registry') as {
    NOTE_REGISTRY: ReadonlyMap<string, { metadata: { applicableByDefault: boolean } }>;
  };
  const out: NoteAnnexeCommentEntity[] = [];
  for (const [noteId, entry] of reg.NOTE_REGISTRY.entries()) {
    if (!entry.metadata.applicableByDefault) continue;
    out.push({
      id: `c-${noteId}`,
      organizationId: ORG_ID,
      exerciseId: EXERCISE_ID,
      noteId,
      commentText: withContent ? 'commentaire test' : '',
      applicable: withContent,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as unknown as NoteAnnexeCommentEntity);
  }
  return out;
}
