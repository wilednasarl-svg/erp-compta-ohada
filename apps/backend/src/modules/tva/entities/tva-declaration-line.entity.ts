import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import type { TvaDeclarationLineDirection } from '../types/tva.types';
import { TvaDeclarationEntity } from './tva-declaration.entity';

/**
 * `tva_declaration_lines` row — voir migration 0048.
 *
 * Détail d'une ligne d'agrégation TVA dans une déclaration. Une ligne
 * = (direction, account_prefix, montant). En wave 1 on n'agrège pas par
 * code TVA fin, mais par préfixe de compte SYSCOHADA (443, 4452, 4451)
 * — la wave 2 introduira le rattachement par `tva_code_id` quand les
 * lignes d'écriture porteront le code TVA explicitement.
 *
 * `accountPrefix` est le préfixe utilisé pour l'agrégation (ex `4431`,
 * `4452`). Pas de FK : c'est un libellé d'agrégation, pas un compte
 * du plan.
 */
@Entity({ name: 'tva_declaration_lines' })
@Index('ix_tva_declaration_lines_declaration', ['declarationId'])
export class TvaDeclarationLineEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'declaration_id', type: 'uuid' })
  declarationId!: string;

  @ManyToOne(() => TvaDeclarationEntity, (decl) => decl.lines, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'declaration_id' })
  declaration!: TvaDeclarationEntity;

  @Column({ type: 'text' })
  direction!: TvaDeclarationLineDirection;

  @Column({ name: 'account_prefix', type: 'text' })
  accountPrefix!: string;

  @Column({ name: 'account_label', type: 'text', nullable: true })
  accountLabel!: string | null;

  @Column({ type: 'numeric', precision: 15, scale: 2, default: 0 })
  amount!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
