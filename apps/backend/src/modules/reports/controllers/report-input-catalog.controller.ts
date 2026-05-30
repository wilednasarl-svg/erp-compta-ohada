import { Controller, Get, HttpCode, HttpStatus, Param } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public } from '../../auth/decorators/public.decorator';
import {
  REPORT_INPUT_CATALOG,
  getReportInputSpec,
  getReportsForDocumentType,
  type ReportInputSpec,
} from '../data/report-input-catalog';
import { DOCUMENT_TYPES, type DocumentType } from '../../imports/types/import-status';

/**
 * Expose le catalogue « rapport financier → fichier à importer + formules ».
 *
 * Pour chaque état SYSCOHADA : le ou les types de fichier à importer en amont,
 * la donnée source réellement consommée, et les formules de calcul telles
 * qu'implémentées dans le moteur (vérifiées par les tests du catalogue).
 *
 * Lecture seule, publique : il s'agit de DOCTRINE / métadonnées de référence
 * (statique, non tenant), au même titre que les contrôleurs de guidance
 * SYSCOHADA. Aucun état tenant n'est lu ici.
 */
@ApiTags('Reports')
@Controller('reports/input-catalog')
export class ReportInputCatalogController {
  @Get()
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Catalogue complet : pour chaque rapport financier SYSCOHADA, le(s) fichier(s) à importer, la donnée source et les formules de calcul.',
  })
  @ApiOkResponse({
    description: 'Liste des spécifications de rapport (entrées requises + formules).',
  })
  getCatalog(): { reports: readonly ReportInputSpec[] } {
    return { reports: REPORT_INPUT_CATALOG };
  }

  @Get('by-document-type/:documentType')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Rapports qu'un type de fichier importé donné peut alimenter.",
  })
  @ApiOkResponse({ description: 'Rapports alimentés par ce type de document.' })
  getByDocumentType(@Param('documentType') documentType: string): {
    documentType: string;
    reports: readonly ReportInputSpec[];
  } {
    if (!(DOCUMENT_TYPES as readonly string[]).includes(documentType)) {
      return { documentType, reports: [] };
    }
    return {
      documentType,
      reports: getReportsForDocumentType(documentType as DocumentType),
    };
  }

  @Get(':reportKey')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Spécification d'un rapport : fichiers à importer, source et formules.",
  })
  @ApiOkResponse({ description: 'Spécification du rapport, ou 404-like (report: null).' })
  getOne(@Param('reportKey') reportKey: string): { report: ReportInputSpec | null } {
    return { report: getReportInputSpec(reportKey) };
  }
}
