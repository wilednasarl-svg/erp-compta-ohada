import type { DocumentType } from '@/types/imports';

/**
 * Modèles de fichiers d'import téléchargeables, un par nature de document.
 *
 * Objectif : donner à l'utilisateur un fichier qui MARCHE à coup sûr —
 * en-têtes reconnus par l'auto-mapping, séparateur point-virgule (`;`),
 * montants en nombres simples (sans virgule de milliers, source n°1 des
 * imports cassés). Il remplit ses lignes par-dessus et réimporte.
 *
 * Les en-têtes choisis correspondent exactement aux synonymes reconnus
 * côté backend (`HEADER_SYNONYMS`) pour chaque nature de document.
 * Séparateur `;` volontaire : il évite l'ambiguïté des montants à
 * virgules dans un CSV séparé par des virgules.
 */

interface ImportTemplate {
  /** Nom de fichier proposé au téléchargement. */
  readonly filename: string;
  /** Lignes du CSV (en-tête + exemples). Séparateur `;`. */
  readonly rows: ReadonlyArray<ReadonlyArray<string>>;
}

export const IMPORT_TEMPLATES: Record<DocumentType, ImportTemplate> = {
  entries: {
    filename: 'modele_ecritures.csv',
    rows: [
      ['Journal', 'Date', 'N° pièce', 'N° compte général', 'Libellé écriture', 'Débit', 'Crédit'],
      ['ACH', '2026-01-05', 'P001', '60110000', 'Achat fournitures', '1500000', '0'],
      ['ACH', '2026-01-05', 'P001', '40110000', 'Dette fournisseur', '0', '1500000'],
    ],
  },
  general_ledger: {
    filename: 'modele_grand_livre.csv',
    rows: [
      ['N° compte', 'Date', 'C.J', 'Intitulé', 'Débit', 'Crédit'],
      ['60110000', '2026-01-05', 'ACH', 'Achat fournitures', '1500000', '0'],
      ['40110000', '2026-01-05', 'ACH', 'Dette fournisseur', '0', '1500000'],
    ],
  },
  trial_balance: {
    filename: 'modele_balance.csv',
    rows: [
      ['Compte', 'Intitulé', 'Solde Débit', 'Solde Crédit'],
      ['10130000', 'Capital social', '0', '5000000'],
      ['52120000', 'Banque', '5000000', '0'],
    ],
  },
  bank_statement: {
    filename: 'modele_releve_bancaire.csv',
    rows: [
      ['Date', 'Libellé', 'Débit', 'Crédit'],
      ['2026-01-05', 'Virement client SAVON+', '0', '1800000'],
      ['2026-01-08', 'Règlement fournisseur SOGEN', '750000', '0'],
    ],
  },
  auxiliary_ledger: {
    filename: 'modele_grand_livre_auxiliaire.csv',
    rows: [
      ['Tiers', 'N° compte', 'Date', 'Libellé', 'Débit', 'Crédit'],
      ['401SOGEN', '40110000', '2026-01-05', 'Achat fournitures', '0', '3000000'],
      ['411CLI001', '41110000', '2026-01-06', 'Vente produits', '15000000', '0'],
    ],
  },
  sales_purchases: {
    filename: 'modele_journal_ventes_achats.csv',
    rows: [
      ['Journal', 'Date', 'N° pièce', 'N° compte général', 'Tiers', 'Libellé', 'Débit', 'Crédit'],
      ['VTE', '2026-01-06', 'F2026-001', '41110000', '411CLI001', 'Vente SAVON+', '15000000', '0'],
      ['VTE', '2026-01-06', 'F2026-001', '70110000', '411CLI001', 'Produit des ventes', '0', '15000000'],
    ],
  },
};

/** Sérialise un modèle en texte CSV (séparateur `;`, BOM UTF-8 pour Excel). */
export function buildTemplateCsv(documentType: DocumentType): string {
  const template = IMPORT_TEMPLATES[documentType];
  const body = template.rows.map((row) => row.join(';')).join('\r\n');
  // BOM : garantit qu'Excel ouvre le fichier en UTF-8 (accents corrects).
  return `﻿${body}\r\n`;
}

/**
 * Déclenche le téléchargement du modèle CSV pour la nature de document
 * donnée. Pur côté client (Blob + lien temporaire) — aucun appel réseau.
 */
export function downloadImportTemplate(documentType: DocumentType): void {
  const csv = buildTemplateCsv(documentType);
  const { filename } = IMPORT_TEMPLATES[documentType];
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
