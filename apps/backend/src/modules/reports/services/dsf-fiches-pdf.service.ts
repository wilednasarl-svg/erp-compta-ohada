import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';

import type {
  CoverPageData,
  DirectorsFicheData,
  IdentificationFicheData,
  NotesApplicabilityFicheData,
} from '../types/dsf-profile.types';

/**
 * `DsfFichesPdfService` — W5.3.
 *
 * Génère les 4 PDFs de la liasse DSF SYSCOHADA :
 *   - R1 : page de garde
 *   - R2 : fiche d'identification (NINEA, RCCM, adresse, effectifs)
 *   - R3 : dirigeants et commissaires aux comptes
 *   - R4 : applicabilité des 36 notes annexes AUDCIF
 *
 * Style sobre — police standard, marges 50pt, pas de couleur fantaisiste.
 * Format A4 portrait pour les 4 fiches (contrairement aux états financiers
 * qui sont en landscape).
 */
@Injectable()
export class DsfFichesPdfService {
  private static readonly MARGIN = 50;
  private static readonly LINE_HEIGHT = 16;
  private static readonly STAMP =
    'Liasse DSF SYSCOHADA AUDCIF - Tome 3 « Etats financiers » p. 18-31';

  // ─── R1 — Page de garde ──────────────────────────────────────────
  async coverPagePdf(cover: CoverPageData, orgName: string): Promise<Buffer> {
    const doc = this.createDoc();
    const m = DsfFichesPdfService.MARGIN;
    const pageWidth = doc.page.width - m * 2;

    // Titre centré.
    doc.moveDown(4);
    doc.font('Helvetica-Bold').fontSize(22).text('DÉCLARATION STATISTIQUE ET FISCALE', m, doc.y, {
      width: pageWidth,
      align: 'center',
    });
    doc.moveDown(0.3);
    doc
      .font('Helvetica-Bold')
      .fontSize(16)
      .text('Système Comptable OHADA Révisé (AUDCIF)', m, doc.y, {
        width: pageWidth,
        align: 'center',
      });
    doc.moveDown(0.4);
    doc
      .font('Helvetica-Oblique')
      .fontSize(10)
      .fillColor('#555555')
      .text('Fiche R1 — Page de garde', m, doc.y, { width: pageWidth, align: 'center' });
    doc.fillColor('#000000');
    doc.moveDown(4);

    // Cartouche identité.
    const rowGap = 22;
    let y = doc.y;
    const rows: Array<[string, string]> = [
      ['Raison sociale', orgName],
      ['Sigle', cover.organizationSlug],
      ['Forme juridique', cover.legalForm ?? '—'],
      ['Capital social', cover.capital !== null ? `${cover.capital} ${cover.currency}` : '—'],
      ['Pays', cover.country ?? '—'],
      ['Exercice comptable', cover.exerciseLabel],
      ['Début exercice', cover.exerciseStartDate],
      ['Date de clôture', cover.exerciseEndDate],
    ];

    for (const [label, value] of rows) {
      doc.font('Helvetica-Bold').fontSize(11).text(label, m, y, { width: 180 });
      doc
        .font('Helvetica')
        .fontSize(11)
        .text(value, m + 200, y, { width: pageWidth - 200 });
      y += rowGap;
    }

    // Footer encadré.
    const footerY = doc.page.height - 100;
    doc
      .font('Helvetica-Oblique')
      .fontSize(9)
      .fillColor('#555555')
      .text(`Exercice clos le ${cover.exerciseEndDate}`, m, footerY, {
        width: pageWidth,
        align: 'center',
      });
    doc.moveDown(0.3);
    doc.text(DsfFichesPdfService.STAMP, m, doc.y, {
      width: pageWidth,
      align: 'center',
    });
    doc.fillColor('#000000');

    return this.finalize(doc);
  }

  // ─── R2 — Fiche d'identification ─────────────────────────────────
  async identificationFichePdf(r2: IdentificationFicheData): Promise<Buffer> {
    const doc = this.createDoc();
    this.header(doc, "Fiche R2 — Identification de l'entité", r2.organizationName);

    const rows: Array<[string, string]> = [
      ['Raison sociale', r2.organizationName],
      ['Forme juridique', r2.legalForm ?? '—'],
      ['Régime fiscal', r2.taxRegime ?? '—'],
      ['Pays', r2.country ?? '—'],
      ['NINEA', r2.ninea ?? '—'],
      ['RCCM', r2.rccm ?? '—'],
      ['Adresse du siège', r2.siegeAddress ?? '—'],
      ['Ville', r2.siegeCity ?? '—'],
      ['Téléphone', r2.phone ?? '—'],
      ['Email', r2.email ?? '—'],
      ["Secteur d'activité", r2.activitySector ?? '—'],
    ];
    this.twoColTable(doc, rows);

    // Effectifs.
    doc.moveDown(1);
    doc.font('Helvetica-Bold').fontSize(11).text('Effectifs par qualification');
    doc.moveDown(0.3);
    const workforceRows: Array<[string, string]> = Object.entries(
      r2.workforceByQualification ?? {},
    ).map(([qual, n]) => [qual, String(n)]);
    workforceRows.push(['TOTAL', String(r2.workforceTotal)]);
    this.twoColTable(doc, workforceRows);

    this.footer(doc);
    return this.finalize(doc);
  }

