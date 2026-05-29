import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public } from '../../auth/decorators/public.decorator';
import {
  SyscohadaKnowledgeService,
  SyscohadaModuleGuidance,
} from '../../syscohada-knowledge/services/syscohada-knowledge.service';

/**
 * Expose la doctrine SYSCOHADA rattachée au module Opérations en devises :
 * références du Guide d'application + contrôles métier sourcés (chaque
 * contrôle porte sa base légale et un extrait verbatim du Guide via la
 * citation). Couvre la conversion des opérations en devises, les écarts
 * de conversion (478/479) et les écarts de change à la clôture.
 *
 * Lecture seule, publique : il s'agit de doctrine (non d'un état tenant).
 * Le `SyscohadaKnowledgeService` est `@Global()`, donc injectable sans
 * réimporter le module de connaissance.
 */
@ApiTags('SYSCOHADA Guidance')
@Controller('multi-currency/syscohada-guidance')
export class MultiCurrencySyscohadaGuidanceController {
  constructor(private readonly knowledge: SyscohadaKnowledgeService) {}

  @Get()
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Références et contrôles SYSCOHADA du module Opérations en devises (Tome 2).',
  })
  @ApiOkResponse({ description: 'Guidance doctrinale sourcée (références + contrôles cités).' })
  getGuidance(): SyscohadaModuleGuidance {
    return this.knowledge.getModuleGuidance('multi-currency');
  }
}
