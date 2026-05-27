import { AppException } from '../../../common/errors/app-exception';
import { asTenantId } from '../../../common/persistence/tenant-scope';
import type { AccountingPeriodEntity } from '../../journals/entities/accounting-period.entity';
import type { AccountingPeriodRepository } from '../../journals/repositories/accounting-period.repository';
import type { OrganizationEntity } from '../../organizations/entities/organization.entity';
import type { OrganizationRepository } from '../../organizations/repositories/organization.repository';
import type { OrganizationDsfProfileEntity } from '../entities/organization-dsf-profile.entity';
import type { OrganizationDsfProfilesRepository } from '../repositories/organization-dsf-profiles.repository';
import { DsfIdentificationService } from '../services/dsf-identification.service';
import { AUDCIF_ANNEXE_NOTES } from '../types/dsf-profile.types';

const ORG_ID = asTenantId('00000000-0000-4000-8000-000000000001');
const OTHER_ORG_ID = asTenantId('00000000-0000-4000-8000-000000000002');
const EXERCISE_ID = '11111111-2222-4333-8444-555555555555';

function buildProfile(
  overrides: Partial<OrganizationDsfProfileEntity> = {},
): OrganizationDsfProfileEntity {
  return {
    id: 'profile-1',
    organizationId: ORG_ID,
    legalForm: 'SA',
    taxRegime: 'IS',
    country: 'CIV',
    ninea: '1234567890123',
    rccm: 'CI-ABJ-2024-B-1234',
    siegeAddress: 'Plateau, Rue du Commerce',
    siegeCity: 'Abidjan',
    phone: '+225 27 20 30 40 50',
    email: 'contact@example.ci',
    capital: '10000000.00',
    currency: 'XOF',
    activitySector: 'Commerce',
    directorName: 'Jean Dupont',
    directorTitle: 'Directeur Général',
    presidentName: 'M. Diakité',
    auditorName: 'Cabinet Bilan & Audit',
    notesApplicable: { N1: true, N2: true, N5: false },
    workforceByQualification: { 'YA cadres': 5, 'YB maîtrise': 12 },
    organization: {} as OrganizationEntity,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function buildOrg(overrides: Partial<OrganizationEntity> = {}): OrganizationEntity {
  return {
    id: ORG_ID,
    name: 'Acme SA',
    slug: 'acme-sa',
    type: 'company',
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  } as OrganizationEntity;
}

function buildPeriod(
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
    status: 'open',
    closedAt: null,
    closedBy: null,
    reopenedReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as AccountingPeriodEntity;
}

interface Harness {
  service: DsfIdentificationService;
  profiles: {
    findByOrg: jest.Mock;
    ensureExists: jest.Mock;
    upsert: jest.Mock;
  };
  orgs: { findActiveById: jest.Mock };
  periods: { findById: jest.Mock };
}

function buildHarness(opts: {
  profile?: OrganizationDsfProfileEntity | null;
  org?: OrganizationEntity | null;
  period?: AccountingPeriodEntity | null;
} = {}): Harness {
  const profile = opts.profile === undefined ? buildProfile() : opts.profile;
  const org = opts.org === undefined ? buildOrg() : opts.org;
  const period = opts.period === undefined ? buildPeriod() : opts.period;

  const profiles = {
    findByOrg: jest.fn().mockResolvedValue(profile),
    ensureExists: jest.fn().mockImplementation(async (orgId: string) => {
      if (profile && profile.organizationId === orgId) return profile;
      return buildProfile({
        organizationId: orgId,
        legalForm: null,
        taxRegime: null,
        country: null,
        ninea: null,
        rccm: null,
        siegeAddress: null,
        siegeCity: null,
        phone: null,
        email: null,
        capital: null,
        activitySector: null,
        directorName: null,
        directorTitle: null,
        presidentName: null,
        auditorName: null,
        notesApplicable: {},
        workforceByQualification: {},
      });
    }),
    upsert: jest.fn().mockImplementation(async (orgId: string, patch: Record<string, unknown>) => {
      const base = profile ?? buildProfile({ organizationId: orgId });
      return { ...base, ...patch };
    }),
  };

  const orgs = {
    findActiveById: jest.fn().mockResolvedValue(org),
  };
  const periods = {
    findById: jest.fn().mockResolvedValue(period),
  };

  const service = new DsfIdentificationService(
    profiles as unknown as OrganizationDsfProfilesRepository,
    orgs as unknown as OrganizationRepository,
    periods as unknown as AccountingPeriodRepository,
  );

  return { service, profiles, orgs, periods };
}

describe('DsfIdentificationService.getOrCreateProfile', () => {
  it('returns existing profile when present', async () => {
    const h = buildHarness();
    const out = await h.service.getOrCreateProfile(ORG_ID);
    expect(out.organizationId).toBe(ORG_ID);
    expect(h.profiles.ensureExists).toHaveBeenCalledWith(ORG_ID);
  });

  it('creates a blank profile when none exists', async () => {
    const h = buildHarness({ profile: null });
    const out = await h.service.getOrCreateProfile(OTHER_ORG_ID);
    expect(out.organizationId).toBe(OTHER_ORG_ID);
    expect(out.ninea).toBeNull();
    expect(out.notesApplicable).toEqual({});
  });

  it('rejects empty organizationId via tenant guard', async () => {
    const h = buildHarness();
    await expect(h.service.getOrCreateProfile('')).rejects.toThrow(
      /Tenant scope violation/,
    );
  });
});

describe('DsfIdentificationService.updateProfile', () => {
  it('patches provided fields and preserves the rest', async () => {
    const h = buildHarness();
    const out = await h.service.updateProfile(ORG_ID, {
      legalForm: 'SARL',
      capital: '5000000.00',
    });
    expect(out.legalForm).toBe('SARL');
    expect(out.capital).toBe('5000000.00');
    expect(h.profiles.upsert).toHaveBeenCalledWith(
      ORG_ID,
      expect.objectContaining({ legalForm: 'SARL', capital: '5000000.00' }),
    );
  });

  it('throws DSF_PROFILE_INVALID on malformed notesApplicable', async () => {
    const h = buildHarness();
    await expect(
      h.service.updateProfile(ORG_ID, {
        notesApplicable: { invalid_key: true } as unknown as Record<string, boolean>,
      }),
    ).rejects.toMatchObject({
      code: 'DSF_PROFILE_INVALID',
      status: 422,
    });
    expect(h.profiles.upsert).not.toHaveBeenCalled();
  });

  it('throws DSF_PROFILE_INVALID on negative workforce count', async () => {
    const h = buildHarness();
    await expect(
      h.service.updateProfile(ORG_ID, {
        workforceByQualification: { 'YA cadres': -3 },
      }),
    ).rejects.toBeInstanceOf(AppException);
  });
});

describe('DsfIdentificationService.buildCoverPage (R1)', () => {
  it('assembles complete CoverPageData', async () => {
    const h = buildHarness();
    const out = await h.service.buildCoverPage(ORG_ID, EXERCISE_ID);
    expect(out).toEqual(
      expect.objectContaining({
        organizationName: 'Acme SA',
        organizationSlug: 'acme-sa',
        legalForm: 'SA',
        capital: '10000000.00',
        currency: 'XOF',
        exerciseId: EXERCISE_ID,
        exerciseLabel: 'Exercice 2026',
        exerciseStartDate: '2026-01-01',
        exerciseEndDate: '2026-12-31',
        country: 'CIV',
      }),
    );
  });

  it('throws DSF_PROFILE_NOT_FOUND when exercise is missing', async () => {
    const h = buildHarness({ period: null });
    await expect(h.service.buildCoverPage(ORG_ID, EXERCISE_ID)).rejects.toMatchObject({
      code: 'DSF_PROFILE_NOT_FOUND',
      status: 404,
    });
  });

  it('throws DSF_PROFILE_INVALID when organization is soft-deleted', async () => {
    const h = buildHarness({ org: null });
    await expect(h.service.buildCoverPage(ORG_ID, EXERCISE_ID)).rejects.toMatchObject({
      code: 'DSF_PROFILE_INVALID',
      status: 422,
    });
  });
});

describe('DsfIdentificationService.buildIdentificationFiche (R2)', () => {
  it('returns IdentificationFicheData with workforce total', async () => {
    const h = buildHarness();
    const out = await h.service.buildIdentificationFiche(ORG_ID);
    expect(out.organizationName).toBe('Acme SA');
    expect(out.ninea).toBe('1234567890123');
    expect(out.workforceTotal).toBe(17);
    expect(out.workforceByQualification).toEqual({ 'YA cadres': 5, 'YB maîtrise': 12 });
  });

  it('throws DSF_PROFILE_INVALID when siegeAddress is missing', async () => {
    const h = buildHarness({ profile: buildProfile({ siegeAddress: null }) });
    await expect(h.service.buildIdentificationFiche(ORG_ID)).rejects.toMatchObject({
      code: 'DSF_PROFILE_INVALID',
      details: expect.objectContaining({ missingFields: expect.arrayContaining(['siegeAddress']) }),
    });
  });

  it('lists every missing required field in details', async () => {
    const h = buildHarness({
      profile: buildProfile({ ninea: null, activitySector: null, siegeAddress: null }),
    });
    await expect(h.service.buildIdentificationFiche(ORG_ID)).rejects.toMatchObject({
      details: expect.objectContaining({
        missingFields: expect.arrayContaining(['siegeAddress', 'ninea', 'activitySector']),
      }),
    });
  });
});

describe('DsfIdentificationService.buildDirectorsFiche (R3)', () => {
  it('returns dirigeants data verbatim', async () => {
    const h = buildHarness();
    const out = await h.service.buildDirectorsFiche(ORG_ID);
    expect(out).toEqual({
      directorName: 'Jean Dupont',
      directorTitle: 'Directeur Général',
      presidentName: 'M. Diakité',
      auditorName: 'Cabinet Bilan & Audit',
    });
  });

  it('returns nulls for an empty profile', async () => {
    const h = buildHarness({
      profile: buildProfile({
        directorName: null,
        directorTitle: null,
        presidentName: null,
        auditorName: null,
      }),
    });
    const out = await h.service.buildDirectorsFiche(ORG_ID);
    expect(out).toEqual({
      directorName: null,
      directorTitle: null,
      presidentName: null,
      auditorName: null,
    });
  });
});

describe('DsfIdentificationService.buildNotesApplicabilityFiche (R4)', () => {
  it('returns one entry per AUDCIF note with proper status', async () => {
    const h = buildHarness();
    const out = await h.service.buildNotesApplicabilityFiche(ORG_ID);
    expect(out.totalNotes).toBe(AUDCIF_ANNEXE_NOTES.length);
    expect(out.entries).toHaveLength(AUDCIF_ANNEXE_NOTES.length);

    const n1 = out.entries.find((e) => e.noteId === 'N1');
    const n5 = out.entries.find((e) => e.noteId === 'N5');
    const n10 = out.entries.find((e) => e.noteId === 'N10');
    expect(n1?.status).toBe('APPLICABLE');
    expect(n5?.status).toBe('NOT_APPLICABLE');
    expect(n10?.status).toBe('NOT_APPLICABLE'); // absent from map ⇒ default
    expect(out.applicableCount).toBe(2);
    expect(out.notApplicableCount).toBe(AUDCIF_ANNEXE_NOTES.length - 2);
  });

  it('defaults all notes to NOT_APPLICABLE for an empty map', async () => {
    const h = buildHarness({ profile: buildProfile({ notesApplicable: {} }) });
    const out = await h.service.buildNotesApplicabilityFiche(ORG_ID);
    expect(out.applicableCount).toBe(0);
    expect(out.notApplicableCount).toBe(AUDCIF_ANNEXE_NOTES.length);
  });
});

describe('DsfIdentificationService.buildAllFiches', () => {
  it('returns the full DsfIdentificationBundle', async () => {
    const h = buildHarness();
    const out = await h.service.buildAllFiches(ORG_ID, EXERCISE_ID);
    expect(out.coverPage.organizationName).toBe('Acme SA');
    expect(out.r2.ninea).toBe('1234567890123');
    expect(out.r3.directorName).toBe('Jean Dupont');
    expect(out.r4.totalNotes).toBe(AUDCIF_ANNEXE_NOTES.length);
  });

  it('propagates DSF_PROFILE_INVALID from R2 when profile is incomplete', async () => {
    const h = buildHarness({ profile: buildProfile({ ninea: null }) });
    await expect(h.service.buildAllFiches(ORG_ID, EXERCISE_ID)).rejects.toMatchObject({
      code: 'DSF_PROFILE_INVALID',
    });
  });
});

describe('DsfIdentificationService — tenant isolation', () => {
  it('forwards the requested tenant to every repository call', async () => {
    const h = buildHarness({ profile: null });
    await h.service.getOrCreateProfile(OTHER_ORG_ID);
    expect(h.profiles.ensureExists).toHaveBeenCalledWith(OTHER_ORG_ID);
    expect(h.profiles.ensureExists).not.toHaveBeenCalledWith(ORG_ID);
  });

  it('forwards tenant on buildCoverPage to org + period repos', async () => {
    const h = buildHarness();
    await h.service.buildCoverPage(ORG_ID, EXERCISE_ID);
    expect(h.orgs.findActiveById).toHaveBeenCalledWith(ORG_ID);
    expect(h.periods.findById).toHaveBeenCalledWith(EXERCISE_ID, ORG_ID);
  });
});
