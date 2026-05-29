import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public } from '../../auth/decorators/public.decorator';
import {
  SyscohadaKnowledgeService,
  SyscohadaModuleGuidance,
} from '../services/syscohada-knowledge.service';

/**
 * Expose la doctrine SYSCOHADA des regroupements d'entreprises : fusions,
 * apports partiels d'actif, scissions et transformations de sociétés
 * (Guide d'application Tome 2 — « Fusions et opérations assimilées »). Chaque
 * contrôle porte sa base légale et un extrait verbatim du Guide via la citation.
 *
 * NB : ce domaine doctrinal n'est délibérément PAS rattaché au module de code
 * `transformations/` (Transformation Engine = retraitements/reclassements
 * d'écritures), pour éviter de servir une doctrine fusions hors-sujet à ce
 * module. Il vit donc dans `syscohada-knowledge`, qui détient le service.
 *
 * Lecture seule, publique : il s'agit de doctrine (non d'un état tenant).
 * Le `SyscohadaKnowledgeService` est `@Global()`, donc injectable sans
 * réimporter le module de connaissance.
 */
@ApiTags('SYSCOHADA Guidance')
@Controller('business-combinations/syscohada-guidance')
export class BusinessCombinationsSyscohadaGuidanceController {
  constructor(private readonly knowledge: SyscohadaKnowledgeService) {}

  @Get()
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Références et contrôles SYSCOHADA des fusions, apports, scissions et transformations de sociétés (Tome 2).',
  })
  @ApiOkResponse({ description: 'Guidance doctrinale sourcée (références + contrôles cités).' })
  getGuidance(): SyscohadaModuleGuidance {
    return this.knowledge.getModuleGuidance('business-combinations');
  }
}