  // ─── R3 — Dirigeants ─────────────────────────────────────────────
  async directorsFichePdf(r3: DirectorsFicheData): Promise<Buffer> {
    const doc = this.createDoc();
    this.header(doc, 'Fiche R3 — Dirigeants et commissaires', '');

    const rows: Array<[string, string]> = [
      ['Directeur Général', r3.directorName ?? '—'],
      ['Titre', r3.directorTitle ?? '—'],
      ['Président', r3.presidentName ?? '—'],
      ['Commissaire aux comptes', r3.auditorName ?? '—'],
    ];
    this.twoColTable(doc, rows);

    this.footer(doc);
    return this.finalize(doc);
  }

  // ─── R4 — Applicabilité des 36 notes annexes ─────────────────────
  async notesApplicabilityFichePdf(r4: NotesApplicabilityFicheData): Promise<Buffer> {
    const doc = this.createDoc();
    this.header(doc, 'Fiche R4 — Applicabilité des notes annexes AUDCIF', '');

    doc
      .font('Helvetica')
      .fontSize(10)
      .text(
        `Total notes : ${r4.totalNotes}  |  Applicables : ${r4.applicableCount}  |  N/A : ${r4.notApplicableCount}`,
      );
    doc.moveDown(0.5);

    const m = DsfFichesPdfService.MARGIN;
    const colsX = [m, m + 70, m + 380, m + 460];
    let y = doc.y;

    // Header.
    doc.font('Helvetica-Bold').fontSize(9);
    doc.text('Code', colsX[0], y, { width: 60 });
    doc.text('Libellé', colsX[1], y, { width: 300 });
    doc.text('Statut', colsX[2], y, { width: 70 });
    y += DsfFichesPdfService.LINE_HEIGHT;
    doc
      .moveTo(m, y)
      .lineTo(doc.page.width - m, y)
      .lineWidth(0.5)
      .stroke();
    y += 4;

    doc.font('Helvetica').fontSize(9);
    for (const entry of r4.entries) {
      if (y > doc.page.height - 70) {
        doc.addPage();
        y = DsfFichesPdfService.MARGIN;
      }
      const status = entry.status === 'APPLICABLE' ? 'A' : 'N/A';
      doc.text(entry.noteId, colsX[0], y, { width: 60 });
      // Libellé court — on n'a que l'id côté types, on génère un libellé générique.
      doc.text(`Note annexe ${entry.noteId}`, colsX[1], y, { width: 300 });
      doc.text(status, colsX[2], y, { width: 70 });
      y += DsfFichesPdfService.LINE_HEIGHT;
    }

    doc.y = y + 6;
    doc
      .font('Helvetica-Oblique')
      .fontSize(8)
      .fillColor('#555555')
      .text('Légende : A = Applicable, N/A = Non Applicable (Tome 3 p. 31).');
    doc.fillColor('#000000');

    this.footer(doc);
    return this.finalize(doc);
  }

  // ─── Helpers ─────────────────────────────────────────────────────
  private createDoc(): PDFKit.PDFDocument {
    return new PDFDocument({
      size: 'A4',
      layout: 'portrait',
      margin: DsfFichesPdfService.MARGIN,
      bufferPages: true,
      info: {
        Title: 'Liasse DSF SYSCOHADA',
        Creator: 'ERP Compta — SYSCOHADA AUDCIF',
      },
    });
  }

  private header(doc: PDFKit.PDFDocument, title: string, orgName: string): void {
    const m = DsfFichesPdfService.MARGIN;
    if (orgName !== '') {
      doc.font('Helvetica-Bold').fontSize(13).text(orgName, m, m);
      doc.moveDown(0.2);
    }
    doc.font('Helvetica-Bold').fontSize(15).text(title);
    doc.moveDown(0.3);
    doc.font('Helvetica-Oblique').fontSize(8).fillColor('#555555').text(DsfFichesPdfService.STAMP);
    doc.fillColor('#000000');
    doc.moveDown(0.8);
  }

  private twoColTable(doc: PDFKit.PDFDocument, rows: ReadonlyArray<[string, string]>): void {
    const m = DsfFichesPdfService.MARGIN;
    const labelWidth = 200;
    const valueWidth = doc.page.width - m * 2 - labelWidth;
    let y = doc.y;
    for (const [label, value] of rows) {
      if (y > doc.page.height - 70) {
        doc.addPage();
        y = DsfFichesPdfService.MARGIN;
      }
      doc.font('Helvetica-Bold').fontSize(10).text(label, m, y, { width: labelWidth });
      doc
        .font('Helvetica')
        .fontSize(10)
        .text(value, m + labelWidth, y, { width: valueWidth });
      y += DsfFichesPdfService.LINE_HEIGHT;
    }
    doc.y = y;
  }

  private footer(doc: PDFKit.PDFDocument): void {
    const pages = doc.bufferedPageRange();
    for (let i = pages.start; i < pages.start + pages.count; i++) {
      doc.switchToPage(i);
      doc
        .font('Helvetica')
        .fontSize(7)
        .fillColor('#888888')
        .text(
          `Page ${i + 1} / ${pages.count}  —  Généré le ${new Date().toISOString().slice(0, 10)}  —  ERP Compta SYSCOHADA`,
          DsfFichesPdfService.MARGIN,
          doc.page.height - 30,
          {
            align: 'center',
            width: doc.page.width - DsfFichesPdfService.MARGIN * 2,
          },
        );
    }
    doc.fillColor('#000000');
  }

  private finalize(doc: PDFKit.PDFDocument): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      doc.end();
    });
  }
}
