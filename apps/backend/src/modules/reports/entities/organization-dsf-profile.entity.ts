import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { OrganizationEntity } from '../../organizations/entities/organization.entity';

/**
 * Carte d'identité SYSCOHADA d'une organisation pour la liasse DSF
 * (Tome 3 p. 18-31). Un seul profile par `organizationId` — la
 * contrainte UNIQUE côté DB l'impose. Voir migration 0106.
 *
 * Cet agrégat alimente :
 *   - R1 : page de garde (raison sociale via FK org + capital + forme
 *     juridique + exercice clos résolu par `DsfIdentificationService`)
 *   - R2 : identification (adresse siège, NINEA, RCCM, IFU, secteur)
 *   - R3 : dirigeants (DG, président, commissaire aux comptes)
 *   - R4 : applicabilité des 36 notes annexes (case A/N/A par note)
 *
 * Tous les champs textuels sont nullables : un profile fraîchement
 * créé est vierge et se remplit progressivement via
 * `UpdateDsfProfileDto`. La validation "champs obligatoires pour
 * générer une fiche" est portée par le service, pas par la DB.
 */
@Entity({ name: 'organization_dsf_profile' })
export class OrganizationDsfProfileEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid', unique: true })
  organizationId!: string;

  @OneToOne(() => OrganizationEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization!: OrganizationEntity;

  /** Forme juridique : SA, SARL, SAS, GIE, SCI, EURL, etc. */
  @Column({ name: 'legal_form', type: 'text', nullable: true })
  legalForm!: string | null;

  /** Régime fiscal : BIC / BNC / IS / réel / simplifié. */
  @Column({ name: 'tax_regime', type: 'text', nullable: true })
  taxRegime!: string | null;

  /** Code pays ISO 3166-1 alpha-3 (CIV, SEN, BEN, …). */
  @Column({ type: 'text', nullable: true })
  country!: string | null;

  /** Identifiant fiscal (NINEA Sénégal, IFU Côte d'Ivoire, etc.). */
  @Column({ type: 'text', nullable: true })
  ninea!: string | null;

  @Column({ type: 'text', nullable: true })
  rccm!: string | null;

  @Column({ name: 'siege_address', type: 'text', nullable: true })
  siegeAddress!: string | null;

  @Column({ name: 'siege_city', type: 'text', nullable: true })
  siegeCity!: string | null;

  @Column({ type: 'text', nullable: true })
  phone!: string | null;

  @Column({ type: 'text', nullable: true })
  email!: string | null;

  /**
   * Capital social libéré, dans la devise `currency`. Stocké comme
   * string (TypeORM mappe NUMERIC en string pour préserver la
   * précision) — le formatteur de la fiche R1 se charge de l'affichage.
   */
  @Column({ type: 'numeric', precision: 15, scale: 2, nullable: true })
  capital!: string | null;

  @Column({ type: 'text', default: 'XOF' })
  currency!: string;

  @Column({ name: 'activity_sector', type: 'text', nullable: true })
  activitySector!: string | null;

  @Column({ name: 'director_name', type: 'text', nullable: true })
  directorName!: string | null;

  /** Titre du dirigeant : "Directeur Général", "Gérant", etc. */
  @Column({ name: 'director_title', type: 'text', nullable: true })
  directorTitle!: string | null;

  /** Président du conseil (sociétés anonymes uniquement). */
  @Column({ name: 'president_name', type: 'text', nullable: true })
  presidentName!: string | null;

  @Column({ name: 'auditor_name', type: 'text', nullable: true })
  auditorName!: string | null;

  /**
   * Applicabilité des 36 notes annexes — Record<noteId, boolean>.
   * Une note non listée est considérée non applicable. Ex :
   * `{"N1": true, "N2": true, "N5": false}`.
   */
  @Column({ name: 'notes_applicable', type: 'jsonb', default: () => "'{}'::jsonb" })
  notesApplicable!: Record<string, boolean>;

  /**
   * Effectifs par qualification (codes lettrés YA-YO masse salariale,
   * Tome 3 p. 30) — Record<qualification, number>. Ex :
   * `{"YA cadres": 5, "YB maîtrise": 12, "YC employés": 38}`.
   */
  @Column({
    name: 'workforce_by_qualification',
    type: 'jsonb',
    default: () => "'{}'::jsonb",
  })
  workforceByQualification!: Record<string, number>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
