import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { assertTenantId, type TenantId } from '../../../common/persistence/tenant-scope';
import { OrganizationDsfProfileEntity } from '../entities/organization-dsf-profile.entity';

/**
 * Fields écrasables lors d'un upsert. Aucun n'est requis : la mise à
 * jour est purement incrémentale. `notesApplicable` et
 * `workforceByQualification` remplacent intégralement le JSONB côté DB
 * — le service amont fait la fusion s'il veut un patch partiel.
 */
export interface UpsertDsfProfileInput {
  readonly legalForm?: string | null;
  readonly taxRegime?: string | null;
  readonly country?: string | null;
  readonly ninea?: string | null;
  readonly rccm?: string | null;
  readonly siegeAddress?: string | null;
  readonly siegeCity?: string | null;
  readonly phone?: string | null;
  readonly email?: string | null;
  readonly capital?: string | null;
  readonly currency?: string;
  readonly activitySector?: string | null;
  readonly directorName?: string | null;
  readonly directorTitle?: string | null;
  readonly presidentName?: string | null;
  readonly auditorName?: string | null;
  readonly notesApplicable?: Record<string, boolean>;
  readonly workforceByQualification?: Record<string, number>;
}

/**
 * `OrganizationDsfProfilesRepository` — accès à la table 1:1 du profile
 * DSF d'une organisation (cf. migration 0106). Scoped tenant via
 * `assertTenantId` sur chaque appel public.
 *
 * L'upsert s'appuie sur la contrainte UNIQUE `organization_id` posée
 * par la migration : `INSERT ... ON CONFLICT (organization_id) DO
 * UPDATE` garantit qu'au plus une ligne existe par tenant, sans
 * race condition.
 */
@Injectable()
export class OrganizationDsfProfilesRepository {
  constructor(
    @InjectRepository(OrganizationDsfProfileEntity)
    private readonly repo: Repository<OrganizationDsfProfileEntity>,
  ) {}

  async findByOrg(organizationId: TenantId | string): Promise<OrganizationDsfProfileEntity | null> {
    assertTenantId(organizationId);
    return this.repo.findOne({ where: { organizationId } });
  }

  /**
   * Crée un profile vierge si absent, sans toucher aux champs s'il
   * existe déjà. Utilisé par `getOrCreateProfile` pour matérialiser
   * l'agrégat lors du premier accès.
   */
  async ensureExists(organizationId: TenantId | string): Promise<OrganizationDsfProfileEntity> {
    assertTenantId(organizationId);
    const existing = await this.repo.findOne({ where: { organizationId } });
    if (existing) {
      return existing;
    }
    const created = this.repo.create({
      organizationId,
      notesApplicable: {},
      workforceByQualification: {},
      currency: 'XOF',
    });
    return this.repo.save(created);
  }

  /**
   * Upsert. Si le profile n'existe pas il est créé avec les champs
   * fournis ; s'il existe les champs `undefined` du DTO sont
   * préservés (le repo n'écrase pas avec `undefined`).
   */
  async upsert(
    organizationId: TenantId | string,
    input: UpsertDsfProfileInput,
  ): Promise<OrganizationDsfProfileEntity> {
    assertTenantId(organizationId);

    const existing = await this.repo.findOne({ where: { organizationId } });
    if (existing) {
      const merged = this.mergePatch(existing, input);
      return this.repo.save(merged);
    }

    const created = this.repo.create({
      organizationId,
      ...this.normaliseInsertInput(input),
    });
    return this.repo.save(created);
  }

  private mergePatch(
    current: OrganizationDsfProfileEntity,
    patch: UpsertDsfProfileInput,
  ): OrganizationDsfProfileEntity {
    const merged: OrganizationDsfProfileEntity = { ...current };
    const keys = Object.keys(patch) as ReadonlyArray<keyof UpsertDsfProfileInput>;
    for (const key of keys) {
      const value = patch[key];
      if (value !== undefined) {
        // Cast à `unknown` puis assignation : on assigne champ par
        // champ et chaque clé est typée identiquement des deux côtés.
        (merged as unknown as Record<string, unknown>)[key] = value;
      }
    }
    return merged;
  }

  private normaliseInsertInput(
    input: UpsertDsfProfileInput,
  ): Partial<OrganizationDsfProfileEntity> {
    return {
      legalForm: input.legalForm ?? null,
      taxRegime: input.taxRegime ?? null,
      country: input.country ?? null,
      ninea: input.ninea ?? null,
      rccm: input.rccm ?? null,
      siegeAddress: input.siegeAddress ?? null,
      siegeCity: input.siegeCity ?? null,
      phone: input.phone ?? null,
      email: input.email ?? null,
      capital: input.capital ?? null,
      currency: input.currency ?? 'XOF',
      activitySector: input.activitySector ?? null,
      directorName: input.directorName ?? null,
      directorTitle: input.directorTitle ?? null,
      presidentName: input.presidentName ?? null,
      auditorName: input.auditorName ?? null,
      notesApplicable: input.notesApplicable ?? {},
      workforceByQualification: input.workforceByQualification ?? {},
    };
  }
}
