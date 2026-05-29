import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public } from '../../auth/decorators/public.decorator';
import {
  SyscohadaKnowledgeService,
  SyscohadaModuleGuidance,
} from '../../syscohada-knowledge/services/syscohada-knowledge.service';

/**
 * Expose la doctrine SYSCOHADA rattachée au module Crédit-bail /
 * location-acquisition : références du Guide d'application + contrôles
 * métier sourcés (chaque contrôle porte sa base légale et un extrait
 * verbatim du Guide via la citation).
 *
 * Lecture seule, publique : il s'agit de doctrine (non d'un état tenant).
 * Le `SyscohadaKnowledgeService` est `@Global()`, donc injectable sans
 * réimporter le module de connaissance.
 */
@ApiTags('SYSCOHADA Guidance')
@Controller('leases/syscohada-guidance')
export class LeasesSyscohadaGuidanceController {
  constructor(private readonly knowledge: SyscohadaKnowledgeService) {}

  @Get()
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Références et contrôles SYSCOHADA du module Crédit-bail / location-acquisition (Tome 2).',
  })
  @ApiOkResponse({ description: 'Guidance doctrinale sourcée (références + contrôles cités).' })
  getGuidance(): SyscohadaModuleGuidance {
    return this.knowledge.getModuleGuidance('leases');
  }
}
