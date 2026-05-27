import { Injectable } from '@nestjs/common';

import { AppException } from '../../../common/errors/app-exception';
import { ERROR_CODES } from '../../../common/errors/error-codes';
import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import { AccountingPeriodRepository } from '../../journals/repositories/accounting-period.repository';
import { OrganizationRepository } from '../../organizations/repositories/organization.repository';
import {
  assertValidNotesApplicable,
  assertValidWorkforce,
  UpdateDsfProfileDto,
} from '../dto/update-dsf-profile.dto';
import { OrganizationDsfProfileEntity } from '../entities/organization-dsf-profile.entity';
import { OrganizationDsfProfilesRepository } from '../repositories/organization-dsf-profiles.repository';
import {
  AUDCIF_ANNEXE_NOTES,
  type CoverPageData,
  type DirectorsFicheData,
  type DsfIdentificationBundle,
  type IdentificationFicheData,
  type NoteApplicabilityEntry,
  type NotesApplicabilityFicheData,
} from '../types/dsf-profile.types';

/**
 * `DsfIdentificationService` — W5.1.
 *
 * Assemble les Fiches R1 (page de garde), R2 (identification), R3
 * (dirigeants) et R4 (applicabilité des 36 notes annexes) de la
 * liasse SYSCOHADA à partir du profile DSF de l'organisation et de
 * l'entité `organizations` (raison sociale + slug) + de l'exercice
 * comptable (dates).
 *
 * Le service ne fait *aucune* écriture comptable ; il lit le profile
 * et compose des DTO immuables que le futur builder PDF (W5.x)
 * consommera. Le wiring REST / UI est reporté en follow-up — voir
 * la note "Contraintes" du ticket.
 */
@Injectable()
export class DsfIdentificationService {
  constructor(
    private readonly profiles: OrganizationDsfProfilesRepository,
    private readonly orgs: OrganizationRepository,
    private readonly periods: AccountingPeriodRepository,
  ) {}

  /**
   * Récupère le profile s'il existe, sinon en crée un vierge. Sert
   * de point d'entrée idempotent pour l'UI de saisie : appeler
   * `GET /dsf/profile` (futur controller) ⇒ matérialise l'agrégat.
   */
  async getOrCreateProfile(
    organizationId: TenantId | string,
  ): Promise<OrganizationDsfProfileEntity> {
    assertTenantId(organizationId);
    return this.profiles.ensureExists(organizationId);
  }

  /**
   * Patch incrémental du profile. Les champs `undefined` du DTO sont
   * préservés (cf. `OrganizationDsfProfilesRepository.upsert`). Les
   * payloads JSONB sont revalidés runtime avant l'écriture pour
   * compléter ce que class-validator ne sait pas exprimer
   * proprement (Record d'union typés).
   */
  async updateProfile(
    organizationId: TenantId | string,
    dto: UpdateDsfProfileDto,
  ): Promise<OrganizationDsfProfileEntity> {
    assertTenantId(organizationId);

    if (dto.notesApplicable !== undefined) {
      try {
        assertValidNotesApplicable(dto.notesApplicable);
      } catch (error: unknown) {
        throw new AppException(ERROR_CODES.DSF_PROFILE_INVALID, {
          message: error instanceof Error ? error.message : 'Invalid notesApplicable payload',
          details: { field: 'notesApplicable' },
        });
      }
    }
    if (dto.workforceByQualification !== undefined) {
      try {
        assertValidWorkforce(dto.workforceByQualification);
      } catch (error: unknown) {
        throw new AppException(ERROR_CODES.DSF_PROFILE_INVALID, {
          message:
            error instanceof Error ? error.message : 'Invalid workforceByQualification payload',
          details: { field: 'workforceByQualification' },
        });
      }
    }

    return this.profiles.upsert(organizationId, dto);
  }

  /**
   * R1 — Page de garde DSF.
   *
   * Requiert : exercice résoluble, organization active. Lève
   * `DSF_PROFILE_NOT_FOUND` si l'exercice n'existe pas et
   * `DSF_PROFILE_INVALID` si la raison sociale est introuvable.
   */
  async buildCoverPage(
    organizationId: TenantId | string,
    exerciseId: string,
  ): Promise<CoverPageData> {
    assertTenantId(organizationId);

    const [profile, org, period] = await Promise.all([
      this.profiles.ensureExists(organizationId),
      this.orgs.findActiveById(organizationId),
      this.periods.findById(exerciseId, organizationId as TenantId),
    ]);

    if (!org) {
      throw new AppException(ERROR_CODES.DSF_PROFILE_INVALID, {
        message: 'Organization not found or soft-deleted; cannot build cover page',
        details: { organizationId },
      });
    }
    if (!period) {
      throw new AppException(ERROR_CODES.DSF_PROFILE_NOT_FOUND, {
        message: `Accounting period ${exerciseId} not found for tenant`,
        details: { exerciseId },
      });
    }

    return {
      organizationName: org.name,
      organizationSlug: org.slug,
      legalForm: profile.legalForm,
      capital: profile.capital,
      currency: profile.currency,
      exerciseId: period.id,
      exerciseLabel: period.label,
      exerciseStartDate: period.startDate,
      exerciseEndDate: period.endDate,
      country: profile.country,
    };
  }

  /**
   * R2 — Fiche d'identification. Validation : adresse siège, NINEA,
   * et secteur d'activité sont requis pour considérer la fiche
   * "complète". L'absence ⇒ `DSF_PROFILE_INVALID` plutôt qu'une
   * fiche silencieusement vide (la doctrine impose ces 3 minima).
   */
  async buildIdentificationFiche(
    organizationId: TenantId | string,
  ): Promise<IdentificationFicheData> {
    assertTenantId(organizationId);
    const [profile, org] = await Promise.all([
      this.profiles.ensureExists(organizationId),
      this.orgs.findActiveById(organizationId),
    ]);

    if (!org) {
      throw new AppException(ERROR_CODES.DSF_PROFILE_INVALID, {
        message: 'Organization not found or soft-deleted; cannot build identification',
        details: { organizationId },
      });
    }

    const missing: string[] = [];
    if (!profile.siegeAddress) missing.push('siegeAddress');
    if (!profile.ninea) missing.push('ninea');
    if (!profile.activitySector) missing.push('activitySector');
    if (missing.length > 0) {
      throw new AppException(ERROR_CODES.DSF_PROFILE_INVALID, {
        message: `Cannot build R2 — missing required fields: ${missing.join(', ')}`,
        details: { missingFields: missing },
      });
    }

    const workforceTotal = Object.values(profile.workforceByQualification ?? {}).reduce(
      (acc, n) => acc + (typeof n === 'number' ? n : 0),
      0,
    );

    return {
      organizationName: org.name,
      legalForm: profile.legalForm,
      taxRegime: profile.taxRegime,
      country: profile.country,
      ninea: profile.ninea,
      rccm: profile.rccm,
      siegeAddress: profile.siegeAddress,
      siegeCity: profile.siegeCity,
      phone: profile.phone,
      email: profile.email,
      activitySector: profile.activitySector,
      workforceByQualification: { ...(profile.workforceByQualification ?? {}) },
      workforceTotal,
    };
  }

  /**
   * R3 — Dirigeants. Pas de champs strictement obligatoires (une
   * entreprise individuelle n'a ni président ni commissaire) — on
   * remonte ce qui est saisi.
   */
  async buildDirectorsFiche(
    organizationId: TenantId | string,
  ): Promise<DirectorsFicheData> {
    assertTenantId(organizationId);
    const profile = await this.profiles.ensureExists(organizationId);
    return {
      directorName: profile.directorName,
      directorTitle: profile.directorTitle,
      presidentName: profile.presidentName,
      auditorName: profile.auditorName,
    };
  }

  /**
   * R4 — Tableau d'applicabilité des 36 notes annexes AUDCIF.
   * Toute note absente du Record `notesApplicable` est considérée
   * NOT_APPLICABLE par défaut.
   */
  async buildNotesApplicabilityFiche(
    organizationId: TenantId | string,
  ): Promise<NotesApplicabilityFicheData> {
    assertTenantId(organizationId);
    const profile = await this.profiles.ensureExists(organizationId);
    const map = profile.notesApplicable ?? {};

    const entries: NoteApplicabilityEntry[] = AUDCIF_ANNEXE_NOTES.map((noteId) => ({
      noteId,
      status: map[noteId] === true ? 'APPLICABLE' : 'NOT_APPLICABLE',
    }));

    const applicableCount = entries.filter((e) => e.status === 'APPLICABLE').length;
    return {
      totalNotes: AUDCIF_ANNEXE_NOTES.length,
      applicableCount,
      notApplicableCount: AUDCIF_ANNEXE_NOTES.length - applicableCount,
      entries,
    };
  }

  /**
   * Bundle complet R1 + R2 + R3 + R4 pour les consommateurs en aval
   * (futur PDF builder, REST controller, exports). Si l'une des
   * fiches échoue (ex. R2 incomplet), l'erreur AppException
   * remonte telle quelle pour que l'appelant la mappe en HTTP
   * propre.
   */
  async buildAllFiches(
    organizationId: TenantId | string,
    exerciseId: string,
  ): Promise<DsfIdentificationBundle> {
    assertTenantId(organizationId);
    const [coverPage, r2, r3, r4] = await Promise.all([
      this.buildCoverPage(organizationId, exerciseId),
      this.buildIdentificationFiche(organizationId),
      this.buildDirectorsFiche(organizationId),
      this.buildNotesApplicabilityFiche(organizationId),
    ]);
    return { coverPage, r2, r3, r4 };
  }
}
